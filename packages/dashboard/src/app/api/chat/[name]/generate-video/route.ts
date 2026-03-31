import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { CHARACTERS_DIR, ENV_PATH, readEnvCached } from "@/lib/repo-root";
import { engineCache } from "@/lib/engine-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cached IDENTITY.md reader -- avoids re-reading on every request.
 * TTL: 10 minutes.
 */
const identityCache = new Map<string, { content: string; timestamp: number }>();
const IDENTITY_CACHE_TTL = 10 * 60 * 1000;

/** Remove expired entries from a TTL cache on each access. */
function cleanExpiredEntries<V extends { timestamp: number }>(
  cache: Map<string, V>,
  ttl: number
): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= ttl) {
      cache.delete(key);
    }
  }
}

function readIdentityCached(identityPath: string): string {
  cleanExpiredEntries(identityCache, IDENTITY_CACHE_TTL);
  const cached = identityCache.get(identityPath);
  if (cached && Date.now() - cached.timestamp < IDENTITY_CACHE_TTL) {
    return cached.content;
  }
  const content = readFileSync(identityPath, "utf-8");
  identityCache.set(identityPath, { content, timestamp: Date.now() });
  return content;
}

// ── Extract appearance from IDENTITY.md ─────────────────────────────────

function extractAppearance(identityContent: string): string {
  const lines = identityContent.split("\n");
  let inAppearance = false;
  const appearanceLines: string[] = [];

  for (const line of lines) {
    if (/^##\s+Appearance/i.test(line)) {
      inAppearance = true;
      continue;
    }
    if (inAppearance && /^##\s+/.test(line)) {
      break;
    }
    if (inAppearance) {
      appearanceLines.push(line);
    }
  }

  return appearanceLines.join(" ").replace(/\s+/g, " ").trim();
}

// ── fal.ai queue runner ─────────────────────────────────────────────────

/**
 * Queue-based fal.ai endpoint — video models require queue (long processing).
 * Polls every 2s with a 5-minute timeout (video generation is slower than images).
 */
async function falQueueRun(
  model: string,
  input: Record<string, unknown>,
  falKey: string
): Promise<Record<string, unknown>> {
  const submitResp = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(
      `FAL submit failed (${submitResp.status}): ${errText.slice(0, 300)}`
    );
  }

  const { request_id: requestId } = (await submitResp.json()) as {
    request_id: string;
  };

  console.log(`[generate-video] FAL queued: model=${model} request_id=${requestId}`);

  // Video generation takes 30-120s typically; allow up to 5 minutes
  const maxWait = 300_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const statusResp = await fetch(
      `https://queue.fal.run/${model}/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${falKey}` } }
    );
    const status = (await statusResp.json()) as { status: string };

    if (status.status === "COMPLETED") {
      const resultResp = await fetch(
        `https://queue.fal.run/${model}/requests/${requestId}`,
        { headers: { Authorization: `Key ${falKey}` } }
      );
      return (await resultResp.json()) as Record<string, unknown>;
    }

    if (status.status === "FAILED") {
      throw new Error(`FAL job failed: ${JSON.stringify(status)}`);
    }

    // Poll every 2s (video is slower than images)
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(`FAL video job timed out after ${maxWait / 1000}s`);
}

// ── Extract video URL from fal.ai result ────────────────────────────────

function extractVideoUrl(result: Record<string, unknown>): string | null {
  // Wan models return { video: { url } }
  const video = result?.video as { url?: string } | undefined;
  if (video?.url) return video.url;

  // Some models may return { videos: [{ url }] }
  const videos = result?.videos as Array<{ url?: string }> | undefined;
  if (videos?.[0]?.url) return videos[0].url;

  // Nested under data wrapper
  const data = result?.data as Record<string, unknown> | undefined;
  if (data) {
    const dataVideo = data.video as { url?: string } | undefined;
    if (dataVideo?.url) return dataVideo.url;
    const dataVideos = data.videos as Array<{ url?: string }> | undefined;
    if (dataVideos?.[0]?.url) return dataVideos[0].url;
  }

  return null;
}

// ── Download video buffer with retry ────────────────────────────────────

