import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { CHARACTERS_DIR, ENV_PATH, REPO_ROOT, readEnvCached } from "@/lib/repo-root";

export const dynamic = "force-dynamic";

// ── Lazy imports to avoid build-time native module resolution ────────────

let _ConversationEngine: any = null;
function getConversationEngine() {
  if (!_ConversationEngine) {
    // Use eval to hide from webpack static analysis
    const mod = eval('require')("@opencrush/core");
    _ConversationEngine = mod.ConversationEngine;
  }
  return _ConversationEngine;
}

function getAutonomousModules() {
  const mod = eval('require')("@opencrush/autonomous");
  return {
    AutonomousScheduler: mod.AutonomousScheduler,
    MusicEngine: mod.MusicEngine,
    DramaEngine: mod.DramaEngine,
    ActivityManager: mod.ActivityManager,
    BrowserAgent: mod.BrowserAgent,
    SocialEngine: mod.SocialEngine,
    buildCharacterActivityConfig: mod.buildCharacterActivityConfig,
  };
}

function getMediaEngine() {
  const mod = eval('require')("@opencrush/media");
  return mod.MediaEngine;
}

// ── Bridge helpers ───────────────────────────────────────────────────────

// Re-export shared types for backwards compatibility within this file
type BridgeInstance = import("@/lib/scheduler-cache").BridgeInstance;

function getBridgeModule(pkg: string) {
  return eval('require')(pkg);
}

async function startBridges(
  env: Record<string, string>,
  engine: any,
  media: any,
  activityManager: any
): Promise<{ bridges: BridgeInstance[]; platforms: string[] }> {
  const bridges: BridgeInstance[] = [];
  const platforms: string[] = [];

  // Discord
  if (env.DISCORD_BOT_TOKEN) {
    try {
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
      bridges.push(discord);
      platforms.push("discord");

      // Wire activity changes to Discord Rich Presence
      activityManager.setCallback((activity: any) => {
        discord.updatePresence(activity);
      });

      console.log("[Wake] Discord bridge connected");
    } catch (err) {
      console.error("[Wake] Failed to start Discord bridge:", err);
    }
  }

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      const { TelegramBridge } = getBridgeModule("@opencrush/bridge-telegram");
      const telegram = new TelegramBridge({
        token: env.TELEGRAM_BOT_TOKEN,
        ownerId: parseInt(env.TELEGRAM_OWNER_ID ?? "0"),
        engine,
        media,
      });
      await telegram.start();
      bridges.push(telegram);
      platforms.push("telegram");
      console.log("[Wake] Telegram bridge connected");
    } catch (err) {
      console.error("[Wake] Failed to start Telegram bridge:", err);
    }
  }

  // WhatsApp
  if (env.WHATSAPP_ENABLED === "true") {
    try {
      const { WhatsAppBridge } = getBridgeModule(
        "@opencrush/bridge-whatsapp"
      );
      const wa = new WhatsAppBridge({ engine, media });
      await wa.start();
      bridges.push(wa);
      platforms.push("whatsapp");
      console.log("[Wake] WhatsApp bridge connected");
    } catch (err) {
      console.error("[Wake] Failed to start WhatsApp bridge:", err);
    }
  }

  return { bridges, platforms };
}

// ── Scheduler cache (shared across route files) ─────────────────────────

import {
  schedulerCache,
  type SchedulerEntry,
} from "@/lib/scheduler-cache";

