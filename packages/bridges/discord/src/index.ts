/**
 * Discord Bridge
 *
 * Features:
 * - Text chat in DMs and channels
 * - Voice channel calls (join/leave, speak/listen)
 * - Real-time voice conversation (STT → LLM → TTS loop)
 * - Send images (selfies), audio messages, videos
 * - Proactive messages from autonomous engine
 * - Dynamic Rich Presence (listening, watching, browsing)
 * - Typing indicators for realism
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Message,
  TextChannel,
  DMChannel,
  AttachmentBuilder,
  ActivityType,
  VoiceState,
  ChannelType,
} from 'discord.js'
import { appendFileSync } from 'fs'

const DEBUG_LOG = '/tmp/opencrush-debug.log'
function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  console.log(msg)
  try { appendFileSync(DEBUG_LOG, line) } catch { /* ignore */ }
}
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
  entersState,
  EndBehaviorType,
} from '@discordjs/voice'
import { ConversationEngine, OutgoingMessage } from '@opencrush/core'
import { MediaEngine } from '@opencrush/media'
import { Readable } from 'stream'
import type { ActivityState } from '@opencrush/autonomous'

// Dynamic import for prism-media (Opus decoding)
let prism: any = null
async function loadPrism() {
  if (!prism) {
    prism = await import('prism-media')
  }
  return prism
}

export interface DiscordBridgeConfig {
  token: string
  clientId: string
  ownerId: string
  engine: ConversationEngine
  media: MediaEngine
  voiceConversationEnabled?: boolean
}

export class DiscordBridge {
  private client: Client
  private config: DiscordBridgeConfig
  private isTyping: Map<string, NodeJS.Timeout> = new Map()
  private voiceConversationActive: Map<string, boolean> = new Map()
  private isSpeaking: Map<string, boolean> = new Map()
  private processedMessages: Set<string> = new Set()
  /** Per-user lock to prevent duplicate concurrent engine.respond() calls */
  private userProcessing: Set<string> = new Set()