async function downloadVideoBuffer(videoUrl: string): Promise<Buffer> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[generate-video] Downloading (attempt ${attempt}): ${videoUrl.slice(0, 80)}...`
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout for video
      const response = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`[generate-video] Downloaded: ${buffer.length} bytes`);
      return buffer;
    } catch (err) {
      console.warn(
        `[generate-video] Download attempt ${attempt} failed: ${
          err instanceof Error ? err.message : err
        }`
      );
      if (attempt >= maxRetries) {
        throw new Error(
          `All ${maxRetries} download attempts failed for video`
        );
      }
      // Exponential backoff
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Download failed");
}

// ── Reference image preparation ─────────────────────────────────────────

/** Max size in bytes for inline data URI — above this, upload to fal CDN */
const MAX_INLINE_SIZE = 500_000;

/**
 * Upload an image to fal.ai CDN storage and return the public URL.
 */
async function uploadToFalStorage(
  imageBuffer: Buffer,
  contentType: string,
  falKey: string
): Promise<string> {
  const filename = `ref-${Date.now()}.jpg`;

  const initiateResp = await fetch(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content_type: contentType,
        file_name: filename,
      }),
    }
  );

  if (!initiateResp.ok) {
    const errText = await initiateResp.text();
    throw new Error(
      `FAL storage initiate failed (${initiateResp.status}): ${errText.slice(0, 300)}`
    );
  }

  const { upload_url: uploadUrl, file_url: fileUrl } =
    (await initiateResp.json()) as { upload_url: string; file_url: string };

  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(imageBuffer),
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(
      `FAL storage upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`
    );
  }

  console.log(`[generate-video] Uploaded reference to fal CDN: ${fileUrl}`);
  return fileUrl;
}

/**
 * Prepare the character reference image for i2v pipeline.
 * If image is small enough, use inline base64; otherwise upload to fal CDN.
 *
 * Caches the prepared URL for 30 minutes to avoid re-reading from disk
 * and re-uploading to fal CDN on every video generation request.
 */
const refUrlCache = new Map<string, { url: string; timestamp: number }>();
const REF_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function prepareReferenceForFal(
  imagePath: string,
  falKey: string
): Promise<string> {
  // Evict stale entries on each access
  cleanExpiredEntries(refUrlCache, REF_CACHE_TTL);

  // Check cache — same reference image doesn't need re-upload
  const cached = refUrlCache.get(imagePath);
  if (cached && Date.now() - cached.timestamp < REF_CACHE_TTL) {
    console.log(`[generate-video] Using cached reference URL for ${imagePath}`);
    return cached.url;
  }

  const imageBuffer = readFileSync(imagePath);
  const mime = imagePath.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";

  if (imageBuffer.length <= MAX_INLINE_SIZE) {
    const dataUri = `data:${mime};base64,${imageBuffer.toString("base64")}`;
    refUrlCache.set(imagePath, { url: dataUri, timestamp: Date.now() });
    return dataUri;
  }

  const cdnUrl = await uploadToFalStorage(imageBuffer, mime, falKey);
  refUrlCache.set(imagePath, { url: cdnUrl, timestamp: Date.now() });
  return cdnUrl;
}

// ── Build video prompt ──────────────────────────────────────────────────

function buildVideoPrompt(
  actionPrompt: string,
  appearance: string,
  hasReference: boolean
): string {
  const motionSuffix =
    "subtle natural movement, gentle breathing, hair sway, cinematic, volumetric lighting, smooth motion, high quality";

  if (hasReference) {
    // i2v pipeline — the still frame anchors the face; prompt guides motion
    return [actionPrompt, appearance, motionSuffix]
      .filter(Boolean)
      .join(", ");
  }

  // t2v pipeline — full description needed
  return [actionPrompt, appearance, motionSuffix].filter(Boolean).join(", ");
}

// ── Route handler ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  // Validate character name
  if (name.includes("..") || name.includes("/")) {
    return NextResponse.json(
      { error: "Invalid character name" },
      { status: 400 }
    );
  }

  const charDir = join(CHARACTERS_DIR, name);
  const identityPath = join(charDir, "IDENTITY.md");
  if (!existsSync(charDir) || !existsSync(identityPath)) {
    return NextResponse.json(
      { error: `Character "${name}" not found` },
      { status: 404 }
    );
  }

  // Parse request body
  let body: { prompt?: string; style?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  if (prompt.length > 500) {
    return NextResponse.json(
      { error: "Prompt too long (max 500 chars)" },
      { status: 400 }
    );
  }

  // Read FAL_KEY from .env (cached to avoid disk I/O on every request)
  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch {
    return NextResponse.json({ error: "No .env found" }, { status: 500 });
  }
  const falKey = env.FAL_KEY;

  if (!falKey) {
    return NextResponse.json(
      { error: "FAL_KEY not configured in .env" },
      { status: 500 }
    );
  }

  // Read character appearance (cached)
  const identityContent = readIdentityCached(identityPath);
  const appearance = extractAppearance(identityContent);

  // Check for reference image (enables i2v pipeline for face consistency)
  const referenceExts = [".jpg", ".jpeg", ".png", ".webp"];
  let referenceImagePath: string | null = null;
  for (const ext of referenceExts) {
    const candidate = join(charDir, `reference${ext}`);
    if (existsSync(candidate)) {
      referenceImagePath = candidate;
      break;
    }
  }

  const hasReference = !!referenceImagePath;
  const fullPrompt = buildVideoPrompt(prompt, appearance, hasReference);

  console.log(
    `[generate-video] character=${name} hasRef=${hasReference} prompt=${fullPrompt.slice(0, 300)}`
  );

  try {
    let result: Record<string, unknown>;
    let modelUsed = "unknown";

    if (referenceImagePath) {
      // ── Pipeline: PuLID still frame → Wan i2v ────────────────────────
      // Step 1: Generate a face-consistent still frame with PuLID
      console.log(`[generate-video] Step 1: PuLID still frame...`);
      const refImageUrl = await prepareReferenceForFal(
        referenceImagePath,
        falKey
      );

      let stillImageUrl: string | null = null;
      try {
        const stillResult = await falQueueRun(
          "fal-ai/flux-pulid",
          {
            prompt: `${fullPrompt}, cinematic still frame, volumetric lighting, shallow depth of field, ultra detailed`,
            reference_image_url: refImageUrl,
            image_size: "portrait_4_3",
            guidance_scale: 5.5,
            num_inference_steps: 28,
            id_weight: 0.7,
          },
          falKey
        );

        // Extract still image URL
        const images = stillResult?.images as
          | Array<{ url?: string }>
          | undefined;
        stillImageUrl =
          images?.[0]?.url ??
          (stillResult?.image as { url?: string } | undefined)?.url ??
          null;

        if (stillImageUrl) {
          console.log(
            `[generate-video] PuLID still SUCCESS: ${stillImageUrl.slice(0, 80)}...`
          );
        }
      } catch (pulidErr) {
        console.warn(
          `[generate-video] PuLID still FAILED: ${
            pulidErr instanceof Error ? pulidErr.message : pulidErr
          }`
        );
      }

      if (stillImageUrl) {
        // Step 2: Animate with Wan i2v
        console.log(`[generate-video] Step 2: Wan i2v animate...`);
        result = await falQueueRun(
          "fal-ai/wan-i2v",
          {
            prompt: fullPrompt,
            image_url: stillImageUrl,
            num_frames: 81,
            resolution: "480p",
            aspect_ratio: "9:16",
          },
          falKey
        );
        modelUsed = "fal-ai/flux-pulid+wan-i2v";
      } else {
        // PuLID failed — fall back to text-to-video
        console.log(
          `[generate-video] PuLID failed, falling back to Wan t2v`
        );
        result = await falQueueRun(
          "fal-ai/wan-t2v",
          {
            prompt: fullPrompt,
            num_frames: 81,
            resolution: "480p",
            aspect_ratio: "9:16",
          },
          falKey
        );
        modelUsed = "fal-ai/wan-t2v";
      }
    } else {
      // ── No reference image — pure text-to-video ──────────────────────
      console.log(`[generate-video] No reference, using Wan t2v`);
      result = await falQueueRun(
        "fal-ai/wan-t2v",
        {
          prompt: fullPrompt,
          num_frames: 81,
          resolution: "480p",
          aspect_ratio: "9:16",
        },
        falKey
      );
      modelUsed = "fal-ai/wan-t2v";
    }

    console.log(`[generate-video] FINAL MODEL USED: ${modelUsed}`);

    const videoUrl = extractVideoUrl(result);
    if (!videoUrl) {
      console.error(
        "[generate-video] No video URL in result:",
        JSON.stringify(result).slice(0, 500)
      );
      return NextResponse.json(
        { error: "Video generation returned no result" },
        { status: 502 }
      );
    }

    // Download the generated video
    const videoBuffer = await downloadVideoBuffer(videoUrl);

    // Save to characters/[name]/media/video-[timestamp].mp4
    const mediaDir = join(charDir, "media");
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `video-${timestamp}.mp4`;
    const filePath = join(mediaDir, filename);
    writeFileSync(filePath, videoBuffer);

    const url = `/api/media/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`;

    // Save video message to memory.db so it persists across refreshes.
    // Use the engine's shared DB connection to avoid SQLite BUSY errors from
    // concurrent writes (the engine may be writing at the same time).
    try {
      const engine = engineCache.get(name);
      if (engine) {
        const memory = engine.getMemory();
        const db = memory.getDatabase();

        // Delete assistant messages from this turn that are NOT media markers.
        // Video generation can take 1-5 minutes, so use a wide window.
        const windowMs = 360_000; // 6 minutes
        db.prepare(
          `
          DELETE FROM messages
          WHERE role = 'assistant'
            AND (platform = 'dashboard' OR platform IS NULL)
            AND timestamp BETWEEN ? AND ?
            AND content NOT LIKE '[image:%'
            AND content NOT LIKE '[voice:%'
            AND content NOT LIKE '[video:%'
        `
        ).run(timestamp - windowMs, timestamp + windowMs);

        memory.addMessage({
          role: 'assistant',
          content: `[video:${url}|model:${modelUsed}]`,
          timestamp,
          platform: 'dashboard',
        });

        // Store the generation prompt for audit trail and future deduplication
        db.exec(`
          CREATE TABLE IF NOT EXISTS generation_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            type      TEXT NOT NULL,
            prompt    TEXT NOT NULL,
            model     TEXT NOT NULL,
            url       TEXT NOT NULL,
            style     TEXT,
            timestamp INTEGER NOT NULL
          )
        `);
        db.prepare(
          'INSERT INTO generation_log (type, prompt, model, url, style, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run('video', fullPrompt, modelUsed, url, null, timestamp);
      } else {
        console.warn('[generate-video] No engine in cache for', name, '— skipping DB write');
      }
    } catch (dbErr) {
      console.error("[generate-video] Failed to save to memory.db:", dbErr);
    }

    return NextResponse.json({ url, filename, model: modelUsed });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Video generation failed";
    console.error(`[generate-video] Error: character=${name}`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
