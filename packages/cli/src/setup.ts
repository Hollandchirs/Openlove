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
  ║          💝  O P E N L O V E          ║
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
      const apiKey = envValues.ANTHROPIC_API_KEY ?? envValues.OPENAI_API_KEY
      const provider = envValues.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'
      const created = await createCharacterFlow(apiKey, provider)
      characterName = created.folderName
      await runTestChat(characterName, apiKey, provider)
    } else {
      characterName = characterChoice
    }
  } else {
    console.log(chalk.gray('  No companions yet — let\'s create one!\n'))
    const apiKey = envValues.ANTHROPIC_API_KEY ?? envValues.OPENAI_API_KEY
    const provider = envValues.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'
    const created = await createCharacterFlow(apiKey, provider)
    characterName = created.folderName
    await runTestChat(characterName, apiKey, provider)
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
        name: 'ownerId',
        message: 'Your Discord User ID:\n  (Right-click your name in Discord → Copy User ID. Enable Developer Mode in Settings first)\n  ID: ',
        validate: (v: string) => /^\d{17,20}$/.test(v) ? true : 'Should be a number like 123456789012345678',
      },
    ])
    envValues.DISCORD_BOT_TOKEN = discordAnswers.token
    envValues.DISCORD_OWNER_ID = discordAnswers.ownerId
    // Client ID can be derived from token, but let's ask to be safe
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

  // ── Step 4: Optional APIs ────────────────────────────────────────────────
  console.log(chalk.bold('\n\n✨ Step 4: Optional features\n'))
  console.log(chalk.gray('These are optional but make your companion much more alive.\n'))

  const { optionalFeatures } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'optionalFeatures',
    message: 'Which optional features do you want to enable?',
    choices: [
      { name: '📸 Selfies — she can send photos of herself (needs fal.ai key)', value: 'images', checked: true },
      { name: '🎤 Voice messages — she can send voice notes (needs ElevenLabs key)', value: 'voice' },
      { name: '🎵 Music awareness — she listens to Spotify and shares songs (needs Spotify key)', value: 'spotify' },
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
    console.log(chalk.yellow('\n  👉 ElevenLabs API key (10,000 characters/month free):'))
    console.log(chalk.gray('  https://elevenlabs.io → Sign up → Profile → API Key\n'))
    const { elKey } = await inquirer.prompt([{
      type: 'password',
      name: 'elKey',
      message: 'Paste your ElevenLabs API key (or press Enter to skip):',
      mask: '*',
    }])
    if (elKey) {
      envValues.ELEVENLABS_API_KEY = elKey
      envValues.TTS_PROVIDER = 'elevenlabs'
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

  // ── Write .env ────────────────────────────────────────────────────────────
  const spinner = ora('Writing configuration...').start()

  const envContent = generateEnvFile(envValues)
  writeFileSync(join(ROOT_DIR, '.env'), envContent, 'utf-8')

  spinner.succeed('Configuration saved to .env')

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n' + boxen(
    chalk.green('✅ Setup complete!\n\n') +
    chalk.white('Start your companion:\n') +
    chalk.cyan('  pnpm start\n\n') +
    chalk.white('Edit her personality anytime:\n') +
    chalk.cyan(`  characters/${characterName}/SOUL.md\n\n`) +
    chalk.gray('Need help? https://github.com/Hollandchirs/Openlove'),
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
  } catch {
    return []
  }
}

function generateEnvFile(values: Record<string, string>): string {
  const lines = [
    '# Openlove Configuration',
    '# Generated by setup wizard — you can edit this file anytime',
    '',
  ]
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`)
  }
  lines.push('')
  return lines.join('\n')
}
