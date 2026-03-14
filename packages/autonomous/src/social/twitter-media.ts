/**
 * Twitter Media Upload
 *
 * Handles image and video upload to Twitter via the v1.1 media/upload endpoint.
 * Uses OAuth 2.0 Bearer token (compatible with Free tier).
 *
 * Image: simple base64 upload
 * Video: chunked upload (INIT → APPEND → FINALIZE → STATUS polling)
 */

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json'
const MAX_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB per chunk

export interface MediaUploadResult {
  mediaId: string
  success: boolean
  error?: string
}

/**
 * Upload an image buffer to Twitter.
 * Returns media_id_string for use in tweet creation.
 */
export async function uploadImageToTwitter(
  imageBuffer: Buffer,
  accessToken: string
): Promise<MediaUploadResult> {
  console.log(`[Twitter/Media] Uploading image (${(imageBuffer.length / 1024).toFixed(1)} KB)...`)

  // Try chunked upload first (more reliable for larger files), fallback to simple upload
  const result = await uploadImageChunked(imageBuffer, accessToken)
  if (result.success) return result

  console.log(`[Twitter/Media] Chunked upload failed (${result.error}), trying simple upload...`)
  return uploadImageSimple(imageBuffer, accessToken)
}

/** Simple base64 upload — works for small images (<5MB) */
async function uploadImageSimple(
  imageBuffer: Buffer,
  accessToken: string
): Promise<MediaUploadResult> {
  try {
    const base64Data = imageBuffer.toString('base64')

    const formBody = new URLSearchParams({
      media_data: base64Data,
      media_category: 'tweet_image',
    })

    const resp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    })

    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[Twitter/Media] Simple upload failed (${resp.status}): ${text}`)
      return { mediaId: '', success: false, error: `Upload failed (${resp.status}): ${text}` }
    }

    const data = await resp.json() as { media_id_string?: string }
    if (!data.media_id_string) {
      console.error('[Twitter/Media] Simple upload: no media_id in response', data)
      return { mediaId: '', success: false, error: 'No media_id in response' }
    }

    console.log(`[Twitter/Media] Image uploaded (simple): ${data.media_id_string}`)
    return { mediaId: data.media_id_string, success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Twitter/Media] Simple upload error: ${msg}`)
    return { mediaId: '', success: false, error: msg }
  }
}

/** Chunked upload — INIT → APPEND → FINALIZE (works for all sizes, more reliable) */
async function uploadImageChunked(
  imageBuffer: Buffer,
  accessToken: string
): Promise<MediaUploadResult> {
  try {
    // INIT
    const initBody = new URLSearchParams({
      command: 'INIT',
      total_bytes: imageBuffer.length.toString(),
      media_type: 'image/png',
      media_category: 'tweet_image',
    })

    const initResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: initBody.toString(),
    })

    if (!initResp.ok) {
      const text = await initResp.text()
      return { mediaId: '', success: false, error: `INIT failed (${initResp.status}): ${text}` }
    }

    const initData = await initResp.json() as { media_id_string?: string }
    const mediaId = initData.media_id_string
    if (!mediaId) {
      return { mediaId: '', success: false, error: 'No media_id from INIT' }
    }

    console.log(`[Twitter/Media] Image INIT: ${mediaId}`)

    // APPEND (single chunk for images)
    const formData = new FormData()
    formData.append('command', 'APPEND')
    formData.append('media_id', mediaId)
    formData.append('segment_index', '0')
    formData.append('media', new Blob([imageBuffer], { type: 'image/png' }), 'image.png')

    const appendResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: formData,
    })

    if (!appendResp.ok && appendResp.status !== 204) {
      const text = await appendResp.text()
      return { mediaId: '', success: false, error: `APPEND failed (${appendResp.status}): ${text}` }
    }

    console.log(`[Twitter/Media] Image APPEND: ${imageBuffer.length} bytes`)

    // FINALIZE
    const finalizeBody = new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    })

    const finalizeResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: finalizeBody.toString(),
    })

    if (!finalizeResp.ok) {
      const text = await finalizeResp.text()
      return { mediaId: '', success: false, error: `FINALIZE failed (${finalizeResp.status}): ${text}` }
    }

    console.log(`[Twitter/Media] Image uploaded (chunked): ${mediaId}`)
    return { mediaId, success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { mediaId: '', success: false, error: msg }
  }
}

