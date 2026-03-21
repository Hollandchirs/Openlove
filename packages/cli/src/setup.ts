/**
 * Interactive Setup Wizard
 *
 * Guides first-time users through:
 * 1. API key configuration
 * 2. Platform selection (Discord/Telegram/WhatsApp)
 * 3. Character creation (or loads existing)
 * 4. Writes .env file
 *
 * Design goal: a 12-year-old should be able to follow this.
 */

import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import boxen from 'boxen'
import { writeFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { createCharacterFlow } from './create.js'
import { runTestChat } from './test-chat.js'
import { PROVIDER_INFO, detectRegion, getProviderInfo } from './llm-direct.js'

// pnpm sets INIT_CWD to where the user ran the command from (project root)
// fall back to process.cwd() if not set
const ROOT_DIR = process.env.INIT_CWD ?? process.cwd()

export async function runSetupWizard(): Promise<void> {
  console.clear()
  console.log(chalk.magenta(`
  ╔═══════════════════════════════════════╗
  ║        💝  O P E N C R U S H          ║
  ║    Your AI companion, always there    ║
  ╚═══════════════════════════════════════╝
  `))

  console.log(chalk.cyan('Welcome! Let\'s set up your companion in a few steps.\n'))
  console.log(chalk.gray('This will create a .env file with your settings.\n'))

  // ── Step 1: LLM Provider ────────────────────────────────────────────────
  const region = detectRegion()
  const isCN = region === 'cn'

  console.log(chalk.bold('\n📡 Step 1: Choose your AI brain\n'))
  if (isCN) {
    console.log(chalk.cyan('  检测到中国大陆时区 — 优先显示国内可直连的模型\n'))
  } else {
    console.log(chalk.gray('  Your companion needs an AI to think. All providers below work.\n'))
  }

  // Build choice list — CN providers first for CN region
  const cnFirst  = PROVIDER_INFO.filter(p => !p.requiresVPN && !p.isLocal)
  const intl     = PROVIDER_INFO.filter(p =>  p.requiresVPN)
  const local    = PROVIDER_INFO.filter(p =>  p.isLocal)

  const orderedProviders = isCN
    ? [...cnFirst, ...intl, ...local]
    : [PROVIDER_INFO.find(p => p.id === 'anthropic')!, PROVIDER_INFO.find(p => p.id === 'openai')!, ...cnFirst, ...local]

  const { llmProvider } = await inquirer.prompt([{
    type: 'list',
    name: 'llmProvider',
    message: isCN ? '选择 AI 模型提供商:' : 'Which AI provider?',
    choices: orderedProviders.map(p => ({
      name: `${p.emoji}  ${p.name}\n     ${chalk.gray(isCN ? p.taglineCN : p.tagline)}`,
      value: p.id,
      short: p.name,
    })),
  }])

  const envValues: Record<string, string> = { LLM_PROVIDER: llmProvider }
  const providerInfo = getProviderInfo(llmProvider)!

  // ── Collect API key for non-Ollama providers ──
  if (llmProvider !== 'ollama') {
    const keyUrl = isCN ? providerInfo.keyUrlCN : providerInfo.keyUrl
    console.log(chalk.yellow(`\n  👉 ${isCN ? '获取 API Key: ' : 'Get API key: '}${keyUrl}\n`))

    if (llmProvider === 'anthropic') {
      console.log(chalk.gray(isCN
        ? '  1. 注册账号 → API Keys → Create Key\n  2. 复制以 "sk-ant-" 开头的密钥\n'
        : '  1. Create account → API Keys → Create Key\n  2. Copy the key (starts with "sk-ant-")\n'
      ))
    } else if (llmProvider === 'openai') {
      console.log(chalk.gray(isCN
        ? '  1. 注册 → API Keys → Create new secret key\n'
        : '  1. Sign up → API Keys → Create new secret key\n'
      ))
    } else if (llmProvider === 'deepseek') {
      console.log(chalk.gray(isCN
        ? '  1. 注册 → API Keys → 创建 API Key\n  2. 新用户有免费额度\n'
        : '  1. Sign up → API Keys → Create key\n  2. New users get free credits\n'
      ))
    } else if (llmProvider === 'qwen') {
      console.log(chalk.gray(isCN
        ? '  1. 登录阿里云控制台 → DashScope → API-KEY管理 → 创建\n'
        : '  1. Aliyun console → DashScope → API-KEY management → Create\n'
      ))
    } else if (llmProvider === 'kimi') {
      console.log(chalk.gray(isCN
        ? '  1. 注册月之暗面 → 控制台 → API Keys → 新建\n'
        : '  1. Sign up at Moonshot → Console → API Keys → New\n'
      ))
    } else if (llmProvider === 'zhipu') {
      console.log(chalk.gray(isCN
        ? '  1. 注册智谱开放平台 → 个人中心 → API Keys → 添加\n  2. 新用户赠送免费 tokens\n'
        : '  1. Sign up at open.bigmodel.cn → API Keys → Add\n  2. Free tokens on signup\n'
      ))
    } else if (llmProvider === 'minimax') {
      console.log(chalk.gray(isCN
        ? '  1. 注册 MiniMax 开放平台 → 账号设置 → 接口密钥\n'
        : '  1. Sign up at platform.minimaxi.com → Account → API Keys\n'
      ))
    }

    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: isCN ? `粘贴你的 ${providerInfo.name} API Key:` : `Paste your ${providerInfo.name} API key:`,
      mask: '*',
      validate: (v: string) => {
        if (!v.trim()) return isCN ? '请输入 API Key' : 'API key required'
        if (providerInfo.keyPrefix && !v.startsWith(providerInfo.keyPrefix)) {
          return isCN
            ? `Key 格式不对，应以 "${providerInfo.keyPrefix}" 开头`
            : `Should start with "${providerInfo.keyPrefix}"`
        }
        return true
      },
    }])

    envValues[providerInfo.envKey] = apiKey
  }

  // ── Ollama ──
  if (llmProvider === 'ollama') {
    console.log(chalk.yellow(isCN
      ? '\n  确保 Ollama 已运行: https://ollama.ai'
      : '\n  Make sure Ollama is running: https://ollama.ai'
    ))
    console.log(chalk.gray(isCN
      ? '  运行: ollama pull qwen2.5:7b\n'
      : '  Run: ollama pull qwen2.5:7b\n'
    ))
    envValues.OLLAMA_BASE_URL = 'http://localhost:11434'
    envValues.OLLAMA_MODEL = 'qwen2.5:7b'
  }

  // ── Step 2: Character ────────────────────────────────────────────────────
  console.log(chalk.bold('\n\n💝 Step 2: Your companion\n'))

  const characters = getExistingCharacters()
  let characterName: string

  if (characters.length > 0) {
    const { characterChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'characterChoice',
      message: 'Use an existing companion or create a new one?',
      choices: [
        ...characters.map(c => ({ name: `✨ ${c} (existing)`, value: c })),
        { name: '➕ Create a new companion', value: '__new__' },
      ],
    }])

    if (characterChoice === '__new__') {
      const apiKey = envValues[providerInfo.envKey]
      const created = await createCharacterFlow(apiKey, llmProvider)
      characterName = created.folderName
      await runTestChat(characterName, apiKey, llmProvider)
    } else {
      characterName = characterChoice
    }
  } else {
    console.log(chalk.gray('  No companions yet — let\'s create one!\n'))
    const apiKey = envValues[providerInfo.envKey]
    const created = await createCharacterFlow(apiKey, llmProvider)
    characterName = created.folderName
    await runTestChat(characterName, apiKey, llmProvider)
  }

  envValues.CHARACTER_NAME = characterName

  // ── Step 3: Messaging Platform ───────────────────────────────────────────
  console.log(chalk.bold('\n\n📱 Step 3: Where do you want to chat?\n'))

  const { platforms } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'platforms',
    message: 'Select messaging platforms (use space to toggle, enter to confirm):',
    choices: [
      {
        name: '🎮 Discord (Recommended — supports voice calls)',
        value: 'discord',
        checked: true,
      },
      {
        name: '📬 Telegram',
        value: 'telegram',
      },
      {
        name: '💬 WhatsApp (uses QR code — no extra account needed)',
        value: 'whatsapp',
      },
    ],
    validate: (choices: string[]) => choices.length > 0 ? true : 'Pick at least one platform',
  }])

  if (platforms.includes('discord')) {
    console.log(chalk.yellow('\n  👉 Discord Bot Setup (takes ~2 minutes):'))
    console.log(chalk.gray('  1. Go to: https://discord.com/developers/applications'))
    console.log(chalk.gray('  2. Click "New Application" → give it your companion\'s name'))
    console.log(chalk.gray('  3. Click "Bot" in the left menu → "Reset Token" → Copy the token'))
    console.log(chalk.gray('  4. Enable "Message Content Intent" on the same page\n'))

    const discordAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'Paste your Discord Bot Token:',
        mask: '*',
      },
      {
        type: 'input',
        name: 'clientId',
        message: 'Application (Client) ID:\n  (Discord Developer Portal → General Information → Application ID)\n  ID: ',
        validate: (v: string) => /^\d{17,20}$/.test(v) ? true : 'Should be a number like 123456789012345678',
      },
      {
        type: 'input',
        name: 'ownerId',
        message: 'Your Discord User ID:\n  (Right-click your name in Discord → Copy User ID. Enable Developer Mode in Settings first)\n  ID: ',
        validate: (v: string) => /^\d{17,20}$/.test(v) ? true : 'Should be a number like 123456789012345678',
      },
    ])
    envValues.DISCORD_BOT_TOKEN = discordAnswers.token
    envValues.DISCORD_CLIENT_ID = discordAnswers.clientId
    envValues.DISCORD_OWNER_ID = discordAnswers.ownerId

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${discordAnswers.clientId}&permissions=277025770560&scope=bot`
    console.log(chalk.cyan(`\n  📋 Invite your bot to a server:`))
    console.log(chalk.white(`  ${inviteUrl}\n`))
  }

  if (platforms.includes('telegram')) {
    console.log(chalk.yellow('\n  👉 Telegram Bot Setup:'))
    console.log(chalk.gray('  1. Open Telegram → search for @BotFather'))
    console.log(chalk.gray('  2. Send /newbot → follow the steps'))
    console.log(chalk.gray('  3. Copy the token it gives you\n'))
    console.log(chalk.gray('  4. Find your user ID: search @userinfobot → send it /start\n'))

    const telegramAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'Paste your Telegram Bot Token:',
        mask: '*',
      },
      {
        type: 'input',
        name: 'ownerId',
        message: 'Your Telegram User ID (a number like 123456789):',
        validate: (v: string) => /^\d+$/.test(v) ? true : 'Should be a number',
      },
    ])
    envValues.TELEGRAM_BOT_TOKEN = telegramAnswers.token
    envValues.TELEGRAM_OWNER_ID = telegramAnswers.ownerId
  }

  if (platforms.includes('whatsapp')) {
    envValues.WHATSAPP_ENABLED = 'true'
    console.log(chalk.cyan('\n  ℹ️ WhatsApp: No token needed! A QR code will appear when you start.'))
    console.log(chalk.gray('  You\'ll scan it with WhatsApp on your phone (Linked Devices).'))
  }

  // ── Step 4: Sensory Features ────────────────────────────────────────────
  console.log(chalk.bold('\n\n✨ Step 4: Sensory features\n'))
  console.log(chalk.gray(isCN
    ? '这些功能让你的伴侣更加真实——看得见、听得到、有自己的社交圈。\n'
    : 'These features make your companion come alive — visible, audible, and social.\n'))

  const { optionalFeatures } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'optionalFeatures',
    message: isCN ? '选择要启用的感官功能:' : 'Which features do you want?',
    choices: [
      { name: isCN
        ? '📸 自拍 & 视频 — 可以发自拍和短视频 (需要 fal.ai key)'
        : '📸 Selfies & Video — send photos and short videos (needs fal.ai key)',
        value: 'images', checked: true },
      { name: isCN
        ? '🎤 语音消息 — 可以发语音 (ElevenLabs / Fish Audio / FAL Kokoro)'
        : '🎤 Voice messages — send voice notes (ElevenLabs / Fish Audio / FAL Kokoro)',
        value: 'voice' },
      { name: isCN
        ? '🐦 Twitter/X — 自主发推文、分享生活 (需要 Twitter API)'
        : '🐦 Twitter/X — post tweets autonomously, share life moments (needs Twitter API)',
        value: 'twitter' },
      { name: isCN
        ? '🌐 浏览器 — 能浏览网页、看视频、听音乐、分享截图'
        : '🌐 Browser — browse web, watch videos, listen to music, share screenshots',
        value: 'browser' },
      { name: isCN
        ? '🎵 Spotify 联动 — 在 Spotify 听歌并分享 (需要 Spotify API)'
        : '🎵 Spotify — listen to music on Spotify and share songs (needs Spotify key)',
        value: 'spotify' },
    ],
  }])

  if (optionalFeatures.includes('images')) {
    console.log(chalk.yellow('\n  👉 fal.ai API key (free credits on signup):'))
    console.log(chalk.gray('  https://fal.ai → Sign up → Dashboard → API Keys\n'))
    const { falKey } = await inquirer.prompt([{
      type: 'password',
      name: 'falKey',
      message: 'Paste your fal.ai API key (or press Enter to skip):',
      mask: '*',
    }])
    if (falKey) envValues.FAL_KEY = falKey
  }

  if (optionalFeatures.includes('voice')) {
    const { ttsProvider } = await inquirer.prompt([{
      type: 'list',
      name: 'ttsProvider',
      message: isCN ? '选择语音合成（TTS）提供商:' : 'Which voice provider?',
      choices: [
        {
          name: `🗣️  ElevenLabs\n     ${chalk.gray(isCN ? '最自然、情感丰富，$5/月或免费额度' : 'Most natural, emotional — $5/mo or free tier')}`,
          value: 'elevenlabs',
          short: 'ElevenLabs',
        },
        {
          name: `🐟  Fish Audio\n     ${chalk.gray(isCN ? '中英文支持好，有免费额度' : 'Good Chinese/English, free tier available')}`,
          value: 'fishaudio',
          short: 'Fish Audio',
        },
        {
          name: `⚡  FAL Kokoro\n     ${chalk.gray(isCN ? '最便宜 $0.02/千字符，用已有的 fal.ai key' : 'Cheapest $0.02/1K chars, reuses your fal.ai key')}`,
          value: 'fal',
          short: 'FAL Kokoro',
        },
      ],
    }])

    envValues.TTS_PROVIDER = ttsProvider

    if (ttsProvider === 'elevenlabs') {
      console.log(chalk.yellow('\n  👉 ElevenLabs API key (10,000 characters/month free):'))
      console.log(chalk.gray('  https://elevenlabs.io → Sign up → Profile → API Key\n'))
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Paste your ElevenLabs API key (or press Enter to skip):',
          mask: '*',
        },
        {
          type: 'input',
          name: 'voiceId',
          message: isCN ? 'Voice ID（可选，默认 Rachel）:' : 'Voice ID (optional, default Rachel):',
        },
      ])
      if (answers.apiKey) envValues.ELEVENLABS_API_KEY = answers.apiKey
      if (answers.voiceId) envValues.ELEVENLABS_VOICE_ID = answers.voiceId
    }

    if (ttsProvider === 'fishaudio') {
      console.log(chalk.yellow('\n  👉 Fish Audio API key:'))
      console.log(chalk.gray('  https://fish.audio → Sign up → Profile → API Keys\n'))
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Paste your Fish Audio API key (or press Enter to skip):',
          mask: '*',
        },
        {
          type: 'input',
          name: 'voiceId',
          message: isCN ? 'Voice ID（在 fish.audio 声音库找）:' : 'Voice ID (find in Fish Audio voice library):',
        },
      ])
      if (answers.apiKey) envValues.FISH_AUDIO_API_KEY = answers.apiKey
      if (answers.voiceId) envValues.FISH_AUDIO_VOICE_ID = answers.voiceId
    }

    if (ttsProvider === 'fal') {
      console.log(chalk.cyan(isCN
        ? '\n  ℹ️ FAL Kokoro 使用你已有的 fal.ai key，无需额外配置'
        : '\n  ℹ️ FAL Kokoro reuses your fal.ai key — no extra setup needed'
      ))
      if (!envValues.FAL_KEY) {
        console.log(chalk.yellow('  👉 https://fal.ai → Dashboard → API Keys\n'))
        const { falKey } = await inquirer.prompt([{
          type: 'password',
          name: 'falKey',
          message: 'Paste your fal.ai API key:',
          mask: '*',
        }])
        if (falKey) envValues.FAL_KEY = falKey
      }
    }
  }

  if (optionalFeatures.includes('twitter')) {
    console.log(chalk.yellow(isCN
      ? '\n  👉 Twitter/X API 设置 (OAuth 2.0 — 支持 Free tier):'
      : '\n  👉 Twitter/X API Setup (OAuth 2.0 — works on Free tier):'))
    console.log(chalk.gray(isCN
      ? '  1. 前往: https://developer.x.com → Dashboard → Create App'
      : '  1. Go to: https://developer.x.com → Dashboard → Create App'))
    console.log(chalk.gray(isCN
      ? '  2. User authentication settings → 开启 OAuth 2.0'
      : '  2. User authentication settings → Enable OAuth 2.0'))
    console.log(chalk.gray(isCN
      ? '  3. App permissions: Read and Write'
      : '  3. App permissions: Read and Write'))
    console.log(chalk.gray(isCN
      ? '  4. Callback URL: https://localhost'
      : '  4. Callback URL: https://localhost'))
    console.log(chalk.gray(isCN
      ? '  5. Keys and tokens → 复制 OAuth 2.0 Client ID 和 Client Secret\n'
      : '  5. Keys and tokens → Copy OAuth 2.0 Client ID and Client Secret\n'))

    const twitterAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'clientId',
        message: isCN ? 'OAuth 2.0 Client ID:' : 'OAuth 2.0 Client ID:',
        mask: '*',
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: isCN ? 'OAuth 2.0 Client Secret:' : 'OAuth 2.0 Client Secret:',
        mask: '*',
      },
    ])
    if (twitterAnswers.clientId) {
      envValues.TWITTER_CLIENT_ID = twitterAnswers.clientId
      envValues.TWITTER_CLIENT_SECRET = twitterAnswers.clientSecret
      envValues.SOCIAL_AUTO_POST = 'true'
    }

    console.log(chalk.cyan(isCN
      ? '\n  ℹ️  设置完成后，运行 `node test-twitter-oauth2.mjs` 完成 OAuth 授权'
      : '\n  ℹ️  After setup, run `node test-twitter-oauth2.mjs` to complete OAuth authorization'))
    console.log(chalk.gray(isCN
      ? '  这会打开浏览器，授权后 AI 就可以自动发推了'
      : '  This opens a browser to authorize — after that, your AI can post tweets automatically'))
  }

  if (optionalFeatures.includes('browser')) {
    console.log(chalk.bold(isCN ? '\n  🌐 浏览器设置\n' : '\n  🌐 Browser Setup\n'))
    console.log(chalk.gray(isCN
      ? '  你的伴侣可以浏览网页、看 YouTube、刷 Twitter，还能给你分享截图。'
      : '  Your companion can browse the web, watch YouTube, scroll Twitter, and share screenshots.'))
    console.log(chalk.gray(isCN
      ? '  需要安装 Playwright: npx playwright install chromium\n'
      : '  Requires Playwright: npx playwright install chromium\n'))

    const { browserMode } = await inquirer.prompt([{
      type: 'list',
      name: 'browserMode',
      message: isCN ? '浏览器模式:' : 'Browser mode:',
      choices: [
        {
          name: isCN
            ? `🔌 CDP — 连接到你正在用的 Chrome (推荐)\n     ${chalk.gray('用: chrome://flags → Remote Debugging')}`
            : `🔌 CDP — Connect to your running Chrome (recommended)\n     ${chalk.gray('Enable: chrome://flags → Remote Debugging')}`,
          value: 'cdp',
          short: 'CDP',
        },
        {
          name: isCN
            ? `💾 Persistent — 独立浏览器，保留登录状态\n     ${chalk.gray('独立于你的浏览器运行')}`
            : `💾 Persistent — Separate browser, keeps login state\n     ${chalk.gray('Runs independently from your browser')}`,
          value: 'persistent',
          short: 'Persistent',
        },
        {
          name: isCN
            ? `🧪 Fresh — 每次启动新浏览器（无历史记录）`
            : `🧪 Fresh — New browser each time (no history)`,
          value: 'fresh',
          short: 'Fresh',
        },
      ],
    }])

    envValues.BROWSER_AUTOMATION_ENABLED = 'true'
    envValues.BROWSER_MODE = browserMode

    if (browserMode === 'cdp') {
      console.log(chalk.gray(isCN
        ? '\n  默认端口 9222，可自定义:'
        : '\n  Default port 9222, or customize:'))
      const { cdpEndpoint } = await inquirer.prompt([{
        type: 'input',
        name: 'cdpEndpoint',
        message: 'CDP endpoint:',
        default: 'http://localhost:9222',
        validate: (v: string) => {
          try {
            const url = new URL(v)
            if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
              return 'CDP must connect to localhost for security'
            }
            return true
          } catch { return 'Enter a valid URL like http://localhost:9222' }
        },
      }])
      envValues.BROWSER_CDP_ENDPOINT = cdpEndpoint
    }
  }

  if (optionalFeatures.includes('spotify')) {
    console.log(chalk.yellow('\n  👉 Spotify API (free):'))
    console.log(chalk.gray('  https://developer.spotify.com/dashboard → Create App → Copy Client ID & Secret\n'))
    const spotifyAnswers = await inquirer.prompt([
      { type: 'password', name: 'clientId', message: 'Spotify Client ID:', mask: '*' },
      { type: 'password', name: 'clientSecret', message: 'Spotify Client Secret:', mask: '*' },
    ])
    if (spotifyAnswers.clientId) {
      envValues.SPOTIFY_CLIENT_ID = spotifyAnswers.clientId
      envValues.SPOTIFY_CLIENT_SECRET = spotifyAnswers.clientSecret
    }
  }

  // ── Step 5: Behavior & Schedule ──────────────────────────────────────────
  console.log(chalk.bold(isCN ? '\n\n⏰ Step 5: 行为 & 日程\n' : '\n\n⏰ Step 5: Behavior & Schedule\n'))
  console.log(chalk.gray(isCN
    ? '你的伴侣有自己的日常节奏——工作、放松、睡觉。这些设置控制她的自主行为。\n'
    : 'Your companion has a daily rhythm — work, relax, sleep. These settings control autonomous behavior.\n'))

  const scheduleAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'quietStart',
      message: isCN ? '几点开始安静时间（不主动发消息）? (0-23):' : 'When does quiet time start (no proactive messages)? (0-23):',
      default: '23',
      validate: (v: string) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 23 ? true : 'Enter a whole number 0–23' },
    },
    {
      type: 'input',
      name: 'quietEnd',
      message: isCN ? '几点结束安静时间? (0-23):' : 'When does quiet time end? (0-23):',
      default: '8',
      validate: (v: string) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 23 ? true : 'Enter a whole number 0–23' },
    },
    {
      type: 'list',
      name: 'proactiveFrequency',
      message: isCN ? '主动给你发消息的频率:' : 'How often should she message you on her own?',
      choices: [
        { name: isCN ? '🔥 经常 (1-2 小时)' : '🔥 Often (every 1-2 hours)', value: 'frequent' },
        { name: isCN ? '⚡ 适中 (2-4 小时) — 推荐' : '⚡ Moderate (every 2-4 hours) — recommended', value: 'moderate' },
        { name: isCN ? '🌙 偶尔 (4-8 小时)' : '🌙 Occasionally (every 4-8 hours)', value: 'rare' },
        { name: isCN ? '🔇 从不主动' : '🔇 Never — only reply when I talk first', value: 'never' },
      ],
      default: 'moderate',
    },
  ])

  envValues.QUIET_HOURS_START = scheduleAnswers.quietStart
  envValues.QUIET_HOURS_END = scheduleAnswers.quietEnd

  const frequencyMap: Record<string, [string, string]> = {
    frequent: ['60', '120'],
    moderate: ['120', '240'],
    rare: ['240', '480'],
    never: ['99999', '99999'],
  }
  const [minInterval, maxInterval] = frequencyMap[scheduleAnswers.proactiveFrequency] ?? ['120', '240']
  envValues.PROACTIVE_MESSAGE_MIN_INTERVAL = minInterval
  envValues.PROACTIVE_MESSAGE_MAX_INTERVAL = maxInterval

  // ── Write .env ────────────────────────────────────────────────────────────
  const spinner = ora('Writing configuration...').start()

  const envContent = generateEnvFile(envValues)
  writeFileSync(join(ROOT_DIR, '.env'), envContent, 'utf-8')

  spinner.succeed('Configuration saved to .env')

  // ── Build feature summary ────────────────────────────────────────────────
  const enabledFeatures: string[] = []
  enabledFeatures.push(`🧠 AI: ${providerInfo.name}`)
  enabledFeatures.push(`💝 Character: ${characterName}`)
  if (platforms.includes('discord'))  enabledFeatures.push('🎮 Discord')
  if (platforms.includes('telegram')) enabledFeatures.push('📬 Telegram')
  if (platforms.includes('whatsapp')) enabledFeatures.push('💬 WhatsApp')
  if (optionalFeatures.includes('images'))  enabledFeatures.push('📸 Selfies & Video')
  if (optionalFeatures.includes('voice'))   enabledFeatures.push(`🎤 Voice (${envValues.TTS_PROVIDER ?? 'n/a'})`)
  if (optionalFeatures.includes('twitter')) enabledFeatures.push('🐦 Twitter (auto-post)')
  if (optionalFeatures.includes('browser')) enabledFeatures.push(`🌐 Browser (${envValues.BROWSER_MODE})`)
  if (optionalFeatures.includes('spotify')) enabledFeatures.push('🎵 Spotify')
  enabledFeatures.push('💕 Emotion engine (auto)')
  enabledFeatures.push('🤝 Relationship tracking (auto)')
  enabledFeatures.push('🧠 Memory system (auto)')
  enabledFeatures.push(`⏰ Quiet hours: ${scheduleAnswers.quietStart}:00 – ${scheduleAnswers.quietEnd}:00`)

  const postSetupSteps: string[] = []
  if (optionalFeatures.includes('twitter')) {
    postSetupSteps.push(isCN
      ? '  → 运行 node test-twitter-oauth2.mjs 完成 Twitter 授权'
      : '  → Run node test-twitter-oauth2.mjs to authorize Twitter')
  }
  if (optionalFeatures.includes('browser')) {
    postSetupSteps.push(isCN
      ? '  → 运行 npx playwright install chromium 安装浏览器'
      : '  → Run npx playwright install chromium to install browser')
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n' + boxen(
    chalk.green('✅ Setup complete!\n\n') +
    chalk.white('Enabled features:\n') +
    enabledFeatures.map(f => chalk.cyan(`  ${f}`)).join('\n') + '\n\n' +
    (postSetupSteps.length > 0
      ? chalk.yellow('Next steps:\n') + postSetupSteps.join('\n') + '\n\n'
      : '') +
    chalk.white('Start your companion:\n') +
    chalk.cyan('  pnpm start\n\n') +
    chalk.white('Edit personality anytime:\n') +
    chalk.cyan(`  characters/${characterName}/SOUL.md\n\n`) +
    chalk.gray('Need help? https://github.com/Hollandchirs/Opencrush'),
    { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'magenta' }
  ))
}

function getExistingCharacters(): string[] {
  const charactersDir = join(ROOT_DIR, 'characters')
  if (!existsSync(charactersDir)) return []
  try {
    return readdirSync(charactersDir, { withFileTypes: true })
      .filter((d: any) => d.isDirectory() && d.name !== 'example')
      .map((d: any) => d.name)
  } catch (err) {
    console.warn('[Setup] Failed to list characters:', (err as Error).message)
    return []
  }
}

function generateEnvFile(values: Record<string, string>): string {
  const sections: Record<string, string[]> = {
    '# ── AI Provider ──': ['LLM_PROVIDER', 'LLM_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY', 'ZHIPU_API_KEY', 'MINIMAX_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'JINA_API_KEY'],
    '# ── Character ──': ['CHARACTER_NAME'],
    '# ── Messaging Platforms ──': ['DISCORD_BOT_TOKEN', 'DISCORD_OWNER_ID', 'DISCORD_CLIENT_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'WHATSAPP_ENABLED'],
    '# ── Media (Selfies, Voice, Video) ──': ['FAL_KEY', 'IMAGE_MODEL', 'IMAGE_REFERENCE_MODEL', 'TTS_PROVIDER', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'FISH_AUDIO_API_KEY', 'FISH_AUDIO_VOICE_ID'],
    '# ── Twitter/X ──': ['TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET', 'SOCIAL_AUTO_POST', 'SOCIAL_MIN_POST_INTERVAL'],
    '# ── Browser Automation ──': ['BROWSER_AUTOMATION_ENABLED', 'BROWSER_MODE', 'BROWSER_CDP_ENDPOINT', 'BROWSER_PROFILE_DIR'],
    '# ── Spotify ──': ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
    '# ── Behavior & Schedule ──': ['QUIET_HOURS_START', 'QUIET_HOURS_END', 'PROACTIVE_MESSAGE_MIN_INTERVAL', 'PROACTIVE_MESSAGE_MAX_INTERVAL'],
  }

  const lines = [
    '# Opencrush Configuration',
    '# Generated by setup wizard — you can edit this file anytime',
    '# Emotion engine, relationship tracking, and memory are auto-enabled.',
    '',
  ]

  const used = new Set<string>()

  for (const [header, keys] of Object.entries(sections)) {
    const sectionLines: string[] = []
    for (const key of keys) {
      if (values[key] !== undefined) {
        sectionLines.push(`${key}=${values[key]}`)
        used.add(key)
      }
    }
    if (sectionLines.length > 0) {
      lines.push(header)
      lines.push(...sectionLines)
      lines.push('')
    }
  }

  // Any remaining keys not covered by sections
  for (const [key, value] of Object.entries(values)) {
    if (!used.has(key)) {
      lines.push(`${key}=${value}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
