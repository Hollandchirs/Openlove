/**
 * Media Engine
 *
 * Unified interface for all media generation:
 * - Images (selfies, consistent appearance)
 * - Video (short clips)
 * - TTS (voice messages)
 * - STT (transcribe user voice)
 */

import { ImageEngine, ImageConfig } from './image.js'
import { VoiceEngine, VoiceConfig } from './voice.js'
import { VideoEngine, VideoConfig } from './video.js'

export interface MediaConfig {
  image: ImageConfig
  voice: VoiceConfig
  video: VideoConfig
}

export class MediaEngine {
  private imageEngine: ImageEngine
  private voiceEngine: VoiceEngine
  private videoEngine: VideoEngine

  constructor(config: MediaConfig) {
    this.imageEngine = new ImageEngine(config.image)
    this.voiceEngine = new VoiceEngine(config.voice)
    this.videoEngine = new VideoEngine(config.video)
  }

  async generateImage(prompt: string, referenceImagePath?: string): Promise<Buffer | null> {
    // Randomly pick style and aspect ratio to simulate natural phone usage
    const styles: Array<'casual' | 'mirror' | 'close-up' | 'location'> = ['casual', 'mirror', 'close-up', 'location']
    const style = styles[Math.floor(Math.random() * styles.length)]
    // 70% chance 4:5 (portrait), 30% chance 9:16 (full body vertical)
    const aspectRatio: '4:5' | '9:16' = Math.random() < 0.7 ? '4:5' : '9:16'

    return this.imageEngine.generateSelfie({
      prompt,
      referenceImagePath,
      style,
      aspectRatio,
    })
  }

  async textToSpeech(text: string): Promise<Buffer | null> {
    return this.voiceEngine.textToSpeech(text)
  }

  async speechToText(audioBuffer: Buffer): Promise<string | null> {
    return this.voiceEngine.speechToText(audioBuffer)
  }

  async generateVideo(prompt: string): Promise<Buffer | null> {
    return this.videoEngine.generateClip(prompt)
  }
}

export { ImageEngine, VoiceEngine, VideoEngine }
export type { ImageConfig, VoiceConfig, VideoConfig }
