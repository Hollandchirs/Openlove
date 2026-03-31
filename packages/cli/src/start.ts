/**
 * Start Command
 *
 * Boots up the full Opencrush stack:
 * 1. Load config from .env
 * 2. Initialize core engine (blueprint + memory)
 * 3. Start active bridges (Discord, Telegram, WhatsApp)
 * 4. Start autonomous scheduler
 * 5. Set up graceful shutdown
 */

import dotenv from 'dotenv'
import { ROOT_DIR, getEnvPath, ensureHomeDirExists } from './paths.js'
ensureHomeDirExists()
dotenv.config({ path: getEnvPath() })
import chalk from 'chalk'
import { ConversationEngine, loadCharacterConfig, saveCharacterConfig, migrateFromEnv } from '@opencrush/core'
import type { CharacterConfig } from '@opencrush/core'
import { MediaEngine } from '@opencrush/media'
import { AutonomousScheduler, MusicEngine, DramaEngine, ActivityManager, BrowserAgent, SocialEngine, buildCharacterActivityConfig } from '@opencrush/autonomous'
import { join } from 'path'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { execSync } from 'child_process'

// Use /tmp for PID file so it's always the same path regardless of cwd
const PID_FILE = '/tmp/opencrush.pid'

/**
 * Kill any existing Opencrush process found in the PID file.
 * Returns true if a process was killed.
 */
