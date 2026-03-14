/**
 * Social Content Generator
 *
 * Generates relationship-aware, context-aware content for autonomous social posting.
 * Picks random content type (text/selfie/video), generates media + caption.
 * Draws from conversation memory, personality, relationship context,
 * and current activity (browsing, listening, watching).
 */

import type { ConversationEngine, Blueprint } from '@opencrush/core'
import type { MediaEngine } from '@opencrush/media'

export type SocialContentType = 'text_reflection' | 'selfie_post' | 'video_post'

export interface SocialContent {
  type: SocialContentType
  caption: string
  mediaBuffer?: Buffer
  mediaType?: 'image' | 'video'
}

/** Optional context from current AI activity — makes posts more relevant. */
export interface SocialGenerationContext {
  /** Human-readable description of current activity (e.g. "listening to Cruel Summer by Taylor Swift") */
  currentActivity?: string
  /** Narrative of recent activities (e.g. "listened to jazz, then browsed Pinterest") */
  recentActivities?: string
  /** Current browser page title (if browsing) */
  browserPageTitle?: string
  /** Current browser URL (if browsing) */
  browserUrl?: string
}

// Weighted random: text 50%, selfie 35%, video 15%
const CONTENT_WEIGHTS: Array<{ type: SocialContentType; weight: number }> = [
  { type: 'text_reflection', weight: 50 },
  { type: 'selfie_post', weight: 35 },
  { type: 'video_post', weight: 15 },
]

export class SocialContentGenerator {
  private readonly engine: ConversationEngine
  private readonly media: MediaEngine
  private readonly blueprint: Blueprint
  private readonly context?: SocialGenerationContext

  constructor(
    engine: ConversationEngine,
    media: MediaEngine,
    blueprint: Blueprint,
    context?: SocialGenerationContext,
  ) {
    this.engine = engine
    this.media = media
    this.blueprint = blueprint
    this.context = context
  }

