/**
 * Telegram Bridge
 *
 * Features:
 * - Text chat (private and group mentions)
 * - Voice messages (OGG format)
 * - Send photos, videos, stickers
 * - Typing action indicator
 * - Proactive message delivery
 */

import { Bot, Context, InputFile } from 'grammy'
import { ConversationEngine, OutgoingMessage } from '@opencrush/core'
import { MediaEngine } from '@opencrush/media'

type ImageStyle = 'casual' | 'mirror' | 'close-up' | 'location'

export interface TelegramBridgeConfig {
  token: string
  ownerId: number
  engine: ConversationEngine
  media: MediaEngine
}

export class TelegramBridge {
  private bot: Bot
  private config: TelegramBridgeConfig

  constructor(config: TelegramBridgeConfig) {
    this.config = config
    this.bot = new Bot(config.token)
    this.setupHandlers()
  }

  private setupHandlers(): void {
    // Private messages
    this.bot.on('message:text', (ctx) => this.handleTextMessage(ctx))

    // Voice messages from user (speech-to-text)
    this.bot.on('message:voice', (ctx) => this.handleVoiceMessage(ctx))

    // Photo messages (user sends an image for discussion)
    this.bot.on('message:photo', async (ctx) => {
      await this.handleTextMessage(ctx, 'I just sent you a photo — can you see it?')
    })

    this.bot.catch((err) => {
      console.error('[Telegram] Bot error:', err)
    })
  }

  private async handleTextMessage(ctx: Context, overrideText?: string): Promise<void> {
    if (!ctx.message || !ctx.from) return

    // Only respond to owner (private companion mode)
    if (ctx.from.id !== this.config.ownerId) {
      await ctx.reply("Sorry, I'm a private companion bot.")
      return
    }

    const content = overrideText ?? ctx.message.text ?? ''
    if (!content) return

    // Show typing action
    await ctx.replyWithChatAction('typing')

    try {
      const response = await this.config.engine.respond({
        content,
        platform: 'telegram',
        userId: String(ctx.from.id),
      })

      await this.sendResponse(ctx, response)
    } catch (err) {
      console.error('[Telegram] Error:', err)
      await ctx.reply('give me a sec... 😅')
    }
  }

  private async handleVoiceMessage(ctx: Context): Promise<void> {
    if (!ctx.message?.voice || !ctx.from) return
    if (ctx.from.id !== this.config.ownerId) return

    await ctx.replyWithChatAction('typing')

    try {
      // Download voice file
      const file = await ctx.getFile()
      const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`
      const audioResp = await fetch(fileUrl)
      const audioBuffer = Buffer.from(await audioResp.arrayBuffer())

      // Transcribe
      const transcription = await this.config.media.speechToText(audioBuffer)
      if (!transcription) {
        await ctx.reply("I couldn't quite catch that — could you type it?")
        return
      }

      // Respond to transcribed text
      const response = await this.config.engine.respond({
        content: transcription,
        platform: 'telegram',
        userId: String(ctx.from.id),
      })

      await this.sendResponse(ctx, response)
    } catch (err) {
      console.error('[Telegram] Voice error:', err)
      await ctx.reply('had trouble with that voice message...')
    }
  }

  private async sendResponse(ctx: Context, response: OutgoingMessage): Promise<void> {
    // Simulate realistic typing delay
    if (response.text) {
      const typingDuration = Math.min(500 + response.text.length * 15, 4000)
      await new Promise(r => setTimeout(r, typingDuration))
      await ctx.reply(response.text, { parse_mode: 'HTML' })
    }

    if (response.actions) {
      for (const action of response.actions) {
        await new Promise(r => setTimeout(r, 1200))

        if (action.type === 'send_image') {
          await ctx.replyWithChatAction('upload_photo')
          const isScenePhoto = action.style === 'location' && !/selfie|self-portrait/i.test(action.prompt)
          const isBodyPartCloseup = /\b(toe|toes|feet|foot|nail|nails|pedicure|hand|hands|finger|fingers|manicure|脚|脚趾|指甲|美甲|手|手指)\b/i.test(action.prompt)
          const refPath = (isScenePhoto || isBodyPartCloseup) ? undefined : this.config.engine.characterBlueprint.referenceImagePath
          const imageBuffer = await this.config.media.generateImage(
            action.prompt,
            refPath,
            action.style as ImageStyle | undefined
          )
          if (imageBuffer) {
            await ctx.replyWithPhoto(new InputFile(imageBuffer, 'photo.jpg'))
          }
        }

        if (action.type === 'send_voice') {
          await ctx.replyWithChatAction('record_voice')
          const audioBuffer = await this.config.media.textToSpeech(action.text)
          if (audioBuffer) {
            // Telegram voice messages need OGG/OPUS format
            await ctx.replyWithVoice(new InputFile(audioBuffer, 'voice.ogg'))
          }
        }

        if (action.type === 'send_video') {
          await ctx.replyWithChatAction('upload_video')
          const videoBuffer = await this.config.media.generateVideo(action.prompt)
          if (videoBuffer) {
            await ctx.replyWithVideo(new InputFile(videoBuffer, 'video.mp4'))
          }
        }
      }
    }
  }

  /**
   * Send a proactive message to the owner — called by autonomous scheduler.
   */
  async sendProactiveMessage(response: OutgoingMessage): Promise<void> {
    if (response.text) {
      await this.bot.api.sendMessage(this.config.ownerId, response.text)
    }

    if (response.actions) {
      for (const action of response.actions) {
        await new Promise(r => setTimeout(r, 1000))

        if (action.type === 'send_image') {
          const isScene = action.style === 'location' && !/selfie|self-portrait/i.test(action.prompt)
          const isBodyPart = /\b(toe|toes|feet|foot|nail|nails|pedicure|hand|hands|finger|fingers|manicure|脚|脚趾|指甲|美甲|手|手指)\b/i.test(action.prompt)
          const ref = (isScene || isBodyPart) ? undefined : this.config.engine.characterBlueprint.referenceImagePath
          const imageBuffer = await this.config.media.generateImage(
            action.prompt,
            ref,
            action.style as ImageStyle | undefined
          )
          if (imageBuffer) {
            await this.bot.api.sendPhoto(this.config.ownerId, new InputFile(imageBuffer, 'photo.jpg'))
          }
        }

        if (action.type === 'send_voice') {
          const audioBuffer = await this.config.media.textToSpeech(action.text)
          if (audioBuffer) {
            await this.bot.api.sendVoice(this.config.ownerId, new InputFile(audioBuffer, 'voice.ogg'))
          }
        }

        if (action.type === 'send_screenshot') {
          const ssAction = action as { type: 'send_screenshot'; filePath: string; caption?: string }
          try {
            const { readFileSync } = await import('fs')
            const { resolve } = await import('path')
            const resolved = resolve(ssAction.filePath)
            // Security: only allow screenshots from /tmp
            if (resolved.startsWith('/tmp/')) {
              const screenshotBuf = readFileSync(resolved)
              await this.bot.api.sendPhoto(
                this.config.ownerId,
                new InputFile(screenshotBuf, 'screenshot.png'),
                { caption: ssAction.caption }
              )
            }
          } catch (err) {
            console.error('[Telegram] Screenshot send failed:', (err as Error).message)
          }
        }
      }
    }
  }

  async start(): Promise<void> {
    console.log('[Telegram] Starting bot...')
    this.bot.start({
      onStart: (info) => console.log(`[Telegram] Logged in as @${info.username}`),
    })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }
}
