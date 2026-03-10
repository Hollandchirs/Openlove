/**
 * Voice Engine
 *
 * TTS (Text-to-Speech):
 *   Primary: ElevenLabs (most natural, emotional)
 *   Fallback: Edge TTS via msedge-tts (free, no API key)
 *
 * STT (Speech-to-Text):
 *   Primary: OpenAI Whisper API
 *   Fallback: Returns null (user must type)
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import OpenAI, { toFile } from 'openai'

export interface VoiceConfig {
  elevenLabsApiKey?: string
  elevenLabsVoiceId?: string
  openaiApiKey?: string
  provider?: 'elevenlabs' | 'edge-tts'
  // Edge TTS voice name (free, no API key)
  // Browse voices: https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4
  edgeTtsVoice?: string
}

export class VoiceEngine {
  private config: VoiceConfig
  private openai?: OpenAI
  private edgeTTS: MsEdgeTTS

  constructor(config: VoiceConfig) {
    this.config = config
    this.edgeTTS = new MsEdgeTTS()

    if (config.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openaiApiKey })
    }
  }

  /**
   * Convert text to speech audio buffer.
   * Returns MP3/OGG buffer, or null if TTS unavailable.
   */
  async textToSpeech(text: string): Promise<Buffer | null> {
    // Sanitize text (remove markdown, action tags)
    const cleanText = sanitizeForSpeech(text)
    if (!cleanText) return null

    const provider = this.resolveProvider()

    switch (provider) {
      case 'elevenlabs':
        return this.elevenLabsTTS(cleanText)
      case 'edge-tts':
        return this.edgeTtsSynthesize(cleanText)
    }
  }

  private resolveProvider(): 'elevenlabs' | 'edge-tts' {
    if (this.config.provider === 'elevenlabs' && this.config.elevenLabsApiKey) {
      return 'elevenlabs'
    }
    return 'edge-tts'
  }

  private async elevenLabsTTS(text: string): Promise<Buffer | null> {
    if (!this.config.elevenLabsApiKey) return null

    try {
      const voiceId = this.config.elevenLabsVoiceId ?? '21m00Tcm4TlvDq8ikWAM' // Rachel (default)

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.config.elevenLabsApiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              style: 0.2,
              use_speaker_boost: true,
            },
          }),
        }
      )

      if (!response.ok) {
        console.error('[Voice/ElevenLabs] API error:', response.statusText)
        return this.edgeTtsSynthesize(text) // fallback
      }

      const arrayBuffer = await response.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (err) {
      console.error('[Voice/ElevenLabs] Error:', err)
      return this.edgeTtsSynthesize(text)
    }
  }

  private async edgeTtsSynthesize(text: string): Promise<Buffer | null> {
    try {
      // Default to a natural-sounding female voice
      const voice = this.config.edgeTtsVoice ?? 'en-US-JennyNeural'
      await this.edgeTTS.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const readable = this.edgeTTS.toStream(text)
        readable.on('data', (chunk: Buffer) => chunks.push(chunk))
        readable.on('end', () => resolve(Buffer.concat(chunks)))
        readable.on('error', reject)
      })
    } catch (err) {
      console.error('[Voice/EdgeTTS] Error:', err)
      return null
    }
  }

  /**
   * Transcribe audio to text using Whisper.
   * Input: audio buffer (any format Whisper supports)
   * Returns: transcribed text, or null if unavailable
   */
  async speechToText(audioBuffer: Buffer): Promise<string | null> {
    if (!this.openai) {
      console.warn('[Voice/STT] No OpenAI API key — STT unavailable')
      return null
    }

    try {
      const file = await toFile(audioBuffer, 'audio.ogg', { type: 'audio/ogg' })

      const response = await this.openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'en',
      })

      return response.text || null
    } catch (err) {
      console.error('[Voice/STT] Whisper error:', err)
      return null
    }
  }
}

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/\[SELFIE:[^\]]*\]/gi, '')
    .replace(/\[VOICE:[^\]]*\]/gi, '')
    .replace(/\[VIDEO:[^\]]*\]/gi, '')
    .replace(/[*_`~#]/g, '')  // remove markdown
    .replace(/https?:\/\/\S+/g, '')  // remove URLs
    .trim()
}
