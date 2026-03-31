import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CHARACTERS_DIR, ENV_PATH, readEnvCached } from "@/lib/repo-root";

// Force this route to be fully dynamic — never prerender
export const dynamic = "force-dynamic";

// Lazy import to avoid build-time resolution of native modules
let ConversationEngine: any = null;
async function getEngine() {
  if (!ConversationEngine) {
    const mod = await import("@opencrush/core");
    ConversationEngine = mod.ConversationEngine;
  }
  return ConversationEngine;
}

// ── Engine cache (one ConversationEngine per character) ─────────────────

import { engineCache } from "@/lib/engine-cache";

async function getOrCreateEngine(characterName: string, env: Record<string, string>) {
  const CE = await getEngine();
  const existing = engineCache.get(characterName);
  if (existing) return existing;

  const provider = env.LLM_PROVIDER ?? "anthropic";
  const model = env.LLM_MODEL && env.LLM_MODEL !== "(provider default)"
    ? env.LLM_MODEL
    : undefined;

  const config: any = {
    characterName,
    charactersDir: CHARACTERS_DIR,
    llm: {
      provider: provider as any,
      // International
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      xaiApiKey: env.XAI_API_KEY,
      // Chinese providers
      deepseekApiKey: env.DEEPSEEK_API_KEY,
      qwenApiKey: env.DASHSCOPE_API_KEY,
      kimiApiKey: env.MOONSHOT_API_KEY,
      zhipuApiKey: env.ZHIPU_API_KEY,
      minimaxApiKey: env.MINIMAX_API_KEY,
      // Local
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
      ollamaModel: env.OLLAMA_MODEL,
      // Embedding
      jinaApiKey: env.JINA_API_KEY,
      // Optional model override
      model,
    },
  };

  const engine = new CE(config);
  engineCache.set(characterName, engine);
  return engine;
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  const charDir = join(CHARACTERS_DIR, name);
  if (!existsSync(charDir) || !existsSync(join(charDir, "IDENTITY.md"))) {
    return NextResponse.json(
      { error: `Character "${name}" not found` },
      { status: 404 }
    );
  }

  let body: { message?: string; type?: string; mediaUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const rawMessage = body.message?.trim();
  if (!rawMessage) {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 }
    );
  }

  if (rawMessage.length > 2000) {
    return NextResponse.json(
      { error: "Message too long (max 2000 chars)" },
      { status: 400 }
    );
  }

  // Build the content sent to the LLM, enriching with media context
  const messageType = body.type ?? "text";
  const mediaUrl = body.mediaUrl ?? "";
  let userMessage = rawMessage;
  let imageData: { base64: string; mediaType: string }[] | undefined;

  if (messageType === "image" && mediaUrl) {
    userMessage = rawMessage || "What do you see in this image?";
    // Read the actual image file and convert to base64 for vision-capable LLMs
    try {
      const mediaPath = mediaUrl.replace(/^\/api\/media\//, "");
      const parts = mediaPath.split("/");
      if (parts.length >= 2) {
        const charName = decodeURIComponent(parts[0]);
        const fileName = decodeURIComponent(parts.slice(1).join("/"));
        const filePath = join(CHARACTERS_DIR, charName, fileName);
        const mediaFilePath = existsSync(filePath)
          ? filePath
          : join(CHARACTERS_DIR, charName, "media", fileName);
        if (existsSync(mediaFilePath)) {
          const imgBuffer = readFileSync(mediaFilePath);
          const ext = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
          const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
          imageData = [{ base64: imgBuffer.toString("base64"), mediaType: mime }];
        }
      }
    } catch (imgErr) {
      console.warn("[chat] Failed to read image for vision:", imgErr);
    }
    // Fallback: if image couldn't be read, still tell the LLM a photo was sent
    if (!imageData) {
      userMessage = `[User sent you a photo: ${mediaUrl}]\n${rawMessage}`;
    }
  } else if (messageType === "video" && mediaUrl) {
    userMessage = `[User sent you a video: ${mediaUrl}]\n${rawMessage}`;
  } else if (messageType === "audio" && mediaUrl) {
    userMessage = `[User sent you a voice message]\n${rawMessage}`;
  }

  // Read LLM config from .env
  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Config error" },
      { status: 500 }
    );
  }

  // Get or create the ConversationEngine (same engine the bridges use)
  let engine: any;
  try {
    engine = await getOrCreateEngine(name, env);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Engine init failed" },
      { status: 500 }
    );
  }

  // Use ConversationEngine.respond() — this handles:
  //   - Memory retrieval (semantic + episodic + working)
  //   - System prompt construction (blueprint + dynamic context + relationship)
  //   - LLM call
  //   - Memory consolidation (stores messages, creates episodes, updates vectors)
  //   - Relationship stat updates (closeness, trust, familiarity)
  //   - Emotion state tracking
  //   - MEMORY.md sync
  try {
    const response = await engine.respond({
      content: userMessage,
      platform: "dashboard",
      userId: "dashboard-user",
      attachments: imageData
        ? imageData.map((img) => ({
            type: "image" as const,
            url: mediaUrl,
            base64: img.base64,
            mediaType: img.mediaType,
          }))
        : undefined,
    });

    return NextResponse.json({
      reply: response.text,
      timestamp: Date.now(),
      actions: response.actions,
      mood: response.mood ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM call failed";
    console.error(
      `[chat] Engine error: character=${name}, provider=${env.LLM_PROVIDER ?? "anthropic"}`,
      err
    );

    // If the engine is in a bad state, remove it from cache so next request recreates it
    engineCache.delete(name);

    return NextResponse.json(
      { error: message, provider: env.LLM_PROVIDER },
      { status: 502 }
    );
  }
}
