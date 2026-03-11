/**
 * Start Command
 *
 * Boots up the full Openlove stack:
 * 1. Load config from .env
 * 2. Initialize core engine (blueprint + memory)
 * 3. Start active bridges (Discord, Telegram, WhatsApp)
 * 4. Start autonomous scheduler
 * 5. Set up graceful shutdown
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(process.env.INIT_CWD ?? process.cwd(), '.env') })
import chalk from 'chalk'
import { ConversationEngine } from '@openlove/core'
import { MediaEngine } from '@openlove/media'
import { AutonomousScheduler, MusicEngine, DramaEngine, ActivityManager, BrowserAgent } from '@openlove/autonomous'
import { join } from 'path'

const ROOT_DIR = process.env.INIT_CWD ?? process.cwd()

export async function startOpenlove(): Promise<void> {
  console.log(chalk.magenta('\n  💝 Starting Openlove...\n'))

  // ── Validate environment ────────────────────────────────────────────────
  const config = loadConfig()
  validateConfig(config)

  // ── Initialize core engine ──────────────────────────────────────────────
  const engine = new ConversationEngine({
    characterName: config.CHARACTER_NAME,
    charactersDir: join(ROOT_DIR, 'characters'),
    llm: {
      provider: config.LLM_PROVIDER as any,
      // International
      anthropicApiKey: config.ANTHROPIC_API_KEY,
      openaiApiKey: config.OPENAI_API_KEY,
      // Chinese providers
      deepseekApiKey: config.DEEPSEEK_API_KEY,
      qwenApiKey: config.DASHSCOPE_API_KEY,
      kimiApiKey: config.MOONSHOT_API_KEY,
      zhipuApiKey: config.ZHIPU_API_KEY,
      minimaxApiKey: config.MINIMAX_API_KEY,
      // Local
      ollamaBaseUrl: config.OLLAMA_BASE_URL,
      ollamaModel: config.OLLAMA_MODEL,
      // Optional model override
      model: config.LLM_MODEL,
    },
  })

  console.log(chalk.green(`  ✓ ${engine.characterName} is waking up...`))
  console.log(chalk.gray(`  Provider: ${config.LLM_PROVIDER} | Character dir: ${join(ROOT_DIR, 'characters', config.CHARACTER_NAME!)}`))


  // ── Initialize media engine ─────────────────────────────────────────────
  const media = new MediaEngine({
    image: {
      falKey: config.FAL_KEY,
      model: config.IMAGE_MODEL,
    },
    voice: {
      elevenLabsApiKey: config.ELEVENLABS_API_KEY,
      elevenLabsVoiceId: config.ELEVENLABS_VOICE_ID,
      openaiApiKey: config.OPENAI_API_KEY,
      provider: config.TTS_PROVIDER as any ?? 'edge-tts',
    },
    video: {
      falKey: config.FAL_KEY,
    },
  })

  console.log(chalk.green(`  ✓ Media engine ready`))

  // ── Initialize activity manager ────────────────────────────────────────
  const activityManager = new ActivityManager()

  // Browser agent (optional — requires Playwright)
  let browserAgent: BrowserAgent | undefined
  if (config.BROWSER_AUTOMATION_ENABLED !== 'false') {
    browserAgent = new BrowserAgent()
  }

  // ── Start bridges ───────────────────────────────────────────────────────
  const bridges: Array<{ sendProactiveMessage: (r: any) => Promise<void>; stop: () => Promise<void>; updatePresence?: (a: any) => void }> = []

  if (config.DISCORD_BOT_TOKEN) {
    const { DiscordBridge } = await import('@openlove/bridge-discord')
    const discord = new DiscordBridge({
      token: config.DISCORD_BOT_TOKEN,
      clientId: config.DISCORD_CLIENT_ID ?? '',
      ownerId: config.DISCORD_OWNER_ID ?? '',
      engine,
      media,
      voiceConversationEnabled: config.VOICE_CONVERSATION_ENABLED !== 'false',
    })
    await discord.start()
    bridges.push(discord)

    // Wire activity changes to Discord Rich Presence
    activityManager.setCallback((activity) => {
      discord.updatePresence(activity)
    })

    console.log(chalk.green(`  ✓ Discord bridge connected`))
  }

  if (config.TELEGRAM_BOT_TOKEN) {
    const { TelegramBridge } = await import('@openlove/bridge-telegram')
    const telegram = new TelegramBridge({
      token: config.TELEGRAM_BOT_TOKEN,
      ownerId: parseInt(config.TELEGRAM_OWNER_ID ?? '0'),
      engine,
      media,
    })
    await telegram.start()
    bridges.push(telegram)
    console.log(chalk.green(`  ✓ Telegram bridge connected`))
  }

  if (config.WHATSAPP_ENABLED === 'true') {
    console.log(chalk.yellow(`  ⚡ WhatsApp: Scan the QR code below with your phone...`))
    // WhatsApp bridge uses dynamic import as Baileys has complex deps
    try {
      const { WhatsAppBridge } = await import('@openlove/bridge-whatsapp' as any)
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
    console.log(chalk.gray('  Add at least one: DISCORD_BOT_TOKEN or TELEGRAM_BOT_TOKEN in .env'))
    process.exit(1)
  }

  // ── Start autonomous scheduler ──────────────────────────────────────────
  const musicEngine = new MusicEngine({
    spotifyClientId: config.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: config.SPOTIFY_CLIENT_SECRET,
  })

  const dramaEngine = new DramaEngine({
    tmdbApiKey: config.TMDB_API_KEY,
  })

  const scheduler = new AutonomousScheduler({
    engine,
    music: musicEngine,
    drama: dramaEngine,
    activityManager,
    browserAgent,
    quietHoursStart: parseInt(config.QUIET_HOURS_START ?? '23'),
    quietHoursEnd: parseInt(config.QUIET_HOURS_END ?? '8'),
    minIntervalMinutes: parseInt(config.PROACTIVE_MESSAGE_MIN_INTERVAL ?? '60'),
    maxIntervalMinutes: parseInt(config.PROACTIVE_MESSAGE_MAX_INTERVAL ?? '240'),
    onProactiveMessage: async (trigger) => {
      const response = await engine.generateProactiveMessage(trigger)
      // Send to all active bridges
      await Promise.allSettled(bridges.map(b => b.sendProactiveMessage(response)))
    },
  })

  await scheduler.start()
  console.log(chalk.green(`  ✓ Autonomous scheduler running`))

  // ── Ready ───────────────────────────────────────────────────────────────
  console.log(chalk.magenta(`
  ══════════════════════════════════════
  💝 ${engine.characterName} is alive!
  She's waiting for you to message her.
  ══════════════════════════════════════
  `))

  // ── Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(chalk.yellow(`\n  Received ${signal}. Shutting down gracefully...`))
    scheduler.stop()
    await Promise.allSettled(bridges.map(b => b.stop()))
    console.log(chalk.gray('  Goodbye 💝'))
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

function loadConfig(): Record<string, string | undefined> {
  return {
    CHARACTER_NAME: process.env.CHARACTER_NAME,
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? 'anthropic',
    LLM_MODEL: process.env.LLM_MODEL,
    // International
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    // Chinese providers
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
    ZHIPU_API_KEY: process.env.ZHIPU_API_KEY,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    // Local
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_OWNER_ID: process.env.DISCORD_OWNER_ID,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_OWNER_ID: process.env.TELEGRAM_OWNER_ID,
    WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
    FAL_KEY: process.env.FAL_KEY,
    IMAGE_MODEL: process.env.IMAGE_MODEL,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
    TTS_PROVIDER: process.env.TTS_PROVIDER,
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    QUIET_HOURS_START: process.env.QUIET_HOURS_START,
    QUIET_HOURS_END: process.env.QUIET_HOURS_END,
    PROACTIVE_MESSAGE_MIN_INTERVAL: process.env.PROACTIVE_MESSAGE_MIN_INTERVAL,
    PROACTIVE_MESSAGE_MAX_INTERVAL: process.env.PROACTIVE_MESSAGE_MAX_INTERVAL,
    VOICE_CONVERSATION_ENABLED: process.env.VOICE_CONVERSATION_ENABLED,
    BROWSER_AUTOMATION_ENABLED: process.env.BROWSER_AUTOMATION_ENABLED,
  }
}

function validateConfig(config: Record<string, string | undefined>): void {
  if (!config.CHARACTER_NAME) {
    console.log(chalk.red('\n  ❌ CHARACTER_NAME not set in .env'))
    console.log(chalk.gray('  Run "pnpm setup" to configure, or edit .env directly'))
    process.exit(1)
  }

  const hasLLM = config.ANTHROPIC_API_KEY || config.OPENAI_API_KEY
    || config.DEEPSEEK_API_KEY || config.DASHSCOPE_API_KEY
    || config.MOONSHOT_API_KEY || config.ZHIPU_API_KEY || config.MINIMAX_API_KEY
    || config.LLM_PROVIDER === 'ollama'
  if (!hasLLM) {
    console.log(chalk.red('\n  ❌ No LLM API key configured'))
    console.log(chalk.gray('  Add one of these to .env:'))
    console.log(chalk.gray('  ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY'))
    console.log(chalk.gray('  DASHSCOPE_API_KEY / MOONSHOT_API_KEY / ZHIPU_API_KEY / MINIMAX_API_KEY'))
    console.log(chalk.gray('  Or set LLM_PROVIDER=ollama for local inference'))
    process.exit(1)
  }
}