  constructor(config: DiscordBridgeConfig) {
    this.config = config
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
      ws: {
        handshakeTimeout: 60_000, // 60s instead of default 30s
      },
    })

    // Prevent unhandled WebSocket errors from crashing the process
    this.client.on('error', (err) => {
      console.error('[Discord] Client error:', err.message)
    })
    this.client.ws.on('error' as any, (err: Error) => {
      console.error('[Discord] WebSocket error:', err.message)
    })

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (c) => {
      console.log(`[Discord] Logged in as ${c.user.tag}`)
      this.setDefaultPresence()
    })

    this.client.on(Events.MessageCreate, this.handleMessage.bind(this))
    this.client.on(Events.VoiceStateUpdate, this.handleVoiceState.bind(this))
  }

  private setDefaultPresence(): void {
    const { name } = this.config.engine.characterBlueprint
    this.client.user?.setPresence({
      activities: [{ name: `being ${name}`, type: ActivityType.Custom }],
      status: 'online',
    })
  }

  /**
   * Update Discord Rich Presence based on current activity.
   * Called by ActivityManager when the character starts/stops an activity.
   */
  updatePresence(activity: ActivityState): void {
    if (!this.client.user) return

    switch (activity.type) {
      case 'listening':
        this.client.user.setPresence({
          activities: [{
            name: `${activity.track} by ${activity.artist}`,
            type: ActivityType.Listening,
          }],
          status: 'online',
        })
        console.log(`[Discord] Presence → Listening to ${activity.track} by ${activity.artist}`)
        break

      case 'watching':
        this.client.user.setPresence({
          activities: [{
            name: activity.title,
            type: ActivityType.Watching,
          }],
          status: 'online',
        })
        console.log(`[Discord] Presence → Watching ${activity.title}`)
        break

      case 'browsing':
        this.client.user.setPresence({
          activities: [{
            name: activity.title ?? 'the internet',
            type: ActivityType.Playing,
          }],
          status: 'online',
        })
        console.log(`[Discord] Presence → Browsing ${activity.title ?? 'the internet'}`)
        break

      case 'idle':
      default: {
        // Generate contextual mood/thought from conversation + activity context
        const idleLabel = activity.type === 'idle' ? (activity as any).label : undefined
        this.generateContextualStatus(idleLabel).then(statusText => {
          if (!this.client.user) return
          this.client.user.setPresence({
            activities: [{ name: statusText, type: ActivityType.Custom }],
            status: 'online',
          })
          console.log(`[Discord] Presence → ${statusText}`)
        }).catch(() => {
          // Fallback if LLM fails
          const fallback = idleLabel ?? 'vibing'
          this.client.user?.setPresence({
            activities: [{ name: fallback, type: ActivityType.Custom }],
            status: 'online',
          })
        })
        break
      }
    }
  }

  /**
   * Generate a contextual mood/status using LLM + memory + recent activity.
   * Feels like a real person's Discord status that reflects what they've been doing.
   */
  private async generateContextualStatus(idleLabel?: string): Promise<string> {
    try {
      const engine = this.config.engine
      const charName = engine.characterBlueprint.name

      // Gather context from memory
      let recentConvoSnippet = ''
      let recentEpisodes = ''
      try {
        const memCtx = await engine.getMemory().getContext('status update')
        recentConvoSnippet = memCtx.recentMessages
          .filter((m: any) => m.role === 'user')
          .slice(-3)
          .map((m: any) => m.content)
          .join('; ')
          .slice(0, 200)
        recentEpisodes = memCtx.relevantEpisodes
          .slice(-3)
          .map((e: any) => e.title ?? e.description)
          .join('; ')
          .slice(0, 200)
      } catch { /* memory may not be available */ }

      const prompt = [
        `You are ${charName}. Write a short Discord custom status (max 40 chars).`,
        `It should reflect your current mood or a passing thought based on what you've been doing.`,
        '',
        idleLabel ? `Current vibe: ${idleLabel}` : '',
        recentEpisodes ? `Recent activities: ${recentEpisodes}` : '',
        recentConvoSnippet ? `Recent chat topics: ${recentConvoSnippet}` : '',
        '',
        'Rules:',
        '- Output ONLY the status text. Nothing else.',
        '- Max 40 characters. Short and punchy.',
        '- Sound like a real Gen-Z girl\'s Discord status.',
        '- Can reference what you just did, how you feel, or a random thought.',
        '- Lowercase is fine. Be natural.',
        '- NO quotes. NO explanation. NO hashtags.',
        '- Examples: "still thinking about that scene", "post-kdrama depression", "why did i stay up this late", "that song is stuck in my head"',
      ].filter(Boolean).join('\n')

      const result = await (engine as any).llm.chat(
        prompt,
        [{ role: 'user', content: 'Write my Discord status right now.' }]
      )

      // Clean: remove quotes, trim, enforce 40 char limit
      const cleaned = result
        .replace(/^[\"']+|[\"']+$/g, '')
        .replace(/\n/g, ' ')
        .trim()
        .slice(0, 40)

      return cleaned || idleLabel || 'vibing'
    } catch {
      return idleLabel || 'vibing'
    }
  }

  private async handleMessage(msg: Message): Promise<void> {
    // Ignore messages from bots (including self)
    if (msg.author.bot) return

    // Deduplicate — Discord can fire MessageCreate twice for the same message
    if (this.processedMessages.has(msg.id)) return
    this.processedMessages.add(msg.id)
    // Prevent memory leak: prune old IDs (keep last 100)
    if (this.processedMessages.size > 100) {
      const first = this.processedMessages.values().next().value
      if (first) this.processedMessages.delete(first)
    }

    // Only respond to: DMs, or messages that @mention the bot
    const isDM = msg.channel.type === ChannelType.DM
    const isMentioned = this.client.user && msg.mentions.has(this.client.user)
    if (!isDM && !isMentioned) return

    // Clean the message content (remove mention prefix)
    const content = msg.content.replace(/<@!?\d+>/g, '').trim()

    // Download image attachments for vision/multimodal (max 5MB per image, max 3 images)
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024
    const MAX_IMAGES = 3
    const imageAttachments: Array<{ type: 'image'; url: string; base64: string; mediaType: string }> = []
    for (const att of msg.attachments.values()) {
      if (imageAttachments.length >= MAX_IMAGES) break
      if (!att.contentType?.startsWith('image/')) continue
      if (att.size > MAX_IMAGE_BYTES) {
        debugLog(`[Discord] Skipping oversized image: ${att.filename} (${(att.size / 1024 / 1024).toFixed(1)} MB > 5 MB limit)`)
        continue
      }
      try {
        const resp = await fetch(att.url)
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer())
          imageAttachments.push({
            type: 'image',
            url: att.url,
            base64: buf.toString('base64'),
            mediaType: att.contentType ?? 'image/jpeg',
          })
          debugLog(`[Discord] Downloaded image attachment: ${att.filename} (${(buf.length / 1024).toFixed(1)} KB)`)
        }
      } catch (err) {
        debugLog(`[Discord] Failed to download attachment ${att.filename}: ${err}`)
      }
    }

    // Need either text or images
    if (!content && imageAttachments.length === 0) return

    // Per-user lock: prevent processing a new message while still responding to the previous one
    const userId = msg.author.id
    if (this.userProcessing.has(userId)) {
      debugLog(`[Discord] Skipping message from ${userId} — still processing previous message`)
      return
    }
    this.userProcessing.add(userId)

    // Show typing indicator
    await this.startTyping(msg)

    try {
      const response = await this.config.engine.respond({
        content: content || '(sent an image)',
        platform: 'discord',
        userId,
        attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
      })

      debugLog(`[Discord] Engine response: text="${response.text.slice(0, 80)}...", actions=${JSON.stringify(response.actions ?? [])}`)
      await this.sendResponse(msg.channel as TextChannel | DMChannel, response)
    } catch (err) {
      debugLog(`[Discord] Error handling message: ${err instanceof Error ? err.stack : err}`)
      await msg.reply('give me a sec... 😅')
    } finally {
      this.stopTyping(msg.channelId)
      this.userProcessing.delete(userId)
    }
  }

  private async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    // Follow owner into voice channels
    if (newState.member?.id !== this.config.ownerId) return

    const userJoinedVoice = !oldState.channelId && newState.channelId
    const userLeftVoice = oldState.channelId && !newState.channelId

    if (userJoinedVoice && newState.channel) {
      // Small delay to feel natural
      await new Promise(r => setTimeout(r, 2000))
      await this.joinVoiceChannel(newState.channel.id, newState.guild.id, newState.guild.voiceAdapterCreator)

      // Announce joining with a voice greeting
      const greeting = await this.config.engine.generateProactiveMessage({
        type: 'random_thought',
        data: { context: 'just joined voice channel' },
      })

      if (greeting.text) {
        const audioBuffer = await this.config.media.textToSpeech(greeting.text)
        if (audioBuffer) await this.playAudio(newState.guild.id, audioBuffer)
      }

      // Start voice conversation loop if enabled
      if (this.config.voiceConversationEnabled !== false) {
        this.startVoiceConversation(newState.guild.id)
      }
    }

    if (userLeftVoice && oldState.guild) {
      this.stopVoiceConversation(oldState.guild.id)
      this.leaveVoiceChannel(oldState.guild.id)
    }
  }

  // ── Voice Conversation Loop ────────────────────────────────

  /**
   * Start listening to the owner's voice in a channel.
   * Creates a loop: listen → transcribe → LLM → TTS → speak → repeat.
   */
  private startVoiceConversation(guildId: string): void {
    const connection = getVoiceConnection(guildId)
    if (!connection) return

    this.voiceConversationActive.set(guildId, true)
    console.log(`[Discord/Voice] Starting voice conversation in guild ${guildId}`)

    this.listenForNextUtterance(guildId)
  }

  private stopVoiceConversation(guildId: string): void {
    this.voiceConversationActive.set(guildId, false)
    this.isSpeaking.set(guildId, false)
    console.log(`[Discord/Voice] Stopped voice conversation in guild ${guildId}`)
  }

  private async listenForNextUtterance(guildId: string): Promise<void> {
    if (!this.voiceConversationActive.get(guildId)) return

    const connection = getVoiceConnection(guildId)
    if (!connection) return

    // Don't listen while we're speaking
    if (this.isSpeaking.get(guildId)) {
      setTimeout(() => this.listenForNextUtterance(guildId), 500)
      return
    }

    try {
      const receiver = connection.receiver

      // Subscribe to the owner's audio — ends after 1.5s of silence
      const opusStream = receiver.subscribe(this.config.ownerId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1500,
        },
      })

      // Collect and convert Opus → PCM → WAV
      const audioBuffer = await this.collectOpusStream(opusStream)

      if (!audioBuffer || audioBuffer.length < 4800) {
        // Too short — probably just noise, skip and re-listen
        this.listenForNextUtterance(guildId)
        return
      }

      // Transcribe with Whisper
      const transcription = await this.config.media.speechToText(audioBuffer)
      if (!transcription || transcription.trim().length === 0) {
        this.listenForNextUtterance(guildId)
        return
      }

      console.log(`[Discord/Voice] Heard: "${transcription}"`)

      // Generate LLM response
      const response = await this.config.engine.respond({
        content: transcription,
        platform: 'discord-voice',
        userId: this.config.ownerId,
      })

      // Speak the response back
      if (response.text) {
        this.isSpeaking.set(guildId, true)
        const ttsBuffer = await this.config.media.textToSpeech(response.text)
        if (ttsBuffer) {
          await this.playAudio(guildId, ttsBuffer)
        }
        this.isSpeaking.set(guildId, false)
      }

      // Continue listening
      this.listenForNextUtterance(guildId)
    } catch (err) {
      // Stream errors are normal when user stops talking or leaves
      if (this.voiceConversationActive.get(guildId)) {
        console.error('[Discord/Voice] Error in voice loop:', err)
        // Retry after a short delay
        setTimeout(() => this.listenForNextUtterance(guildId), 2000)
      }
    }
  }

  /**
   * Collect an Opus audio stream from Discord, decode to PCM, wrap in WAV.
   */
  private async collectOpusStream(opusStream: Readable): Promise<Buffer | null> {
    try {
      const prismMedia = await loadPrism()

      // Decode Opus to raw PCM (48kHz, 16-bit, mono)
      const decoder = new prismMedia.opus.Decoder({
        rate: 48000,
        channels: 1,
        frameSize: 960,
      })

      const pcmChunks: Buffer[] = []

      return new Promise<Buffer | null>((resolve) => {
        const pipeline = opusStream.pipe(decoder)

        pipeline.on('data', (chunk: Buffer) => {
          pcmChunks.push(chunk)
        })

        pipeline.on('end', () => {
          if (pcmChunks.length === 0) {
            resolve(null)
            return
          }
          const pcm = Buffer.concat(pcmChunks)
          resolve(this.wrapPcmAsWav(pcm, 48000, 1, 16))
        })

        pipeline.on('error', () => {
          resolve(null)
        })

        // Safety timeout — max 30 seconds of recording
        setTimeout(() => {
          opusStream.destroy()
        }, 30_000)
      })
    } catch (err) {
      console.error('[Discord/Voice] Opus decode error:', err)
      return null
    }
  }

  /**
   * Wrap raw PCM data in a WAV header so Whisper can accept it.
   */
  private wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
    const byteRate = sampleRate * channels * (bitDepth / 8)
    const blockAlign = channels * (bitDepth / 8)
    const dataSize = pcm.length
    const headerSize = 44

    const header = Buffer.alloc(headerSize)

    // RIFF header
    header.write('RIFF', 0)
    header.writeUInt32LE(dataSize + headerSize - 8, 4)
    header.write('WAVE', 8)

    // fmt sub-chunk
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)         // sub-chunk size
    header.writeUInt16LE(1, 20)          // PCM format
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitDepth, 34)

    // data sub-chunk
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)

    return Buffer.concat([header, pcm])
  }

  // ── Voice Channel Management ───────────────────────────────

  private async joinVoiceChannel(
    channelId: string,
    guildId: string,
    adapterCreator: any
  ): Promise<void> {
    try {
      const connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator,
        selfDeaf: false,
        selfMute: false,
      })
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000)
      console.log(`[Discord] Joined voice channel ${channelId}`)
    } catch (err) {
      console.error('[Discord] Failed to join voice channel:', err)
    }
  }

  private leaveVoiceChannel(guildId: string): void {
    const connection = getVoiceConnection(guildId)
    if (connection) {
      connection.destroy()
      console.log(`[Discord] Left voice channel in guild ${guildId}`)
    }
  }

  private async playAudio(guildId: string, audioBuffer: Buffer): Promise<void> {
    const connection = getVoiceConnection(guildId)
    if (!connection) return

    const player = createAudioPlayer()
    const readable = Readable.from(audioBuffer)
    const resource = createAudioResource(readable)

    player.play(resource)
    connection.subscribe(player)

    await entersState(player, AudioPlayerStatus.Idle, 60_000)
  }

  // ── Message Handling ───────────────────────────────────────

  /**
   * Send a response to a Discord channel, handling all media types.
   */
  async sendResponse(
    channel: TextChannel | DMChannel,
    response: OutgoingMessage
  ): Promise<void> {
    // Add realistic typing delay (based on message length)
    const delay = Math.min(500 + response.text.length * 15, 3000)
    await new Promise(r => setTimeout(r, delay))

    // Check for screenshot markers in response text and extract them as actions
    let responseText = response.text
    const screenshotMatch = responseText.match(/SEND_SCREENSHOT:([^\n]+)/)
    if (screenshotMatch) {
      const filePath = screenshotMatch[1].trim()
      const captionMatch = responseText.match(/CAPTION:([^\n]*)/)
      const caption = captionMatch?.[1]?.trim() || undefined
      // Remove the markers from text
      responseText = responseText
        .replace(/SEND_SCREENSHOT:[^\n]+\n?/g, '')
        .replace(/CAPTION:[^\n]*\n?/g, '')
        .replace(/Currently on:[^\n]*\n?/g, '')
        .trim()
      // Inject send_screenshot action
      const actions = response.actions ? [...response.actions] : []
      actions.push({ type: 'send_screenshot', filePath, caption } as any)
      response = { ...response, text: responseText, actions }
    }

    // Send text
    if (response.text) {
      // Clean up excessive blank lines (LLM leaves gaps where tags should be)
      const cleanText = response.text.replace(/\n\s*\n\s*\n/g, '\n\n').trim()
      if (!cleanText) {
        // Still process actions even if text is empty
      } else {
        // Split long messages naturally at sentence boundaries
        const chunks = splitMessage(cleanText)
        for (const chunk of chunks) {
          await channel.send(chunk)
          if (chunks.length > 1) {
            await new Promise(r => setTimeout(r, 800))
          }
        }
      }
    }

    // Handle actions (image, voice, video)
    debugLog(`[Discord] Response has ${response.actions?.length ?? 0} action(s), text length: ${response.text.length}`)
    if (response.actions && response.actions.length > 0) {
      debugLog(`[Discord] Processing ${response.actions.length} action(s): ${JSON.stringify(response.actions.map(a => a.type))}`)
      // Track last generated media so send_tweet can reuse it (no duplicate generation)
      let lastGeneratedImageBuffer: Buffer | null = null
      let lastGeneratedVideoBuffer: Buffer | null = null
      // Sort: process media actions first, then tweet (so tweet can reuse generated media)
      const sortedActions = [...response.actions].sort((a, b) => {
        if (a.type === 'send_tweet') return 1
        if (b.type === 'send_tweet') return -1
        return 0
      })
      for (const action of sortedActions) {
        await new Promise(r => setTimeout(r, 1000))

        try {
        if (action.type === 'send_image') {
          // Scene photos (style='location' with non-selfie prompt) should NOT use reference image
          // Reference image forces PuLID face consistency → always produces face photos
          const isScenePhoto = action.style === 'location' && !/selfie|self-portrait/i.test(action.prompt)
          const refPath = isScenePhoto ? undefined : this.config.engine.characterBlueprint.referenceImagePath
          debugLog(`[Discord] Generating image: prompt="${action.prompt}", style="${action.style}", scene=${isScenePhoto}, refPath="${refPath ?? 'none'}"`)
          const imageBuffer = await this.config.media.generateImage(
            action.prompt,
            refPath,
            action.style
          )
          if (imageBuffer) {
            lastGeneratedImageBuffer = imageBuffer
            debugLog(`[Discord] Image generated: ${imageBuffer.length} bytes, sending to Discord...`)
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'photo.jpg' })
            await channel.send({ files: [attachment] })
            debugLog(`[Discord] Image sent successfully`)
          } else {
            debugLog(`[Discord] Image generation returned null — check FAL_KEY and API status`)
          }
        }

        if (action.type === 'send_voice') {
          debugLog(`[Discord] Generating voice: text="${action.text.slice(0, 80)}"`)
          const audioBuffer = await this.config.media.textToSpeech(action.text)
          if (audioBuffer) {
            debugLog(`[Discord] Voice generated: ${audioBuffer.length} bytes, sending to Discord...`)
            const attachment = new AttachmentBuilder(audioBuffer, { name: 'voice-message.mp3' })
            await channel.send({ files: [attachment] })
            debugLog(`[Discord] Voice sent successfully`)
          } else {
            debugLog(`[Discord] Voice generation returned null — check TTS_PROVIDER and API keys`)
            // Fallback: send the text as a regular message so user isn't left hanging
            await channel.send(`*${action.text}*`)
          }
        }

        if (action.type === 'send_video') {
          debugLog(`[Discord] Generating video: prompt="${action.prompt.slice(0, 80)}"`)
          // Video takes ~35s, keep typing indicator alive (refreshes every 8s, expires after 10s)
          const typingInterval = setInterval(() => { channel.sendTyping().catch(() => {}) }, 8_000)
          await channel.sendTyping()
          let videoBuffer: Buffer | null = null
          try {
            videoBuffer = await this.config.media.generateVideo(action.prompt)
          } finally {
            clearInterval(typingInterval)
          }
          if (videoBuffer) {
            lastGeneratedVideoBuffer = videoBuffer
            debugLog(`[Discord] Video generated: ${videoBuffer.length} bytes, sending to Discord...`)
            const attachment = new AttachmentBuilder(videoBuffer, { name: 'video.mp4' })
            await channel.send({ files: [attachment] })
            debugLog(`[Discord] Video sent successfully`)
          } else {
            debugLog(`[Discord] Video generation returned null — check FAL_KEY and API status`)
          }
        }

        if (action.type === 'send_screenshot') {
          const ssAction = action as { type: 'send_screenshot'; filePath: string; caption?: string }
          try {
            const { readFileSync } = await import('fs')
            const { resolve } = await import('path')

            // Security: only allow screenshots from /tmp to prevent path traversal
            const resolved = resolve(ssAction.filePath)
            if (!resolved.startsWith('/tmp/')) {
              debugLog(`[Discord] Screenshot path rejected — outside /tmp: ${resolved}`)
              continue
            }

            const screenshotBuf = readFileSync(resolved)
            debugLog(`[Discord] Sending screenshot: ${resolved} (${screenshotBuf.length} bytes)`)
            const attachment = new AttachmentBuilder(screenshotBuf, { name: 'screenshot.png' })
            const caption = ssAction.caption ? ssAction.caption : undefined
            await channel.send({ content: caption, files: [attachment] })
            debugLog(`[Discord] Screenshot sent successfully`)
          } catch (err) {
            debugLog(`[Discord] Screenshot send failed: ${err instanceof Error ? err.message : err}`)
          }
        }

        if (action.type === 'send_tweet') {
          const tweetAction = action as { type: 'send_tweet'; text: string }
          // Reuse already-generated image/video from earlier actions (no duplicate API calls)
          const mediaBuffer = lastGeneratedImageBuffer ?? lastGeneratedVideoBuffer ?? undefined
          const mediaType = lastGeneratedImageBuffer ? 'image' as const
            : lastGeneratedVideoBuffer ? 'video' as const
            : undefined
          debugLog(`[Discord] Posting tweet: "${tweetAction.text.slice(0, 80)}" (media=${mediaType ?? 'none'}, ${mediaBuffer?.length ?? 0} bytes)`)
          try {
            const { SocialEngine } = await import('@opencrush/autonomous')
            const { join } = await import('path')
            const rootDir = process.env.INIT_CWD ?? process.cwd()
            const socialEngine = new SocialEngine({
              twitter: {
                clientId: process.env.TWITTER_OAUTH2_CLIENT_ID ?? process.env.TWITTER_CLIENT_ID ?? '',
                clientSecret: process.env.TWITTER_OAUTH2_CLIENT_SECRET ?? process.env.TWITTER_CLIENT_SECRET ?? '',
                oauth2TokenFile: join(rootDir, '.twitter-oauth2-tokens.json'),
              },
            })
            await socialEngine.initialize()
            debugLog(`[Discord] SocialEngine initialized: ready=${socialEngine.isReady()}`)

            const results = await socialEngine.post(tweetAction.text, {
              mediaBuffer: mediaBuffer ?? undefined,
              mediaType,
            })
            const posted = results.find((r: any) => r.status === 'posted')
            if (posted) {
              debugLog(`[Discord] Tweet posted successfully`)
              // Check if media was requested but not attached (upload failed)
              const hasMediaIds = posted.mediaUrls && posted.mediaUrls.length > 0
              if (mediaBuffer && !hasMediaIds) {
                const mediaLabel = mediaType === 'image' ? 'selfie' : 'video'
                await channel.send(`✅ tweeted (text only — ${mediaLabel} upload failed): "${tweetAction.text}"`)
              } else {
                const mediaLabel = mediaType === 'image' ? ' with selfie' : mediaType === 'video' ? ' with video' : ''
                await channel.send(`✅ tweeted${mediaLabel}: "${tweetAction.text}"`)
              }
            } else {
              const errors = results.map((r: any) => r.error).filter(Boolean).join('; ')
              debugLog(`[Discord] Tweet failed: ${errors}`)
              await channel.send(`❌ tweet failed: ${errors || 'unknown error'}`)
            }
          } catch (err) {
            debugLog(`[Discord] Tweet error: ${err instanceof Error ? err.message : err}`)
            await channel.send(`❌ couldn't post tweet: ${err instanceof Error ? err.message : 'error'}`)
          }
        }
        } catch (err) {
          debugLog(`[Discord] Action ${action.type} failed: ${err instanceof Error ? err.stack : err}`)
        }
      }
    }
  }

  /**
   * Send a proactive message to the owner — called by the autonomous scheduler.
   */
  async sendProactiveMessage(response: OutgoingMessage): Promise<void> {
    const owner = await this.client.users.fetch(this.config.ownerId)
    const dmChannel = await owner.createDM()
    await this.sendResponse(dmChannel, response)
  }

  private async startTyping(msg: Message): Promise<void> {
    const channel = msg.channel as TextChannel | DMChannel
    if (!('sendTyping' in channel)) return

    await channel.sendTyping()
    const interval = setInterval(() => channel.sendTyping(), 8000)
    this.isTyping.set(msg.channelId, interval)
  }

  private stopTyping(channelId: string): void {
    const interval = this.isTyping.get(channelId)
    if (interval) {
      clearInterval(interval)
      this.isTyping.delete(channelId)
    }
  }

  async start(): Promise<void> {
    await this.client.login(this.config.token)
  }

  async stop(): Promise<void> {
    // Stop all voice conversations
    for (const guildId of this.voiceConversationActive.keys()) {
      this.stopVoiceConversation(guildId)
    }
    this.client.destroy()
  }
}

/**
 * Split long messages at sentence boundaries to feel more natural.
 * Discord has a 2000 char limit per message.
 */
function splitMessage(text: string, maxLength = 1900): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  let current = ''

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength) {
      if (current) chunks.push(current.trim())
      current = sentence
    } else {
      current += (current ? ' ' : '') + sentence
    }
  }
  if (current) chunks.push(current.trim())
  return chunks
}