export function killExistingProcess(): boolean {
  let killed = false
  const myPid = process.pid

  // Strategy 1: PID file
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
      if (!isNaN(pid) && pid !== myPid) {
        try {
          process.kill(pid, 0)
          console.log(chalk.yellow(`  Stopping existing process (PID ${pid})...`))
          process.kill(pid, 'SIGTERM')
          killed = true
        } catch { /* process doesn't exist */ }
      }
      try { unlinkSync(PID_FILE) } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  // Strategy 2: Kill ALL other opencrush processes by pattern (covers pnpm spawns)
  // This is critical because pnpm creates parent processes not tracked by PID file
  try {
    const result = execSync(
      `ps aux | grep "[c]li/dist/index.js" | grep -v "${myPid}" | awk '{print $2}'`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()
    if (result) {
      const pids = result.split('\n').filter(Boolean)
      for (const pidStr of pids) {
        const pid = parseInt(pidStr, 10)
        if (!isNaN(pid) && pid !== myPid) {
          try {
            process.kill(pid, 'SIGTERM')
            console.log(chalk.yellow(`  Killed stale opencrush process (PID ${pid})`))
            killed = true
          } catch { /* already dead */ }
        }
      }
    }
  } catch { /* grep found nothing — no existing processes */ }

  // Also kill parent pnpm processes running @opencrush/cli
  try {
    execSync(
      `pkill -f "@opencrush/cli run start" 2>/dev/null || true`,
      { timeout: 3000 }
    )
  } catch { /* ignore */ }

  if (killed) {
    // Wait for processes to fully exit, then SIGKILL any survivors
    execSync('sleep 2', { timeout: 5000 })

    // Check if any old processes are still alive and force-kill them
    try {
      const survivors = execSync(
        `ps aux | grep "[c]li/dist/index.js" | grep -v "${myPid}" | awk '{print $2}'`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim()
      if (survivors) {
        for (const pidStr of survivors.split('\n').filter(Boolean)) {
          const pid = parseInt(pidStr, 10)
          if (!isNaN(pid) && pid !== myPid) {
            try {
              process.kill(pid, 'SIGKILL')
              console.log(chalk.yellow(`  Force-killed stubborn process (PID ${pid})`))
            } catch { /* already dead */ }
          }
        }
        execSync('sleep 1', { timeout: 3000 })
      }
    } catch { /* no survivors */ }

    console.log(chalk.green(`  Previous process(es) stopped.`))
  }

  return killed
}

function writePidFile(): void {
  writeFileSync(PID_FILE, String(process.pid), 'utf-8')
}

function cleanupPidFile(): void {
  try { unlinkSync(PID_FILE) } catch { /* ignore */ }
}

export async function startOpencrush(): Promise<void> {
  console.log(chalk.magenta('\n  💝 Starting Opencrush...\n'))

  // Write PID file for process management
  writePidFile()

  // ── Validate environment ────────────────────────────────────────────────
  const config = loadConfig()
  validateConfig(config)

  // ── Load per-character config (platform/voice/twitter/autonomous) ──────
  const charactersDir = join(ROOT_DIR, 'characters')
  const characterName = config.CHARACTER_NAME!
  let charConfig: CharacterConfig = loadCharacterConfig(characterName, charactersDir)

  // Backwards compat: if config.json is blank (no tokens set), migrate from .env
  const isBlankConfig = !charConfig.discord.botToken && !charConfig.telegram.botToken
  if (isBlankConfig) {
    const envPath = getEnvPath()
    try {
      charConfig = migrateFromEnv(envPath)
      saveCharacterConfig(characterName, charactersDir, charConfig)
      console.log(chalk.gray(`  Migrated platform config to characters/${characterName}/config.json`))
    } catch {
      // .env may not have platform keys either — use defaults
      console.log(chalk.gray(`  No platform config found — using defaults`))
    }
  }

  // ── Initialize core engine ──────────────────────────────────────────────
  const engine = new ConversationEngine({
    characterName: characterName,
    charactersDir,
    llm: {
      provider: config.LLM_PROVIDER as any,
      // International
      anthropicApiKey: config.ANTHROPIC_API_KEY,
      openaiApiKey: config.OPENAI_API_KEY,
      xaiApiKey: config.XAI_API_KEY,
      // Chinese providers
      deepseekApiKey: config.DEEPSEEK_API_KEY,
      qwenApiKey: config.DASHSCOPE_API_KEY,
      kimiApiKey: config.MOONSHOT_API_KEY,
      zhipuApiKey: config.ZHIPU_API_KEY,
      minimaxApiKey: config.MINIMAX_API_KEY,
      minimaxGlobalApiKey: config.MINIMAX_GLOBAL_API_KEY,
      zaiApiKey: config.ZAI_API_KEY,
      // Local
      ollamaBaseUrl: config.OLLAMA_BASE_URL,
      ollamaModel: config.OLLAMA_MODEL,
      // Jina AI — free multilingual embeddings (JINA_API_KEY)
      jinaApiKey: config.JINA_API_KEY,
      // Optional model override
      model: config.LLM_MODEL,
    },
  })

  console.log(chalk.green(`  ✓ ${engine.characterName} is waking up...`))
  console.log(chalk.gray(`  Provider: ${config.LLM_PROVIDER} | Character dir: ${join(charactersDir, characterName)}`))


  // ── Initialize media engine ─────────────────────────────────────────────
  const media = new MediaEngine({
    image: {
      falKey: config.FAL_KEY,
      model: config.IMAGE_MODEL,
      referenceModel: config.IMAGE_REFERENCE_MODEL,
    },
    voice: {
      provider: (charConfig.voice.provider || config.TTS_PROVIDER) as any ?? (config.FAL_KEY ? 'fal' : 'elevenlabs'),
      elevenLabsApiKey: charConfig.voice.elevenlabsKey || config.ELEVENLABS_API_KEY,
      elevenLabsVoiceId: charConfig.voice.elevenlabsVoiceId || config.ELEVENLABS_VOICE_ID,
      fishAudioApiKey: charConfig.voice.fishAudioKey || config.FISH_AUDIO_API_KEY,
      fishAudioVoiceId: charConfig.voice.fishAudioVoiceId || config.FISH_AUDIO_VOICE_ID,
      falKey: config.FAL_KEY,
      openaiApiKey: config.OPENAI_API_KEY,
    },
    video: {
      falKey: config.FAL_KEY,
      referenceImagePath: engine.characterBlueprint.referenceImagePath,
    },
  })

  console.log(chalk.green(`  ✓ Media engine ready`))

  // ── Initialize activity manager with character-specific config ─────────
  const activityManager = new ActivityManager()

  // Build character-specific activity config from AUTONOMY.md + SOUL.md + IDENTITY.md
  const characterActivityConfig = buildCharacterActivityConfig({
    autonomyMd: engine.characterBlueprint.autonomy,
    soulMd: engine.characterBlueprint.soul,
    identityMd: engine.characterBlueprint.identity,
  })

  // Apply character-specific daily routine (replaces generic DEFAULT_DAILY_ROUTINE)
  if (characterActivityConfig.routine.length > 0) {
    activityManager.setRoutine(characterActivityConfig.routine)
    console.log(chalk.green(`  ✓ Character-specific daily routine loaded for ${engine.characterName}`))
  }

  // Wire activity state into engine so the AI never contradicts its real activity
  engine.setActivityProvider(() => activityManager.describeCurrentActivity())

  // Browser agent (optional — requires Playwright, disabled by default)
  // Modes: 'cdp' (connect to user's Chrome), 'persistent' (saved profile), 'fresh' (isolated)
  let browserAgent: BrowserAgent | undefined
  if (config.BROWSER_AUTOMATION_ENABLED === 'true') {
    browserAgent = new BrowserAgent({
      mode: (config.BROWSER_MODE as 'cdp' | 'persistent' | 'fresh' | 'chrome') || undefined,
      cdpEndpoint: config.BROWSER_CDP_ENDPOINT,
      profileDir: config.BROWSER_PROFILE_DIR,
    })
  }

  // Social media engine (optional — API v2 preferred, scraper fallback)
  // Prefer per-character twitter config, fall back to .env
  const twitterClientId = charConfig.twitter.clientId || config.TWITTER_CLIENT_ID
  const twitterClientSecret = charConfig.twitter.clientSecret || config.TWITTER_CLIENT_SECRET
  const twitterApiKey = charConfig.twitter.apiKey || config.TWITTER_API_KEY
  const twitterApiSecret = charConfig.twitter.apiSecret || config.TWITTER_API_SECRET
  const twitterAccessToken = charConfig.twitter.accessToken || config.TWITTER_ACCESS_TOKEN
  const twitterAccessSecret = charConfig.twitter.accessSecret || config.TWITTER_ACCESS_TOKEN_SECRET
  const hasTwitterOAuth2 = twitterClientId && twitterClientSecret
  const hasTwitterApi = twitterApiKey && twitterApiSecret && twitterAccessToken && twitterAccessSecret
  const hasTwitterScraper = config.TWITTER_USERNAME && config.TWITTER_PASSWORD
  const hasAnyTwitter = hasTwitterOAuth2 || hasTwitterApi || hasTwitterScraper
  const socialEngine = new SocialEngine({
    twitter: hasAnyTwitter ? {
      clientId: twitterClientId,
      clientSecret: twitterClientSecret,
      oauth2TokenFile: hasTwitterOAuth2 ? join(ROOT_DIR, '.twitter-oauth2-tokens.json') : undefined,
      apiKey: twitterApiKey ?? config.TWITTER_CONSUMER_KEY,
      apiSecret: twitterApiSecret ?? config.TWITTER_CONSUMER_SECRET,
      accessToken: twitterAccessToken,
      accessTokenSecret: twitterAccessSecret,
      username: config.TWITTER_USERNAME,
      password: config.TWITTER_PASSWORD,
      email: config.TWITTER_EMAIL,
      cookiePath: join(ROOT_DIR, '.twitter-cookies.json'),
    } : undefined,
    minPostIntervalMinutes: charConfig.twitter.postInterval || parseInt(config.SOCIAL_MIN_POST_INTERVAL ?? '120'),
    autoPost: charConfig.twitter.autoPost || config.SOCIAL_AUTO_POST === 'true',
  })

  // Initialize social engine (non-blocking — won't crash if unavailable)
  socialEngine.initialize().catch(err => {
    console.error('[Social] Failed to initialize:', err)
  })

  // ── Start bridges ───────────────────────────────────────────────────────
  const bridges: Array<{ sendProactiveMessage: (r: any) => Promise<void>; stop: () => Promise<void>; updatePresence?: (a: any) => void }> = []

  // Prefer per-character bridge config, fall back to .env
  const discordToken = charConfig.discord.botToken || config.DISCORD_BOT_TOKEN
  const discordEnabled = charConfig.discord.enabled || Boolean(config.DISCORD_BOT_TOKEN)
  if (discordEnabled && discordToken) {
    const { DiscordBridge } = await import('@opencrush/bridge-discord')
    const discord = new DiscordBridge({
      token: discordToken,
      clientId: charConfig.discord.clientId || (config.DISCORD_CLIENT_ID ?? ''),
      ownerId: charConfig.discord.ownerId || (config.DISCORD_OWNER_ID ?? ''),
      engine,
      media,
      voiceConversationEnabled: charConfig.voice.conversationEnabled || config.VOICE_CONVERSATION_ENABLED !== 'false',
    })
    await discord.start()
    bridges.push(discord)

    // Wire activity changes to Discord Rich Presence
    activityManager.setCallback((activity) => {
      discord.updatePresence(activity)
    })

    console.log(chalk.green(`  ✓ Discord bridge connected`))
  }

  const telegramToken = charConfig.telegram.botToken || config.TELEGRAM_BOT_TOKEN
  const telegramEnabled = charConfig.telegram.enabled || Boolean(config.TELEGRAM_BOT_TOKEN)
  if (telegramEnabled && telegramToken) {
    const { TelegramBridge } = await import('@opencrush/bridge-telegram')
    const telegram = new TelegramBridge({
      token: telegramToken,
      ownerId: parseInt(charConfig.telegram.ownerId || (config.TELEGRAM_OWNER_ID ?? '0')),
      engine,
      media,
    })
    await telegram.start()
    bridges.push(telegram)
    console.log(chalk.green(`  ✓ Telegram bridge connected`))
  }

  const whatsappEnabled = charConfig.whatsapp.enabled || config.WHATSAPP_ENABLED === 'true'
  if (whatsappEnabled) {
    console.log(chalk.yellow(`  ⚡ WhatsApp: Scan the QR code below with your phone...`))
    // WhatsApp bridge uses dynamic import as Baileys has complex deps
    try {
      const { WhatsAppBridge } = await import('@opencrush/bridge-whatsapp' as any)
      const wa = new WhatsAppBridge({ engine, media })
      await wa.start()
      bridges.push(wa)
      console.log(chalk.green(`  ✓ WhatsApp bridge connected`))
    } catch {
      console.log(chalk.yellow(`  ⚠ WhatsApp bridge not available yet (coming soon)`))
    }
  }

  if (bridges.length === 0) {
    console.log(chalk.red('\n  ❌ No messaging platforms configured!'))
    console.log(chalk.gray(`  Edit characters/${characterName}/config.json to enable platforms,`))
    console.log(chalk.gray('  or run "npx opencrush@latest setup" to reconfigure.\n'))
    cleanupPidFile()
    process.exit(1)
  }

  // ── Start autonomous scheduler with character-specific config ───────────
  const musicEngine = new MusicEngine({
    spotifyClientId: config.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: config.SPOTIFY_CLIENT_SECRET,
    seedArtists: characterActivityConfig.musicSeedArtists,
    seedGenres: characterActivityConfig.musicSeedGenres,
    curatedTracks: characterActivityConfig.curatedTracks,
  })

  const dramaEngine = new DramaEngine({
    tmdbApiKey: config.TMDB_API_KEY,
    preferredGenres: characterActivityConfig.dramaPreferredGenres,
    curatedShows: characterActivityConfig.curatedShows,
  })

  const scheduler = new AutonomousScheduler({
    engine,
    music: musicEngine,
    drama: dramaEngine,
    activityManager,
    browserAgent,
    socialEngine,
    mediaEngine: media,
    socialAutoPost: charConfig.twitter.autoPost || config.SOCIAL_AUTO_POST === 'true',
    charactersDir,
    quietHoursStart: charConfig.autonomous.quietHoursStart || parseInt(config.QUIET_HOURS_START ?? '23'),
    quietHoursEnd: charConfig.autonomous.quietHoursEnd || parseInt(config.QUIET_HOURS_END ?? '8'),
    minIntervalMinutes: charConfig.autonomous.proactiveMinInterval || parseInt(config.PROACTIVE_MESSAGE_MIN_INTERVAL ?? '60'),
    maxIntervalMinutes: charConfig.autonomous.proactiveMaxInterval || parseInt(config.PROACTIVE_MESSAGE_MAX_INTERVAL ?? '240'),
    youtubeTopics: characterActivityConfig.youtubeTopics,
    browseSites: characterActivityConfig.browseSites,
    onProactiveMessage: async (trigger) => {
      const response = await engine.generateProactiveMessage(trigger)
      // Send to all active bridges
      await Promise.allSettled(bridges.map(b => b.sendProactiveMessage(response)))
    },
  })

  await scheduler.start()
  console.log(chalk.green(`  ✓ Autonomous scheduler running`))

  // ── Ready ───────────────────────────────────────────────────────────────
  const gender = engine.characterBlueprint.gender
  const pronoun = gender === 'male' ? 'He' : gender === 'nonbinary' ? 'They' : 'She'
  const objectPronoun = gender === 'male' ? 'him' : gender === 'nonbinary' ? 'them' : 'her'
  console.log(chalk.magenta(`
  ══════════════════════════════════════
  💝 ${engine.characterName} is alive!
  ${pronoun}'${gender === 'nonbinary' ? 're' : 's'} waiting for you to message ${objectPronoun}.
  ══════════════════════════════════════
  `))

  // ── Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(chalk.yellow(`\n  Received ${signal}. Shutting down gracefully...`))
    scheduler.stop()
    await Promise.allSettled(bridges.map(b => b.stop()))
    cleanupPidFile()
    console.log(chalk.gray('  Goodbye 💝'))
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Prevent unhandled errors from crashing the process
  process.on('unhandledRejection', (err) => {
    console.error(chalk.red('  [Unhandled Rejection]'), err instanceof Error ? err.message : err)
  })
  process.on('uncaughtException', (err) => {
    console.error(chalk.red('  [Uncaught Exception]'), err.message)
    // Don't exit — let the bot keep running
  })
}

function loadConfig(): Record<string, string | undefined> {
  return {
    CHARACTER_NAME: process.env.CHARACTER_NAME,
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? 'anthropic',
    LLM_MODEL: process.env.LLM_MODEL,
    // International
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    // Chinese providers
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
    ZHIPU_API_KEY: process.env.ZHIPU_API_KEY,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    MINIMAX_GLOBAL_API_KEY: process.env.MINIMAX_GLOBAL_API_KEY,
    ZAI_API_KEY: process.env.ZAI_API_KEY,
    // Local
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    // Embedding
    JINA_API_KEY: process.env.JINA_API_KEY,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_OWNER_ID: process.env.DISCORD_OWNER_ID,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_OWNER_ID: process.env.TELEGRAM_OWNER_ID,
    WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
    FAL_KEY: process.env.FAL_KEY,
    IMAGE_MODEL: process.env.IMAGE_MODEL,
    IMAGE_REFERENCE_MODEL: process.env.IMAGE_REFERENCE_MODEL,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
    TTS_PROVIDER: process.env.TTS_PROVIDER,
    FISH_AUDIO_API_KEY: process.env.FISH_AUDIO_API_KEY,
    FISH_AUDIO_VOICE_ID: process.env.FISH_AUDIO_VOICE_ID,
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    QUIET_HOURS_START: process.env.QUIET_HOURS_START,
    QUIET_HOURS_END: process.env.QUIET_HOURS_END,
    PROACTIVE_MESSAGE_MIN_INTERVAL: process.env.PROACTIVE_MESSAGE_MIN_INTERVAL,
    PROACTIVE_MESSAGE_MAX_INTERVAL: process.env.PROACTIVE_MESSAGE_MAX_INTERVAL,
    VOICE_CONVERSATION_ENABLED: process.env.VOICE_CONVERSATION_ENABLED,
    BROWSER_AUTOMATION_ENABLED: process.env.BROWSER_AUTOMATION_ENABLED,
    BROWSER_MODE: process.env.BROWSER_MODE,                 // 'cdp' | 'persistent' | 'fresh'
    BROWSER_CDP_ENDPOINT: process.env.BROWSER_CDP_ENDPOINT, // default: http://localhost:9222
    BROWSER_PROFILE_DIR: process.env.BROWSER_PROFILE_DIR,   // default: ~/.opencrush/chrome-profile
    // Social media — Twitter/X
    TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID,
    TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET,
    TWITTER_API_KEY: process.env.TWITTER_API_KEY,
    TWITTER_API_SECRET: process.env.TWITTER_API_SECRET,
    TWITTER_CONSUMER_KEY: process.env.TWITTER_CONSUMER_KEY,
    TWITTER_CONSUMER_SECRET: process.env.TWITTER_CONSUMER_SECRET,
    TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
    TWITTER_ACCESS_TOKEN_SECRET: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    TWITTER_USERNAME: process.env.TWITTER_USERNAME,
    TWITTER_PASSWORD: process.env.TWITTER_PASSWORD,
    TWITTER_EMAIL: process.env.TWITTER_EMAIL,
    SOCIAL_MIN_POST_INTERVAL: process.env.SOCIAL_MIN_POST_INTERVAL, // minutes between posts (default: 120)
    SOCIAL_AUTO_POST: process.env.SOCIAL_AUTO_POST,                 // 'true' to enable auto-posting
  }
}

function validateConfig(config: Record<string, string | undefined>): void {
  if (!config.CHARACTER_NAME) {
    console.log(chalk.red('\n  ❌ CHARACTER_NAME not set in .env'))
    console.log(chalk.gray('  Run "npx opencrush@latest setup" to configure, or edit .env directly'))
    process.exit(1)
  }

  const hasLLM = config.ANTHROPIC_API_KEY || config.OPENAI_API_KEY || config.XAI_API_KEY
    || config.DEEPSEEK_API_KEY || config.DASHSCOPE_API_KEY
    || config.MOONSHOT_API_KEY || config.ZHIPU_API_KEY || config.MINIMAX_API_KEY
    || config.MINIMAX_GLOBAL_API_KEY || config.ZAI_API_KEY || config.LLM_PROVIDER === 'ollama'
  if (!hasLLM) {
    console.log(chalk.red('\n  ❌ No LLM API key configured'))
    console.log(chalk.gray('  Add one of these to .env:'))
    console.log(chalk.gray('  ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / DEEPSEEK_API_KEY'))
    console.log(chalk.gray('  DASHSCOPE_API_KEY / MOONSHOT_API_KEY / ZHIPU_API_KEY / MINIMAX_API_KEY'))
    console.log(chalk.gray('  Or set LLM_PROVIDER=ollama for local inference'))
    process.exit(1)
  }
}
