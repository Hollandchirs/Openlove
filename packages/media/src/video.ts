/**
 * Video Generation Engine
 *
 * Two-step pipeline for character-consistent video:
 *   1. Generate a still frame with PuLID (face-consistent with reference)
 *   2. Animate the frame with Wan 2.1 image-to-video
 *
 * Model hierarchy:
 *   1. PuLID still -> fal-ai/wan-i2v -- face-consistent, ~$0.10, ~45s
 *   2. fal-ai/wan-t2v -- text-only fallback (no face consistency)
 *
 * All videos are silent (no audio). Audio not supported by Wan models.
 *
 * Uses direct REST API (queue.fal.run) instead of @fal-ai/client SDK.
 * Direct REST polls every 2s and avoids the SDK's slower polling intervals,
 * saving ~12s per generation and reducing timeout-related retry risk.
 */

import { readFileSync, existsSync, appendFileSync } from 'fs'

function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  console.log(msg)
  try { appendFileSync('/tmp/opencrush-debug.log', line) } catch { /* ignore */ }
}

/**
 * Direct REST API call to fal.ai queue -- faster than SDK subscribe.
 * Polls every 2s with a 5-minute timeout (video generation is slow).
 */
async function falQueueRun(
  model: string,
  input: Record<string, unknown>,
  falKey: string
): Promise<Record<string, unknown>> {
  const submitResp = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!submitResp.ok) {
    const errText = await submitResp.text()
    throw new Error(`FAL submit failed (${submitResp.status}): ${errText.slice(0, 300)}`)
  }

  const { request_id: requestId } = await submitResp.json() as { request_id: string }
  debugLog(`[Media/Video] FAL queued: model=${model} request_id=${requestId}`)

  const maxWait = 300_000 // 5 min timeout for video
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const statusResp = await fetch(
      `https://queue.fal.run/${model}/requests/${requestId}/status`,
      { headers: { 'Authorization': `Key ${falKey}` } }
    )
    const status = await statusResp.json() as { status: string }

    if (status.status === 'COMPLETED') {
      const resultResp = await fetch(
        `https://queue.fal.run/${model}/requests/${requestId}`,
        { headers: { 'Authorization': `Key ${falKey}` } }
      )
      return await resultResp.json() as Record<string, unknown>
    }

    if (status.status === 'FAILED') {
      throw new Error(`FAL job failed: ${JSON.stringify(status)}`)
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  throw new Error(`FAL video job timed out after ${maxWait / 1000}s`)
}

/**
 * Module-level cache for prepared reference images.
 * Avoids re-reading from disk and re-encoding to base64 on every
 * video generation call. TTL: 30 minutes.
 */
const refImageCache = new Map<string, { dataUri: string; timestamp: number }>()
const REF_IMAGE_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/** Remove expired entries from a TTL cache on each access. */
function cleanExpiredEntries<V extends { timestamp: number }>(
  cache: Map<string, V>,
  ttl: number
): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= ttl) {
      cache.delete(key)
    }
  }
}

export interface VideoConfig {
  falKey?: string
  model?: string
  referenceImagePath?: string
}

export class VideoEngine {
  private config: VideoConfig

  constructor(config: VideoConfig) {
    this.config = config
  }

  /**
   * Generate a short video clip with character consistency.
   *
   * Pipeline:
   *   1. If reference image -> PuLID still frame -> Wan i2v animate
   *   2. No reference -> wan-t2v text-to-video (random face)
   */
  async generateClip(prompt: string): Promise<Buffer | null> {
    if (!this.config.falKey) {
      console.warn('[Media/Video] No FAL_KEY configured -- skipping video generation')
      return null
    }

    try {
      const hasRef = this.config.referenceImagePath && existsSync(this.config.referenceImagePath)

      if (hasRef) {
        debugLog(`[Media/Video] Using reference pipeline (PuLID still -> Wan i2v)`)
        return await this.generateWithReference(prompt)
      }

      debugLog(`[Media/Video] No reference image, using text-to-video`)
      return await this.generateTextToVideo(prompt)
    } catch (err) {
      debugLog(`[Media/Video] Generation FAILED: ${err instanceof Error ? err.stack : err}`)
      return null
    }
  }

  /**
   * Prepare reference image with caching.
   * Reads from disk and converts to base64 data URI, caching the result
   * for 30 minutes to avoid redundant disk reads.
   */
  private prepareReferenceImage(refPath: string): string {
    // Evict stale entries on each access
    cleanExpiredEntries(refImageCache, REF_IMAGE_CACHE_TTL)

    const cached = refImageCache.get(refPath)
    if (cached && Date.now() - cached.timestamp < REF_IMAGE_CACHE_TTL) {
      debugLog(`[Media/Video] Using cached reference for ${refPath}`)
      return cached.dataUri
    }

    const imageData = readFileSync(refPath)
    const ext = refPath.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const dataUri = `data:${mime};base64,${imageData.toString('base64')}`

    refImageCache.set(refPath, { dataUri, timestamp: Date.now() })
    debugLog(`[Media/Video] Reference cached: ${imageData.length} bytes -> data URI`)
    return dataUri
  }

