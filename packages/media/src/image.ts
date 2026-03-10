/**
 * Image Generation Engine
 *
 * Generates character selfies with visual consistency.
 * Primary: fal.ai Flux (cloud, best quality)
 * Fallback: Returns null gracefully (no crash)
 *
 * Visual consistency strategy (from clawra):
 *   - IP-Adapter reference image anchors face/style
 *   - Consistent style prefix in every prompt
 *   - Character appearance description from SOUL.md
 */

import { fal } from '@fal-ai/client'
import { readFileSync, existsSync } from 'fs'

export interface ImageConfig {
  falKey?: string
  model?: string
  defaultStyle?: string
}

export interface SelfieRequest {
  prompt: string
  referenceImagePath?: string
  characterDescription?: string
  style?: 'casual' | 'mirror' | 'close-up' | 'location'
}

export class ImageEngine {
  private config: ImageConfig

  constructor(config: ImageConfig) {
    this.config = config
    if (config.falKey) {
      fal.config({ credentials: config.falKey })
    }
  }

  /**
   * Generate a character selfie.
   * @param request - What kind of photo and any reference image path
   * @returns Buffer containing JPEG image data, or null if generation failed
   */
  async generateSelfie(request: SelfieRequest): Promise<Buffer | null> {
    if (!this.config.falKey) {
      console.warn('[Media/Image] No FAL_KEY configured — skipping image generation')
      return null
    }

    try {
      const styledPrompt = this.buildImagePrompt(request)

      // If we have a reference image, use IP-Adapter for consistency
      if (request.referenceImagePath && existsSync(request.referenceImagePath)) {
        return await this.generateWithReference(styledPrompt, request.referenceImagePath)
      }

      // Direct generation without reference
      return await this.generateDirect(styledPrompt)
    } catch (err) {
      console.error('[Media/Image] Generation failed:', err)
      return null
    }
  }

  private buildImagePrompt(request: SelfieRequest): string {
    const stylePrefix: Record<NonNullable<SelfieRequest['style']>, string> = {
      casual: 'casual selfie, natural lighting, smartphone camera, authentic',
      mirror: 'full body mirror selfie, outfit visible, good lighting',
      'close-up': 'close-up selfie, portrait, shallow depth of field, warm lighting',
      location: 'selfie at a location, environment visible in background, candid',
    }

    const prefix = stylePrefix[request.style ?? 'casual']
    const appearance = request.characterDescription ?? ''
    const mainPrompt = request.prompt

    return [
      prefix,
      appearance,
      mainPrompt,
      'photorealistic, high quality, natural, authentic',
    ].filter(Boolean).join(', ')
  }

  private async generateWithReference(prompt: string, imagePath: string): Promise<Buffer | null> {
    const imageData = readFileSync(imagePath)
    const base64Image = `data:image/jpeg;base64,${imageData.toString('base64')}`

    const result = await fal.subscribe('fal-ai/ip-adapter-face-id', {
      input: {
        prompt,
        face_image_url: base64Image,
        guidance_scale: 7.5,
        num_inference_steps: 30,
      },
    }) as unknown as { images: Array<{ url: string }> }

    if (!result.images?.[0]?.url) return null
    return await fetchImageAsBuffer(result.images[0].url)
  }

  private async generateDirect(prompt: string): Promise<Buffer | null> {
    const model = this.config.model ?? 'fal-ai/flux/dev'

    const result = await fal.subscribe(model, {
      input: {
        prompt,
        num_images: 1,
        image_size: 'portrait_4_3',
        guidance_scale: 3.5,
        num_inference_steps: 28,
      },
    }) as unknown as { images: Array<{ url: string }> }

    if (!result.images?.[0]?.url) return null
    return await fetchImageAsBuffer(result.images[0].url)
  }
}

async function fetchImageAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
