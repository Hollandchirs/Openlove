/**
 * Video Generation Engine
 *
 * Generates short video clips via fal.ai (Wan2.1 model).
 * Used for: "sending a clip of something she's watching", mood videos, selfie videos.
 */

import { fal } from '@fal-ai/client'

export interface VideoConfig {
  falKey?: string
  model?: string
}

export class VideoEngine {
  private config: VideoConfig

  constructor(config: VideoConfig) {
    this.config = config
    if (config.falKey) {
      fal.config({ credentials: config.falKey })
    }
  }

  /**
   * Generate a short video clip (3-8 seconds).
   * Returns MP4 buffer, or null if unavailable.
   */
  async generateClip(prompt: string): Promise<Buffer | null> {
    if (!this.config.falKey) {
      console.warn('[Media/Video] No FAL_KEY configured — skipping video generation')
      return null
    }

    try {
      const model = this.config.model ?? 'fal-ai/wan/v2.1/1.3b/text-to-video'

      const result = await fal.subscribe(model, {
        input: {
          prompt: `${prompt}, cinematic, high quality, natural lighting`,
          num_frames: 81,  // ~3 seconds at 27fps
          resolution: '480p',
          aspect_ratio: '9:16',  // vertical for mobile feel
        },
      }) as unknown as { video: { url: string } }

      if (!result.video?.url) return null

      const response = await fetch(result.video.url)
      const arrayBuffer = await response.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (err) {
      console.error('[Media/Video] Generation failed:', err)
      return null
    }
  }
}
