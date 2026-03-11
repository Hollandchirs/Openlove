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
  aspectRatio?: '4:5' | '9:16'
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
      const imageSize = this.getImageSize(request)

      // If we have a reference image, use IP-Adapter for consistency
      if (request.referenceImagePath && existsSync(request.referenceImagePath)) {
        return await this.generateWithReference(styledPrompt, request.referenceImagePath, imageSize)
      }

      // Direct generation without reference
      return await this.generateDirect(styledPrompt, imageSize)
    } catch (err) {
      console.error('[Media/Image] Generation failed:', err)
      return null
    }
  }

  private buildImagePrompt(request: SelfieRequest): string {
    const stylePrefix: Record<NonNullable<SelfieRequest['style']>, string> = {
      casual: 'casual selfie shot on iPhone, natural lighting, smartphone camera, authentic, raw photo',
      mirror: 'full body mirror selfie shot on iPhone, outfit visible, natural lighting, raw photo',
      'close-up': 'close-up selfie portrait shot on iPhone, shallow depth of field, warm natural lighting, raw photo',
      location: 'selfie at a location shot on iPhone, environment visible, candid, natural, raw photo',
    }

    const prefix = stylePrefix[request.style ?? 'casual']
    const appearance = request.characterDescription ?? ''
    const mainPrompt = request.prompt

    return [
      prefix,
      appearance,
      mainPrompt,
      'shot on iPhone 15 Pro, raw photo, ultra realistic, natural skin texture, no AI artifacts, authentic',
    ].filter(Boolean).join(', ')
  }

  private getImageSize(request: SelfieRequest): { width: number; height: number } {
    const ratio = request.aspectRatio ?? this.defaultRatioForStyle(request.style)
    switch (ratio) {
      case '9:16': return { width: 576, height: 1024 }
      case '4:5':  return { width: 832, height: 1040 }
      default:     return { width: 832, height: 1040 }
    }
  }

  private defaultRatioForStyle(style?: string): '4:5' | '9:16' {
    switch (style) {
      case 'mirror':   return '9:16'
      case 'location': return '9:16'
      case 'casual':   return '4:5'
      case 'close-up': return '4:5'
      default:         return '4:5'
    }
  }

  private async generateWithReference(prompt: string, imagePath: string, imageSize: { width: number; height: number }): Promise<Buffer | null> {
    const imageData = readFileSync(imagePath)
    const base64Image = `data:image/jpeg;base64,${imageData.toString('base64')}`

    const result = await fal.subscribe('fal-ai/ip-adapter-face-id', {
      input: {
        prompt,
        face_image_url: base64Image,
        guidance_scale: 7.5,
        num_inference_steps: 30,
        width: imageSize.width,
        height: imageSize.height,
      },
    }) as unknown as { images: Array<{ url: string }> }

    if (!result.images?.[0]?.url) return null
    return await fetchImageAsBuffer(result.images[0].url)
  }

  private async generateDirect(prompt: string, imageSize: { width: number; height: number }): Promise<Buffer | null> {
    const model = this.config.model ?? 'fal-ai/flux-realism'

    const result = await fal.subscribe(model, {
      input: {
        prompt,
        num_images: 1,
        image_size: imageSize,
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