/**
 * Upload a video buffer to Twitter using chunked upload protocol.
 * Returns media_id_string after processing completes.
 */
export async function uploadVideoToTwitter(
  videoBuffer: Buffer,
  accessToken: string
): Promise<MediaUploadResult> {
  try {
    // Step 1: INIT
    const initBody = new URLSearchParams({
      command: 'INIT',
      total_bytes: videoBuffer.length.toString(),
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    })

    const initResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: initBody.toString(),
    })

    if (!initResp.ok) {
      const text = await initResp.text()
      return { mediaId: '', success: false, error: `INIT failed (${initResp.status}): ${text}` }
    }

    const initData = await initResp.json() as { media_id_string?: string }
    const mediaId = initData.media_id_string
    if (!mediaId) {
      return { mediaId: '', success: false, error: 'No media_id from INIT' }
    }

    console.log(`[Twitter/Media] Video INIT: ${mediaId}`)

    // Step 2: APPEND (chunked)
    let segmentIndex = 0
    let offset = 0

    while (offset < videoBuffer.length) {
      const end = Math.min(offset + MAX_CHUNK_SIZE, videoBuffer.length)
      const chunk = videoBuffer.subarray(offset, end)

      const formData = new FormData()
      formData.append('command', 'APPEND')
      formData.append('media_id', mediaId)
      formData.append('segment_index', segmentIndex.toString())
      formData.append('media_data', chunk.toString('base64'))

      const appendResp = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        body: formData,
      })

      if (!appendResp.ok && appendResp.status !== 204) {
        const text = await appendResp.text()
        return { mediaId: '', success: false, error: `APPEND segment ${segmentIndex} failed: ${text}` }
      }

      console.log(`[Twitter/Media] Video APPEND segment ${segmentIndex} (${chunk.length} bytes)`)
      offset = end
      segmentIndex += 1
    }

    // Step 3: FINALIZE
    const finalizeBody = new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    })

    const finalizeResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: finalizeBody.toString(),
    })

    if (!finalizeResp.ok) {
      const text = await finalizeResp.text()
      return { mediaId: '', success: false, error: `FINALIZE failed: ${text}` }
    }

    const finalizeData = await finalizeResp.json() as {
      processing_info?: { state: string; check_after_secs?: number }
    }

    // Step 4: Poll STATUS until processing completes
    if (finalizeData.processing_info) {
      const pollResult = await waitForMediaProcessing(mediaId, accessToken)
      if (!pollResult.success) {
        return pollResult
      }
    }

    console.log(`[Twitter/Media] Video uploaded: ${mediaId}`)
    return { mediaId, success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { mediaId: '', success: false, error: msg }
  }
}

/**
 * Poll the STATUS endpoint until video processing completes.
 * Uses exponential backoff starting from check_after_secs.
 */
async function waitForMediaProcessing(
  mediaId: string,
  accessToken: string,
  maxAttempts = 30
): Promise<MediaUploadResult> {
  let waitSecs = 5

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(waitSecs * 1000)

    const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`
    const resp = await fetch(statusUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })

    if (!resp.ok) {
      const text = await resp.text()
      return { mediaId, success: false, error: `STATUS check failed: ${text}` }
    }

    const data = await resp.json() as {
      processing_info?: { state: string; check_after_secs?: number; error?: { message: string } }
    }

    const info = data.processing_info
    if (!info) {
      // No processing_info means done
      return { mediaId, success: true }
    }

    if (info.state === 'succeeded') {
      return { mediaId, success: true }
    }

    if (info.state === 'failed') {
      return { mediaId, success: false, error: `Processing failed: ${info.error?.message ?? 'unknown'}` }
    }

    // state === 'pending' or 'in_progress'
    waitSecs = info.check_after_secs ?? Math.min(waitSecs * 1.5, 30)
    console.log(`[Twitter/Media] Video processing... (attempt ${attempt + 1}, wait ${waitSecs}s)`)
  }

  return { mediaId, success: false, error: 'Processing timed out' }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