  /**
   * Pick a random content type using weighted probability.
   */
  pickContentType(): SocialContentType {
    const total = CONTENT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0)
    let roll = Math.random() * total
    for (const entry of CONTENT_WEIGHTS) {
      roll -= entry.weight
      if (roll <= 0) return entry.type
    }
    return 'text_reflection'
  }

  /**
   * Generate a complete social post (caption + optional media).
   * Returns null if generation completely fails.
   */
  async generate(): Promise<SocialContent | null> {
    const contentType = this.pickContentType()
    console.log(`[Social/Content] Generating ${contentType}...`)

    try {
      switch (contentType) {
        case 'text_reflection':
          return await this.generateTextReflection()
        case 'selfie_post':
          return await this.generateSelfiePost()
        case 'video_post':
          return await this.generateVideoPost()
      }
    } catch (err) {
      console.error(`[Social/Content] Failed to generate ${contentType}:`, err)
      // Fallback to text if media fails
      if (contentType !== 'text_reflection') {
        console.log('[Social/Content] Falling back to text reflection')
        return await this.generateTextReflection().catch(() => null)
      }
      return null
    }
  }

  /**
   * Generate a text reflection about relationship, feelings, or daily life.
   */
  private async generateTextReflection(): Promise<SocialContent> {
    const caption = await this.generateCaption(
      'Write a tweet sharing a genuine thought, feeling, or observation. ' +
      'If you are currently doing something (browsing, watching, listening), your tweet can naturally reference that. ' +
      'It could be about your day, something you experienced with your person, ' +
      'a random musing about life or love. Be yourself — raw, real, not generic.'
    )
    return { type: 'text_reflection', caption }
  }

  /**
   * Generate a selfie with caption.
   */
  private async generateSelfiePost(): Promise<SocialContent> {
    // Generate selfie prompt based on current context
    const selfiePrompt = await this.generateCaption(
      'Describe a selfie you want to take right now based on what you are currently doing. ' +
      'What are you doing? Where are you? ' +
      'Describe the scene, your expression, lighting. Be specific. 1-2 sentences only.'
    )

    const imageBuffer = await this.media.generateImage(
      selfiePrompt,
      this.blueprint.referenceImagePath
    )

    if (!imageBuffer) {
      throw new Error('Image generation returned null')
    }

    // Generate a tweet caption for the selfie
    const caption = await this.generateCaption(
      `You just took a selfie: "${selfiePrompt}". ` +
      'Write a short, natural tweet caption to go with this photo. ' +
      'Like how a real person captions their selfies — casual, sometimes playful.'
    )

    return {
      type: 'selfie_post',
      caption,
      mediaBuffer: imageBuffer,
      mediaType: 'image',
    }
  }

  /**
   * Generate a short video with caption.
   */
  private async generateVideoPost(): Promise<SocialContent> {
    // Generate video scene prompt
    const videoPrompt = await this.generateCaption(
      'Describe a short 3-second video clip you want to share based on what you are currently doing. ' +
      'What are you doing or what are you looking at? Describe the motion and scene. ' +
      'Be specific and visual. 1-2 sentences only.'
    )

    const videoBuffer = await this.media.generateVideo(videoPrompt)

    if (!videoBuffer) {
      throw new Error('Video generation returned null')
    }

    // Generate a tweet caption for the video
    const caption = await this.generateCaption(
      `You just recorded a short video: "${videoPrompt}". ` +
      'Write a short, natural tweet caption. Keep it brief and real.'
    )

    return {
      type: 'video_post',
      caption,
      mediaBuffer: videoBuffer,
      mediaType: 'video',
    }
  }

  /**
   * Generate a tweet caption using LLM with full personality + relationship context.
   */
  private async generateCaption(instruction: string): Promise<string> {
    const memory = this.engine.getMemory()
    const recentContext = await memory.getContext('social media post')

    // Get relationship context
    const recentMessages = recentContext.recentMessages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content)
      .join('; ')

    const episodes = recentContext.relevantEpisodes
      .slice(-3)
      .map(e => e.description)
      .join('; ')

    // Build activity context lines
    const activityLines: string[] = []
    if (this.context?.currentActivity) {
      activityLines.push(`What you're doing right now: ${this.context.currentActivity}`)
    }
    if (this.context?.recentActivities) {
      activityLines.push(`What you've been up to recently: ${this.context.recentActivities}`)
    }
    if (this.context?.browserPageTitle) {
      activityLines.push(`Currently browsing: ${this.context.browserPageTitle}`)
    }

    const systemPrompt = [
      `You are ${this.blueprint.name}, a 22-year-old posting on Twitter/X.`,
      `Your personality: ${this.blueprint.soul?.slice(0, 500) ?? 'warm and genuine'}`,
      recentMessages ? `Recent conversations with your person: ${recentMessages}` : '',
      episodes ? `Recent life events: ${episodes}` : '',
      ...activityLines,
      '',
      'GOAL: Write a VIRAL tweet that gets engagement. Pick one style:',
      '- Hot take / unpopular opinion that people will quote-tweet',
      '- Relatable moment everyone experiences but nobody says out loud',
      '- Vulnerable/honest thought that makes people feel seen',
      '- Thirst trap caption (if posting selfie) — playful, confident, slightly flirty',
      '- Witty observation or funny take on everyday life',
      '- Mystery/curiosity gap that makes people want to know more',
      '',
      'Rules:',
      '- Max 200 chars (shorter = more retweets). NEVER exceed 280.',
      '- 1-2 emojis max. NO hashtags unless truly natural.',
      '- Sound like a real Gen-Z girl, NOT an AI or brand.',
      '- Lowercase is fine. Be bold. Be authentic.',
      '- Reference your current activity or recent life if relevant.',
      '- English only.',
    ].filter(Boolean).join('\n')

    const response = await (this.engine as any).llm.chat(
      systemPrompt,
      [{ role: 'user', content: `[Internal] ${instruction}` }]
    )

    // Clean up — remove quotes, trim, enforce 280 chars
    const cleaned = response
      .replace(/^["']+|["']+$/g, '')
      .replace(/\[.*?\]/g, '')
      .trim()
      .slice(0, 280)

    return cleaned
  }
}
