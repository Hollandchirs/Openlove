import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import {
  schedulerCache,
  type BridgeInstance,
} from "@/lib/scheduler-cache";
import { readEnvCached } from "@/lib/repo-root";

export const dynamic = "force-dynamic";

/**
 * Per-bridge toggle endpoint.
 * POST  /api/wake/{name}/bridge/{platform} — connect a specific bridge
 * DELETE /api/wake/{name}/bridge/{platform} — disconnect a specific bridge
 */

const BRIDGE_ENV_KEYS: Record<
  string,
  { key: string; label: string; enableKey?: string }
> = {
  discord: { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token" },
  telegram: { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token" },
  whatsapp: {
    key: "WHATSAPP_ENABLED",
    label: "WhatsApp",
    enableKey: "WHATSAPP_ENABLED",
  },
};

function getBridgeModule(pkg: string) {
  return eval("require")(pkg);
}

// ── Start a single bridge ───────────────────────────────────────────────

async function startSingleBridge(
  platform: string,
  env: Record<string, string>,
  engine: any,
  media: any,
  activityManager: any
): Promise<BridgeInstance | null> {
  switch (platform) {
    case "discord": {
      if (!env.DISCORD_BOT_TOKEN) return null;
      const { DiscordBridge } = getBridgeModule("@opencrush/bridge-discord");
      const discord = new DiscordBridge({
        token: env.DISCORD_BOT_TOKEN,
        clientId: env.DISCORD_CLIENT_ID ?? "",
        ownerId: env.DISCORD_OWNER_ID ?? "",
        engine,
        media,
        voiceConversationEnabled: env.VOICE_CONVERSATION_ENABLED !== "false",
      });
      await discord.start();
      activityManager.setCallback((activity: any) => {
        discord.updatePresence(activity);
      });
      console.log("[Bridge] Discord bridge connected");
      return discord;
    }
    case "telegram": {
      if (!env.TELEGRAM_BOT_TOKEN) return null;
      const { TelegramBridge } = getBridgeModule("@opencrush/bridge-telegram");
      const telegram = new TelegramBridge({
        token: env.TELEGRAM_BOT_TOKEN,
        ownerId: parseInt(env.TELEGRAM_OWNER_ID ?? "0"),
        engine,
        media,
      });
      await telegram.start();
      console.log("[Bridge] Telegram bridge connected");
      return telegram;
    }
    case "whatsapp": {
      if (env.WHATSAPP_ENABLED !== "true") return null;
      const { WhatsAppBridge } = getBridgeModule("@opencrush/bridge-whatsapp");
      const wa = new WhatsAppBridge({ engine, media });
      await wa.start();
      console.log("[Bridge] WhatsApp bridge connected");
      return wa;
    }
    default:
      return null;
  }
}

// ── POST — connect a bridge ─────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: { name: string; platform: string } }
) {
  const { name, platform } = params;
  const config = BRIDGE_ENV_KEYS[platform];

  if (!config) {
    return NextResponse.json(
      { error: `Unknown platform: ${platform}` },
      { status: 400 }
    );
  }

  // Read .env to check for API keys
  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch {
    env = {};
  }

  // Check if the required API key / enable flag is configured
  const hasKey =
    platform === "whatsapp"
      ? env.WHATSAPP_ENABLED === "true"
      : Boolean(env[config.key]);

  if (!hasKey) {
    return NextResponse.json(
      {
        error: `${config.label} not configured`,
        needsConfig: true,
        hint: `Add ${config.key} to your .env file to enable ${platform}`,
      },
      { status: 400 }
    );
  }

  // Check if the scheduler is running for this character
  console.log("[Bridge] schedulerCache keys:", Array.from(schedulerCache.keys()), "| looking for:", name);
  const entry = schedulerCache.get(name);
  if (!entry) {
    return NextResponse.json(
      {
        error: `Character "${name}" is not awake. Wake them first.`,
        needsWake: true,
      },
      { status: 400 }
    );
  }

  // Check if this bridge is already connected
  if (entry.platforms.includes(platform)) {
    return NextResponse.json({
      platform,
      status: "connected",
      message: `${platform} bridge is already connected`,
      bridges: entry.platforms,
    });
  }

  // Lazy-load the media engine from the engine cache for bridge initialization
  let media: any = null;
  try {
    const MediaEngine = eval("require")("@opencrush/media").MediaEngine;
    media = new MediaEngine({
      image: { falKey: env.FAL_KEY, model: env.IMAGE_MODEL },
      voice: {
        provider:
          (env.TTS_PROVIDER as any) ?? (env.FAL_KEY ? "fal" : "elevenlabs"),
        elevenLabsApiKey: env.ELEVENLABS_API_KEY,
        elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID,
        fishAudioApiKey: env.FISH_AUDIO_API_KEY,
        fishAudioVoiceId: env.FISH_AUDIO_VOICE_ID,
        falKey: env.FAL_KEY,
        openaiApiKey: env.OPENAI_API_KEY,
      },
      video: { falKey: env.FAL_KEY },
    });
  } catch (err) {
    console.error("[Bridge] Failed to initialize media engine:", err);
    return NextResponse.json(
      { error: "Failed to initialize media engine" },
      { status: 500 }
    );
  }

  try {
    const bridge = await startSingleBridge(
      platform,
      env,
      entry.engine,
      media,
      entry.activityManager
    );

    if (!bridge) {
      return NextResponse.json(
        { error: `Failed to start ${platform} bridge` },
        { status: 500 }
      );
    }

    // Add to the scheduler entry (immutable arrays — create new copies)
    const updatedBridges = [...entry.bridges, bridge];
    const updatedPlatforms = [...entry.platforms, platform];
    entry.bridges = updatedBridges;
    entry.platforms = updatedPlatforms;

    // Wire proactive messages to new bridge
    entry.scheduler?.onProactiveMessage?.(async (trigger: any) => {
      const response = await entry.engine.generateProactiveMessage(trigger);
      await bridge.sendProactiveMessage(response);
    });

    return NextResponse.json({
      platform,
      status: "connected",
      message: `${platform} bridge enabled`,
      bridges: updatedPlatforms,
    });
  } catch (err) {
    console.error(`[Bridge] Failed to start ${platform}:`, err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : `Failed to start ${platform} bridge`,
      },
      { status: 500 }
    );
  }
}