async function startScheduler(
  characterName: string,
  env: Record<string, string>
): Promise<SchedulerEntry> {
  const existing = schedulerCache.get(characterName);
  if (existing) {
    return existing;
  }

  const CE = await getConversationEngine();
  const MediaEngine = await getMediaEngine();
  const auto = await getAutonomousModules();

  // Initialize ConversationEngine
  const provider = env.LLM_PROVIDER ?? "anthropic";
  const model =
    env.LLM_MODEL && env.LLM_MODEL !== "(provider default)"
      ? env.LLM_MODEL
      : undefined;

  const engine = new CE({
    characterName,
    charactersDir: CHARACTERS_DIR,
    llm: {
      provider: provider as any,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      xaiApiKey: env.XAI_API_KEY,
      deepseekApiKey: env.DEEPSEEK_API_KEY,
      qwenApiKey: env.DASHSCOPE_API_KEY,
      kimiApiKey: env.MOONSHOT_API_KEY,
      zhipuApiKey: env.ZHIPU_API_KEY,
      minimaxApiKey: env.MINIMAX_API_KEY,
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
      ollamaModel: env.OLLAMA_MODEL,
      jinaApiKey: env.JINA_API_KEY,
      model,
    },
  });

  // Initialize MediaEngine
  const media = new MediaEngine({
    image: {
      falKey: env.FAL_KEY,
      model: env.IMAGE_MODEL,
      referenceModel: env.IMAGE_REFERENCE_MODEL,
    },
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
    video: {
      falKey: env.FAL_KEY,
      referenceImagePath: engine.characterBlueprint?.referenceImagePath,
    },
  });

  // ActivityManager with character-specific config
  const activityManager = new auto.ActivityManager();

  // Build character-specific activity config from AUTONOMY.md + SOUL.md + IDENTITY.md
  const characterActivityConfig = auto.buildCharacterActivityConfig({
    autonomyMd: engine.characterBlueprint?.autonomy ?? '',
    soulMd: engine.characterBlueprint?.soul ?? '',
    identityMd: engine.characterBlueprint?.identity ?? '',
  });

  // Apply character-specific daily routine
  if (characterActivityConfig.routine.length > 0) {
    activityManager.setRoutine(characterActivityConfig.routine);
    console.log(`[Wake] Character-specific daily routine loaded for ${characterName}`);
  }

  engine.setActivityProvider(() => activityManager.describeCurrentActivity());

  // BrowserAgent (optional)
  let browserAgent: any | undefined;
  if (env.BROWSER_AUTOMATION_ENABLED === "true") {
    browserAgent = new auto.BrowserAgent({
      mode:
        (env.BROWSER_MODE as "cdp" | "persistent" | "fresh" | "chrome") ||
        undefined,
      cdpEndpoint: env.BROWSER_CDP_ENDPOINT,
      profileDir: env.BROWSER_PROFILE_DIR,
    });
  }

  // SocialEngine (optional)
  const hasTwitterOAuth2 =
    env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET;
  const hasTwitterApi =
    env.TWITTER_API_KEY &&
    env.TWITTER_API_SECRET &&
    env.TWITTER_ACCESS_TOKEN &&
    env.TWITTER_ACCESS_TOKEN_SECRET;
  const hasTwitterScraper = env.TWITTER_USERNAME && env.TWITTER_PASSWORD;
  const hasAnyTwitter = hasTwitterOAuth2 || hasTwitterApi || hasTwitterScraper;

  const socialEngine = new auto.SocialEngine({
    twitter: hasAnyTwitter
      ? {
          clientId: env.TWITTER_CLIENT_ID,
          clientSecret: env.TWITTER_CLIENT_SECRET,
          oauth2TokenFile: hasTwitterOAuth2
            ? join(REPO_ROOT, ".twitter-oauth2-tokens.json")
            : undefined,
          apiKey: env.TWITTER_API_KEY ?? env.TWITTER_CONSUMER_KEY,
          apiSecret: env.TWITTER_API_SECRET ?? env.TWITTER_CONSUMER_SECRET,
          accessToken: env.TWITTER_ACCESS_TOKEN,
          accessTokenSecret: env.TWITTER_ACCESS_TOKEN_SECRET,
          username: env.TWITTER_USERNAME,
          password: env.TWITTER_PASSWORD,
          email: env.TWITTER_EMAIL,
          cookiePath: join(REPO_ROOT, ".twitter-cookies.json"),
        }
      : undefined,
    minPostIntervalMinutes: parseInt(
      env.SOCIAL_MIN_POST_INTERVAL ?? "120"
    ),
    autoPost: env.SOCIAL_AUTO_POST === "true",
  });

  socialEngine.initialize().catch((err: Error) => {
    console.error("[Wake/Social] Failed to initialize:", err);
  });

  // MusicEngine & DramaEngine with character-specific config
  const musicEngine = new auto.MusicEngine({
    spotifyClientId: env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
    seedArtists: characterActivityConfig.musicSeedArtists,
    seedGenres: characterActivityConfig.musicSeedGenres,
    curatedTracks: characterActivityConfig.curatedTracks,
  });

  const dramaEngine = new auto.DramaEngine({
    tmdbApiKey: env.TMDB_API_KEY,
    preferredGenres: characterActivityConfig.dramaPreferredGenres,
    curatedShows: characterActivityConfig.curatedShows,
  });

  // Start messaging bridges
  const { bridges, platforms } = await startBridges(
    env,
    engine,
    media,
    activityManager
  );

  // AutonomousScheduler with character-specific activity config
  const scheduler = new auto.AutonomousScheduler({
    engine,
    music: musicEngine,
    drama: dramaEngine,
    activityManager,
    browserAgent,
    socialEngine,
    mediaEngine: media,
    socialAutoPost: env.SOCIAL_AUTO_POST === "true",
    charactersDir: CHARACTERS_DIR,
    quietHoursStart: parseInt(env.QUIET_HOURS_START ?? "23"),
    quietHoursEnd: parseInt(env.QUIET_HOURS_END ?? "8"),
    minIntervalMinutes: parseInt(
      env.PROACTIVE_MESSAGE_MIN_INTERVAL ?? "60"
    ),
    maxIntervalMinutes: parseInt(
      env.PROACTIVE_MESSAGE_MAX_INTERVAL ?? "240"
    ),
    youtubeTopics: characterActivityConfig.youtubeTopics,
    browseSites: characterActivityConfig.browseSites,
    onProactiveMessage:
      bridges.length > 0
        ? async (trigger: any) => {
            const response = await engine.generateProactiveMessage(trigger);
            await Promise.allSettled(
              bridges.map((b) => b.sendProactiveMessage(response))
            );
          }
        : async () => {
            console.log(
              `[Wake] Proactive message generated for ${characterName} (no bridges connected)`
            );
          },
  });

  await scheduler.start();

  const entry: SchedulerEntry = {
    scheduler,
    engine,
    activityManager,
    bridges,
    platforms,
    startedAt: Date.now(),
  };
  schedulerCache.set(characterName, entry);

  console.log(
    `[Wake] Scheduler started for ${characterName}` +
      (platforms.length > 0
        ? ` (bridges: ${platforms.join(", ")})`
        : " (no bridges)")
  );
  return entry;
}

