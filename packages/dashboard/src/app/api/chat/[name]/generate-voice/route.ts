import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { engineCache } from "@/lib/engine-cache";
import { CHARACTERS_DIR, readEnvCached } from "@/lib/repo-root";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ── TTS provider dispatch ───────────────────────────────────────────────

async function generateVoice(
  text: string,
  env: Record<string, string>
): Promise<Buffer | null> {
  // ElevenLabs
  if (env.ELEVENLABS_API_KEY) {
    return elevenLabsTTS(text, env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID);
  }

  // Fish Audio
  if (env.FISH_AUDIO_API_KEY) {
    return fishAudioTTS(text, env.FISH_AUDIO_API_KEY, env.FISH_AUDIO_VOICE_ID);
  }

  // FAL Kokoro (reuses FAL_KEY)
  if (env.FAL_KEY) {
    return falKokoroTTS(text, env.FAL_KEY, env.FAL_VOICE_ID);
  }

  return null;
}

async function elevenLabsTTS(
  text: string,
  apiKey: string,
  voiceId?: string
): Promise<Buffer | null> {
  const vid = voiceId ?? "21m00Tcm4TlvDq8ikWAM";

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${vid}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    console.error(
      `[Voice/ElevenLabs] API error ${response.status}:`,
      await response.text()
    );
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

async function fishAudioTTS(
  text: string,
  apiKey: string,
  voiceId?: string
): Promise<Buffer | null> {
  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      reference_id: voiceId ?? undefined,
      format: "mp3",
      latency: "balanced",
    }),
  });

  if (!response.ok) {
    console.error(
      `[Voice/FishAudio] API error ${response.status}:`,
      await response.text()
    );
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

async function falKokoroTTS(
  text: string,
  falKey: string,
  voiceId?: string
): Promise<Buffer | null> {
  console.log(`[Voice/FAL] Calling Kokoro with text: "${text.slice(0, 50)}..."`);
  let resp: Response;
  try {
    resp = await fetch("https://fal.run/fal-ai/kokoro/american-english", {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        ...(voiceId ? { voice: voiceId } : {}),
      }),
    });
  } catch (fetchErr) {
    console.error("[Voice/FAL] fetch() threw:", fetchErr);
    return null;
  }

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    console.error(`[Voice/FAL] API error (${resp.status}):`, errBody);
    return null;
  }

  const result = (await resp.json()) as { audio?: { url?: string } };
  const audioUrl = result.audio?.url;
  if (!audioUrl) {
    console.error("[Voice/FAL] No audio URL in result:", JSON.stringify(result).slice(0, 300));
    return null;
  }

  console.log(`[Voice/FAL] Got audio URL: ${audioUrl}`);
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) {
    console.error(`[Voice/FAL] Audio download failed: ${audioResp.status}`);
    return null;
  }
  return Buffer.from(await audioResp.arrayBuffer());
}

// ── Sanitize text for speech ────────────────────────────────────────────

function sanitizeForSpeech(text: string): string {
  // Use RegExp constructor to avoid TS target issues with unicode flags
  const emojiPattern = new RegExp("\\p{Extended_Pictographic}", "gu");
  const zwjPattern = new RegExp("[\\u{200D}\\u{FE0E}\\u{FE0F}\\u{20E3}]", "gu");
  const skinTonePattern = new RegExp("[\\u{1F3FB}-\\u{1F3FF}]", "gu");
  const tagPattern = new RegExp("[\\u{E0020}-\\u{E007F}]", "gu");

  return text
    .replace(/\[SELFIE:[^\]]*\]/gi, "")
    .replace(/\[VOICE:[^\]]*\]/gi, "")
    .replace(/\[VIDEO:[^\]]*\]/gi, "")
    .replace(/\*[^*]+\*/g, "")
    .replace(/\([^)]+\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/~[^~]+~/g, "")
    .replace(emojiPattern, "")
    .replace(zwjPattern, "")
    .replace(skinTonePattern, "")
    .replace(tagPattern, "")
    .replace(/[:;][-']?[)(DPpOo3><\\/|]/g, "")
    .replace(/[<>]3/g, "")
    .replace(/xD+/gi, "")
    .replace(/[*_`~#]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Route handler ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  if (name.includes("..") || name.includes("/")) {
    return NextResponse.json(
      { error: "Invalid character name" },
      { status: 400 }
    );
  }

  const charDir = join(CHARACTERS_DIR, name);
  if (!existsSync(charDir)) {
    return NextResponse.json(
      { error: `Character "${name}" not found` },
      { status: 404 }
    );
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const rawText = body.text?.trim();
  if (!rawText) {
    return NextResponse.json(
      { error: "text is required" },
      { status: 400 }
    );
  }

  if (rawText.length > 1000) {
    return NextResponse.json(
      { error: "Text too long (max 1000 chars)" },
      { status: 400 }
    );
  }

  const cleanText = sanitizeForSpeech(rawText);
  if (!cleanText) {
    return NextResponse.json(
      { error: "No speakable text after sanitization" },
      { status: 400 }
    );
  }

  // Read env (cached to avoid disk I/O on every request)
  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch {
    return NextResponse.json({ error: "No .env found" }, { status: 500 });
  }

  try {
    const audioBuffer = await generateVoice(cleanText, env);

    if (!audioBuffer) {
      return NextResponse.json(
        { error: "No TTS provider configured (need ELEVENLABS_API_KEY, FISH_AUDIO_API_KEY, or FAL_KEY)" },
        { status: 500 }
      );
    }

    // Save to characters/[name]/media/voice-[timestamp].mp3
    const mediaDir = join(charDir, "media");
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `voice-${timestamp}.mp3`;
    const filePath = join(mediaDir, filename);
    writeFileSync(filePath, audioBuffer);

    const url = `/api/media/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`;

    // Save voice message to memory.db so it persists across refreshes.
    // Use the engine's shared DB connection to avoid SQLite BUSY errors from
    // concurrent writes (the engine may be writing at the same time).
    try {
      const engine = engineCache.get(name);
      if (engine) {
        const memory = engine.getMemory();
        const db = memory.getDatabase();

        // Delete assistant messages from this conversation turn that are NOT media markers.
        const windowMs = 180_000;
        db.prepare(`
          DELETE FROM messages
          WHERE role = 'assistant'
            AND (platform = 'dashboard' OR platform IS NULL)
            AND timestamp BETWEEN ? AND ?
            AND content NOT LIKE '[image:%'
            AND content NOT LIKE '[voice:%'
        `).run(timestamp - windowMs, timestamp + windowMs);

        memory.addMessage({
          role: 'assistant',
          content: `[voice:${url}]`,
          timestamp,
          platform: 'dashboard',
        });
      } else {
        console.warn('[generate-voice] No engine in cache for', name, '— skipping DB write');
      }
    } catch (dbErr) {
      console.error('[generate-voice] Failed to save to memory.db:', dbErr);
    }

    return NextResponse.json({ url, filename });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice generation failed";
    console.error(`[generate-voice] Error: character=${name}`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
