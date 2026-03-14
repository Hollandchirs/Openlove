/**
 * LLM Router
 *
 * Supports:
 *   International — Anthropic Claude, OpenAI GPT
 *   Chinese       — DeepSeek, Qwen (Tongyi), Kimi (Moonshot), Zhipu GLM, MiniMax
 *   Local         — Ollama (any model)
 *
 * All Chinese providers use the OpenAI-compatible chat completions API,
 * so they share one code path with a different baseURL + model.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// ── Provider type ──────────────────────────────────────────────────────────

export type LLMProvider =
  | 'anthropic'   // https://console.anthropic.com
  | 'openai'      // https://platform.openai.com
  | 'deepseek'    // https://platform.deepseek.com  (CN + overseas, no VPN needed)
  | 'qwen'        // https://dashscope.aliyun.com   (阿里通义千问)
  | 'kimi'        // https://platform.moonshot.cn   (月之暗面 Moonshot)
  | 'zhipu'       // https://open.bigmodel.cn       (智谱 GLM)
  | 'minimax'     // https://platform.minimaxi.com  (MiniMax)
  | 'ollama'      // local

// ── OpenAI-compatible provider metadata ───────────────────────────────────

export const OPENAI_COMPAT_PROVIDERS: Record<string, { baseURL: string; defaultModel: string }> = {
  openai:   { baseURL: '',                                                        defaultModel: 'gpt-4o-mini' },
  deepseek: { baseURL: 'https://api.deepseek.com',                               defaultModel: 'deepseek-chat' },
  qwen:     { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',      defaultModel: 'qwen-max' },
  kimi:     { baseURL: 'https://api.moonshot.cn/v1',                             defaultModel: 'moonshot-v1-8k' },
  zhipu:    { baseURL: 'https://open.bigmodel.cn/api/paas/v4',                   defaultModel: 'glm-4-flash' },
  minimax:  { baseURL: 'https://api.minimax.chat/v1',                            defaultModel: 'abab6.5s-chat' },
  ollama:   { baseURL: 'http://localhost:11434/v1',                               defaultModel: 'qwen2.5:7b' },
}

// ── Config interface ───────────────────────────────────────────────────────

export interface LLMConfig {
  provider: LLMProvider

  // International
  anthropicApiKey?: string
  openaiApiKey?: string

  // Chinese providers (all OpenAI-compatible)
  deepseekApiKey?: string
  qwenApiKey?: string       // DASHSCOPE_API_KEY
  kimiApiKey?: string       // MOONSHOT_API_KEY
  zhipuApiKey?: string
  minimaxApiKey?: string

  // Local
  ollamaBaseUrl?: string
  ollamaModel?: string

  // Embedding — Jina AI (free 1M tokens/mo, multilingual including Chinese)
  jinaApiKey?: string

  // Override the model for any provider (optional)
  model?: string

  maxTokens?: number
  temperature?: number
}

// ── Router ─────────────────────────────────────────────────────────────────

export class LLMRouter {
  private config: LLMConfig
  private anthropic?: Anthropic
  private openai?: OpenAI

  constructor(config: LLMConfig) {
    this.config = config

    if (config.provider === 'anthropic' && config.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey })
    }

    if (config.provider !== 'anthropic') {
      const apiKey = this.resolveApiKey(config) ?? 'no-key'
      const info = OPENAI_COMPAT_PROVIDERS[config.provider]

      // Ollama may have a custom base URL from config
      const baseURL = config.provider === 'ollama'
        ? (config.ollamaBaseUrl ? `${config.ollamaBaseUrl}/v1` : info.baseURL)
        : (info?.baseURL || undefined)

      this.openai = new OpenAI({ apiKey, baseURL: baseURL || undefined })
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async chat(
    systemPrompt: string,
    messages: ChatMessage[],
    options: { stream?: boolean; staticPromptBreakpoint?: number } = {}
  ): Promise<string> {
    const maxRetries = 3
    const hasImages = messages.some(m => m.images && m.images.length > 0)

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (this.config.provider === 'anthropic') {
          return await this.chatAnthropic(systemPrompt, messages, options.staticPromptBreakpoint)
        }
        return await this.chatOpenAICompat(systemPrompt, messages)
      } catch (err) {
        const errMsg = (err as Error).message ?? ''

        // If the model doesn't support vision, fall back to text-only (once, no further retries)
        if (hasImages && (errMsg.includes('image') || errMsg.includes('multimodal') || errMsg.includes('vision') || errMsg.includes('content type'))) {
          console.warn(`[LLM] Model doesn't support vision — falling back to text-only`)
          const textOnlyMessages = messages.map(m => ({
            ...m,
            content: m.images && m.images.length > 0
              ? `${m.content}\n[User sent ${m.images.length} image(s) but your model does not support image recognition]`
              : m.content,
            images: undefined,
          }))
          try {
            return this.config.provider === 'anthropic'
              ? await this.chatAnthropic(systemPrompt, textOnlyMessages, options.staticPromptBreakpoint)
              : await this.chatOpenAICompat(systemPrompt, textOnlyMessages)
          } catch (fallbackErr) {
            throw fallbackErr // don't retry — propagate immediately
          }
        }

        const isRetryable = isRetryableError(err)
        if (attempt < maxRetries && isRetryable) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1) // 1s, 2s, 4s
          console.warn(`[LLM] Attempt ${attempt} failed (${errMsg}), retrying in ${backoffMs}ms...`)
          await new Promise(r => setTimeout(r, backoffMs))
          continue
        }
        throw err
      }
    }

    throw new Error('[LLM] All retry attempts exhausted')
  }

  async generate(prompt: string, systemContext?: string): Promise<string> {
    const sys = systemContext ?? 'You are a creative writing assistant. Be concise.'
    return this.chat(sys, [{ role: 'user', content: prompt }])
  }

  async embed(text: string): Promise<number[]> {
    // OpenAI native embedding
    if (this.openai && this.config.provider === 'openai') {
      const resp = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      })
      return resp.data[0].embedding
    }

    // Ollama embedding endpoint
    if (this.config.provider === 'ollama') {
      const base = this.config.ollamaBaseUrl ?? 'http://localhost:11434'
      const resp = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', input: text }),
      })
      const data = await resp.json() as { embeddings: number[][] }
      return data.embeddings[0]
    }

    // Jina AI — free multilingual embeddings (1M tokens/mo), supports Chinese natively
    if (this.config.jinaApiKey) {
      return this.embedJina(text)
    }

    // Last resort: pseudo-embed (not semantically meaningful, but prevents crashes)
    return simplePseudoEmbed(text)
  }

  private async embedJina(text: string): Promise<number[]> {
    const resp = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.jinaApiKey}`,
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        task: 'text-matching',
        dimensions: 512,
        input: [text],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error(`[LLM/Jina] Embedding error (${resp.status}):`, errText)
      return simplePseudoEmbed(text)
    }

    const data = await resp.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0].embedding
  }

  get characterName(): string {
    return '' // placeholder; actual name comes from blueprint, not LLM
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async chatAnthropic(
    systemPrompt: string,
    messages: ChatMessage[],
    staticBreakpoint?: number
  ): Promise<string> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized')

    // Use prompt caching: split system into static (cached) + dynamic blocks
    const system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> =
      staticBreakpoint && staticBreakpoint > 0
        ? [
            { type: 'text', text: systemPrompt.slice(0, staticBreakpoint), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: systemPrompt.slice(staticBreakpoint) },
          ]
        : [{ type: 'text', text: systemPrompt }]

    const resp = await this.anthropic.messages.create({
      model: this.config.model ?? 'claude-sonnet-4-6',
      max_tokens: this.config.maxTokens ?? 1024,
      system,
      messages: messages.map(m => ({
        role: m.role,
        content: m.images && m.images.length > 0
          ? [
              ...m.images.map(img => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: img.mediaType,
                  data: img.base64,
                },
              })),
              { type: 'text' as const, text: m.content || 'What do you see in this image?' },
            ]
          : m.content,
      })),
    })
    const block = resp.content[0]
    if (block.type !== 'text') throw new Error('Unexpected Anthropic response type')
    return block.text
  }

  private async chatOpenAICompat(systemPrompt: string, messages: ChatMessage[]): Promise<string> {
    if (!this.openai) throw new Error('OpenAI-compat client not initialized')

    const info = OPENAI_COMPAT_PROVIDERS[this.config.provider]
    const model = this.config.model
      ?? (this.config.provider === 'ollama' ? (this.config.ollamaModel ?? info.defaultModel) : info.defaultModel)

    const resp = await this.openai.chat.completions.create({
      model,
      max_tokens: this.config.maxTokens ?? 1024,
      temperature: this.config.temperature ?? 0.85,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.images && m.images.length > 0
            ? [
                ...m.images.map(img => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
                })),
                { type: 'text' as const, text: m.content || 'What do you see in this image?' },
              ]
            : m.content,
        })),
      ] as any,
    })
    return resp.choices[0]?.message?.content ?? ''
  }

  private resolveApiKey(config: LLMConfig): string | undefined {
    const map: Partial<Record<LLMProvider, string | undefined>> = {
      openai:   config.openaiApiKey,
      deepseek: config.deepseekApiKey,
      qwen:     config.qwenApiKey,
      kimi:     config.kimiApiKey,
      zhipu:    config.zhipuApiKey,
      minimax:  config.minimaxApiKey,
      ollama:   'ollama',
    }
    return map[config.provider]
  }
}

// ── Message type ──────────────────────────────────────────────────────────

export interface ImageContent {
  type: 'image'
  /** Base64-encoded image data */
  base64: string
  /** MIME type (e.g., 'image/jpeg', 'image/png') */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Optional images attached to this message (vision/multimodal) */
  images?: ImageContent[]
}

// ── Offline pseudo-embed ──────────────────────────────────────────────────

function simplePseudoEmbed(text: string): number[] {
  const dim = 384
  const vec = new Array(dim).fill(0)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    vec[i % dim] = (vec[i % dim] + Math.sin(code * (i + 1))) / 2
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

// ── Retry logic ──────────────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()

  // Rate limits (429)
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) return true
  // Server errors (5xx)
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true
  // Network errors
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('fetch failed')) return true
  // Overloaded
  if (msg.includes('overloaded') || msg.includes('capacity')) return true

  return false
}