async function stopScheduler(characterName: string): Promise<boolean> {
  const entry = schedulerCache.get(characterName);
  if (!entry) return false;

  await entry.scheduler.stop();

  // Stop all bridges
  await Promise.allSettled(entry.bridges.map((b) => b.stop()));

  // Null out references before deleting to help GC release engine/bridges
  entry.scheduler = null;
  entry.engine = null;
  entry.activityManager = null;
  entry.bridges = [];

  schedulerCache.delete(characterName);
  console.log(
    `[Wake] Scheduler and bridges stopped for ${characterName}`
  );
  return true;
}

// ── Route handlers ───────────────────────────────────────────────────────

/** POST — Start the AutonomousScheduler for a character */
export async function POST(
  _request: NextRequest,
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

  // Already running?
  if (schedulerCache.has(name)) {
    const existing = schedulerCache.get(name)!;
    return NextResponse.json({
      status: "running",
      startedAt: existing.startedAt,
      bridges: existing.platforms,
      message: `${name} is already awake`,
    });
  }

  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Config error" },
      { status: 500 }
    );
  }

  try {
    const entry = await startScheduler(name, env);
    return NextResponse.json({
      status: "running",
      startedAt: entry.startedAt,
      bridges: entry.platforms,
      message: `${name} is now awake`,
    });
  } catch (err) {
    console.error(`[Wake] Failed to start scheduler for ${name}:`, err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to start scheduler",
      },
      { status: 500 }
    );
  }
}

/** GET — Check if the scheduler is running for a character */
export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;
  const entry = schedulerCache.get(name);

  if (entry) {
    return NextResponse.json({
      status: "running",
      startedAt: entry.startedAt,
      bridges: entry.platforms,
    });
  }

  return NextResponse.json({
    status: "stopped",
    startedAt: null,
    bridges: [],
  });
}

/** DELETE — Stop the scheduler for a character */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  const stopped = await stopScheduler(name);

  if (stopped) {
    return NextResponse.json({
      status: "stopped",
      message: `${name} is now sleeping`,
    });
  }

  return NextResponse.json({
    status: "stopped",
    message: `${name} was not running`,
  });
}