// ── DELETE — disconnect a bridge ────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { name: string; platform: string } }
) {
  const { name, platform } = params;
  const config = BRIDGE_ENV_KEYS[platform];

  if (!config) {
    return NextResponse.json(
      { error: `Unknown platform: ${platform}` },
      { status: 400 }
    );
  }

  const entry = schedulerCache.get(name);
  if (!entry) {
    return NextResponse.json({
      platform,
      status: "disconnected",
      message: `Character "${name}" is not awake`,
      bridges: [],
    });
  }

  const platformIndex = entry.platforms.indexOf(platform);
  if (platformIndex === -1) {
    return NextResponse.json({
      platform,
      status: "disconnected",
      message: `${platform} bridge was not connected`,
      bridges: entry.platforms,
    });
  }

  // Stop the bridge
  try {
    const bridge = entry.bridges[platformIndex];
    await bridge.stop();
    console.log(`[Bridge] ${platform} bridge disconnected for ${name}`);
  } catch (err) {
    console.error(`[Bridge] Error stopping ${platform}:`, err);
  }

  // Remove from the scheduler entry (create new arrays)
  const updatedBridges = entry.bridges.filter((_, i) => i !== platformIndex);
  const updatedPlatforms = entry.platforms.filter(
    (_, i) => i !== platformIndex
  );
  entry.bridges = updatedBridges;
  entry.platforms = updatedPlatforms;

  return NextResponse.json({
    platform,
    status: "disconnected",
    message: `${platform} bridge disabled`,
    bridges: updatedPlatforms,
  });
}