  /**
   * Step 1: PuLID still frame (face-consistent)
   * Step 2: Wan i2v animate
   */
  private async generateWithReference(prompt: string): Promise<Buffer | null> {
    const refPath = this.config.referenceImagePath!
    const base64Image = this.prepareReferenceImage(refPath)

    // Step 1: Generate still frame with PuLID
    debugLog(`[Media/Video] Step 1: PuLID still frame...`)

    let stillUrl: string | null = null
    try {
      const stillResult = await falQueueRun('fal-ai/flux-pulid', {
        prompt: `${prompt}, cinematic still frame, volumetric lighting, shallow depth of field, warm color grading, film grain, ultra detailed`,
        reference_image_url: base64Image,
        image_size: 'portrait_4_3',
        guidance_scale: 5.5,
        num_inference_steps: 28,
        id_weight: 0.7,
      }, this.config.falKey!)

      stillUrl = (stillResult?.images as Array<{ url?: string }> | undefined)?.[0]?.url
        ?? (stillResult?.image as { url?: string } | undefined)?.url
        ?? null
    } catch (err) {
      debugLog(`[Media/Video] PuLID still FAILED: ${err instanceof Error ? err.message : err}`)
    }

    if (!stillUrl) {
      debugLog(`[Media/Video] PuLID still frame failed. Falling back to text-to-video.`)
      return await this.generateTextToVideo(prompt)
    }

    debugLog(`[Media/Video] Step 1 done: ${stillUrl.slice(0, 80)}...`)

    // Step 2: Animate with Wan i2v
    return await this.animateWithWan(prompt, stillUrl)
  }

  /**
   * Wan i2v: image-to-video, 3s clip, ~$0.10.
   */
  private async animateWithWan(prompt: string, imageUrl: string): Promise<Buffer | null> {
    try {
      debugLog(`[Media/Video] Step 2: Wan i2v animate...`)

      const result = await falQueueRun('fal-ai/wan-i2v', {
        prompt: `${prompt}, subtle natural movement, gentle breathing, slight smile, hair sway, cinematic, volumetric lighting, smooth motion`,
        image_url: imageUrl,
        num_frames: 81,
        resolution: '480p',
        aspect_ratio: '9:16',
      }, this.config.falKey!)

      debugLog(`[Media/Video] Wan i2v result keys: ${JSON.stringify(Object.keys(result))}`)
      return await this.extractVideoBuffer(result)
    } catch (err) {
      debugLog(`[Media/Video] Wan i2v error: ${err instanceof Error ? err.message : err}`)
      return null
    }
  }

  /**
   * Fallback: pure text-to-video (no face consistency).
   */
  private async generateTextToVideo(prompt: string): Promise<Buffer | null> {
    const model = this.config.model ?? 'fal-ai/wan-t2v'
    debugLog(`[Media/Video] Text-to-video: ${model}`)

    const result = await falQueueRun(model, {
      prompt: `${prompt}, cinematic, high quality, natural lighting`,
      num_frames: 81,
      resolution: '480p',
      aspect_ratio: '9:16',
    }, this.config.falKey!)

    return await this.extractVideoBuffer(result)
  }

  private async extractVideoBuffer(result: Record<string, unknown>): Promise<Buffer | null> {
    const videoUrl = (result?.video as { url?: string } | undefined)?.url
      ?? (result?.videos as Array<{ url?: string }> | undefined)?.[0]?.url
      ?? null

    if (!videoUrl) {
      debugLog(`[Media/Video] No video URL: ${JSON.stringify(result).slice(0, 500)}`)
      return null
    }

    // Download with retry (fal CDN can be slow/flaky)
    const maxRetries = 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        debugLog(`[Media/Video] Downloading (attempt ${attempt}): ${videoUrl.slice(0, 80)}...`)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 60_000) // 60s timeout for video
        const response = await fetch(videoUrl, { signal: controller.signal })
        clearTimeout(timeout)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        debugLog(`[Media/Video] Downloaded: ${buffer.length} bytes`)
        return buffer
      } catch (err) {
        debugLog(`[Media/Video] Download attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`)
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt)) // backoff
        }
      }
    }

    debugLog(`[Media/Video] All ${maxRetries} download attempts failed`)
    return null
  }
}
