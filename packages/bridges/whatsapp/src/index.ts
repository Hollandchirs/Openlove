/**
 * WhatsApp Bridge
 *
 * Features:
 * - QR code pairing via Baileys (multi-device)
 * - Text message send/receive
 * - Image message send/receive (download + vision)
 * - Voice message send/receive (OGG/Opus, PTT, STT)
 * - Typing indicator (composing presence)
 * - Proactive message support (text, image, voice)
 * - Owner-only mode (ownerId filter)
 * - Auto-reconnect with exponential backoff (max 5 retries)
 * - Auth persistence to .whatsapp-auth/
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  downloadMediaMessage,
  getContentType,
} from '@whiskeysockets/baileys'
import * as qrcode from 'qrcode-terminal'
import { join } from 'path'
import { ConversationEngine, OutgoingMessage } from '@opencrush/core'
import { MediaEngine } from '@opencrush/media'

export interface WhatsAppBridgeConfig {
  engine: ConversationEngine
  media: MediaEngine
  ownerId?: string
  authDir?: string
}

export class WhatsAppBridge {
  private sock: WASocket | null = null
  private readonly config: WhatsAppBridgeConfig
  private readonly authDir: string
  private connected = false
  private reconnectAttempt = 0
  private static readonly MAX_RECONNECT_ATTEMPTS = 5

  constructor(config: WhatsAppBridgeConfig) {
    this.config = config
    this.authDir = config.authDir ?? join(process.cwd(), '.whatsapp-auth')
  }

  async start(): Promise<void> {
    console.log('[WhatsApp] Starting bridge...')
    await this.connect()
  }

  async stop(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined)
      this.sock = null
      this.connected = false
      console.log('[WhatsApp] Bridge stopped')
    }
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
    })

    this.sock = sock

    // QR code display for pairing
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log('[WhatsApp] Scan this QR code with your phone:')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'close') {
        this.connected = false
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        console.log(
          `[WhatsApp] Connection closed (status=${statusCode}), ` +
          `reconnecting=${shouldReconnect}`
        )

        if (shouldReconnect) {
          this.reconnectAttempt++
          if (this.reconnectAttempt > WhatsAppBridge.MAX_RECONNECT_ATTEMPTS) {
            console.error(
              `[WhatsApp] Max reconnect attempts (${WhatsAppBridge.MAX_RECONNECT_ATTEMPTS}) reached — giving up`
            )
            return
          }
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt - 1), 30_000)
          console.log(
            `[WhatsApp] Reconnecting in ${delay / 1000}s ` +
            `(attempt ${this.reconnectAttempt}/${WhatsAppBridge.MAX_RECONNECT_ATTEMPTS})`
          )
          setTimeout(() => this.connect(), delay)
        } else {
          console.log('[WhatsApp] Logged out — delete .whatsapp-auth/ to re-pair')
        }
      }

      if (connection === 'open') {
        this.connected = true
        this.reconnectAttempt = 0
        console.log('[WhatsApp] Connected successfully')
      }
    })

    // Persist auth credentials
    sock.ev.on('creds.update', saveCreds)

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        await this.handleIncomingMessage(msg)
      }
    })
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.message || !msg.key.remoteJid) return

    // Skip messages sent by us
    if (msg.key.fromMe) return

    // Skip status broadcasts
    if (msg.key.remoteJid === 'status@broadcast') return

    const jid = msg.key.remoteJid

    // Owner check: if ownerId is configured, only respond to that number
    if (this.config.ownerId) {
      const senderId = jid.replace(/@s\.whatsapp\.net$/, '')
      if (senderId !== this.config.ownerId) {
        await this.sendText(jid, "Sorry, I'm a private companion bot.")
        return
      }
    }

    // Extract text content from various message types
    const content = this.extractTextContent(msg)

    // Handle voice messages (speech-to-text)
    const contentType = getContentType(msg.message)
    if (contentType === 'audioMessage') {
      await this.handleVoiceMessage(msg, jid)
      return
    }

    // Handle image messages (download + pass to engine as attachment)
    if (contentType === 'imageMessage') {
      await this.handleImageMessage(msg, jid, content)
      return
    }

    if (!content) return

    // Show composing indicator
    await this.sendPresenceUpdate(jid, 'composing')

    try {
      const response = await this.config.engine.respond({
        content,
        platform: 'whatsapp',
        userId: jid.replace(/@s\.whatsapp\.net$/, ''),
      })

      await this.sendResponse(jid, response)
    } catch (err) {
      console.error('[WhatsApp] Error:', err)
      await this.sendText(jid, 'give me a sec... ')
    } finally {
      await this.sendPresenceUpdate(jid, 'paused')
    }
  }

  private extractTextContent(msg: proto.IWebMessageInfo): string | null {
    const message = msg.message
    if (!message) return null

    if (message.conversation) return message.conversation
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
    if (message.imageMessage?.caption) return message.imageMessage.caption
    if (message.videoMessage?.caption) return message.videoMessage.caption

    return null
  }

  private async handleVoiceMessage(
    msg: proto.IWebMessageInfo,
    jid: string,
  ): Promise<void> {
    if (!this.sock) return

    await this.sendPresenceUpdate(jid, 'composing')

    try {
      const audioBuffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
      ) as Buffer

      if (!audioBuffer || audioBuffer.length === 0) {
        await this.sendText(jid, "I couldn't quite catch that — could you type it?")
        return
      }

      const transcription = await this.config.media.speechToText(audioBuffer)
      if (!transcription) {
        await this.sendText(jid, "I couldn't quite catch that — could you type it?")
        return
      }

      const response = await this.config.engine.respond({
        content: transcription,
        platform: 'whatsapp',
        userId: jid.replace(/@s\.whatsapp\.net$/, ''),
      })

      await this.sendResponse(jid, response)
    } catch (err) {
      console.error('[WhatsApp] Voice error:', err)
      await this.sendText(jid, 'had trouble with that voice message...')
    } finally {
      await this.sendPresenceUpdate(jid, 'paused')
    }
  }

  private async handleImageMessage(
    msg: proto.IWebMessageInfo,
    jid: string,
    caption: string | null,
  ): Promise<void> {
    if (!this.sock) return

    await this.sendPresenceUpdate(jid, 'composing')

    try {
      const imageBuffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
      ) as Buffer

      if (!imageBuffer || imageBuffer.length === 0) {
        await this.sendText(jid, "I couldn't see that image — could you try again?")
        return
      }

      const mimetype = msg.message?.imageMessage?.mimetype ?? 'image/jpeg'

      const response = await this.config.engine.respond({
        content: caption || '(sent an image)',
        platform: 'whatsapp',
        userId: jid.replace(/@s\.whatsapp\.net$/, ''),
        attachments: [{
          type: 'image',
          url: '',
          base64: imageBuffer.toString('base64'),
          mediaType: mimetype,
        }],
      })

      await this.sendResponse(jid, response)
    } catch (err) {
      console.error('[WhatsApp] Image error:', err)
      await this.sendText(jid, 'had trouble with that image...')
    } finally {
      await this.sendPresenceUpdate(jid, 'paused')
    }
  }

  private async sendResponse(jid: string, response: OutgoingMessage): Promise<void> {
    if (!this.sock) return

    // Simulate realistic typing delay
    if (response.text) {
      const typingDuration = Math.min(500 + response.text.length * 15, 4000)
      await new Promise(r => setTimeout(r, typingDuration))
      await this.sendText(jid, response.text)
    }

    if (!response.actions) return

    for (const action of response.actions) {
      await new Promise(r => setTimeout(r, 1200))

      if (action.type === 'send_image') {
        await this.sendPresenceUpdate(jid, 'composing')
        const isScenePhoto = action.style === 'location' &&
          !/selfie|self-portrait/i.test(action.prompt)
        const isBodyPartCloseup = /\b(toe|toes|feet|foot|nail|nails|pedicure|hand|hands|finger|fingers|manicure)\b/i.test(action.prompt)
        const refPath = (isScenePhoto || isBodyPartCloseup)
          ? undefined
          : this.config.engine.characterBlueprint.referenceImagePath

        const imageBuffer = await this.config.media.generateImage(
          action.prompt,
          refPath,
          action.style,
        )
        if (imageBuffer) {
          await this.sendImage(jid, imageBuffer)
        }
      }

      if (action.type === 'send_voice') {
        await this.sendPresenceUpdate(jid, 'recording')
        const audioBuffer = await this.config.media.textToSpeech(action.text)
        if (audioBuffer) {
          await this.sendVoice(jid, audioBuffer)
        }
      }

      if (action.type === 'send_video') {
        await this.sendPresenceUpdate(jid, 'composing')
        const videoBuffer = await this.config.media.generateVideo(action.prompt)
        if (videoBuffer) {
          await this.sendVideo(jid, videoBuffer)
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
            await this.sendImage(jid, screenshotBuf, ssAction.caption)
          }
        } catch (err) {
          console.error('[WhatsApp] Screenshot send failed:', (err as Error).message)
        }
      }
    }

    await this.sendPresenceUpdate(jid, 'paused')
  }

  /**
   * Send a proactive message to the owner — called by autonomous scheduler.
   */
  async sendProactiveMessage(response: OutgoingMessage): Promise<void> {
    if (!this.sock || !this.connected || !this.config.ownerId) return

    const jid = `${this.config.ownerId}@s.whatsapp.net`
    await this.sendResponse(jid, response)
  }

  // ── Low-level send helpers ──────────────────────────────────

  private async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) return
    await this.sock.sendMessage(jid, { text })
  }

  private async sendImage(jid: string, buffer: Buffer, caption?: string): Promise<void> {
    if (!this.sock) return
    await this.sock.sendMessage(jid, {
      image: buffer,
      caption,
      mimetype: 'image/jpeg',
    })
  }

  private async sendVoice(jid: string, buffer: Buffer): Promise<void> {
    if (!this.sock) return
    await this.sock.sendMessage(jid, {
      audio: buffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    })
  }

  private async sendVideo(jid: string, buffer: Buffer): Promise<void> {
    if (!this.sock) return
    await this.sock.sendMessage(jid, {
      video: buffer,
      mimetype: 'video/mp4',
    })
  }

  private async sendPresenceUpdate(
    jid: string,
    type: 'composing' | 'recording' | 'paused',
  ): Promise<void> {
    if (!this.sock) return
    try {
      await this.sock.sendPresenceUpdate(type, jid)
    } catch {
      // Presence updates are best-effort
    }
  }
}
