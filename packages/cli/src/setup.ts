/**
 * Interactive Setup Wizard
 *
 * 4-step flow designed for first-time users:
 *   1. Pick your companion (from characters/ or create new)
 *   2. Where do you want to chat? (WhatsApp / Discord / Telegram)
 *   3. Give them a brain (one API key)
 *   4. Extras (selfies, Spotify, voice, browser, Twitter — all optional)
 *
 * Design goal: a 12-year-old should be able to follow this.
 */

import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import boxen from 'boxen'
import { writeFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import matter from 'gray-matter'
import { createCharacterFlow } from './create.js'
import { runTestChat } from './test-chat.js'
import { PROVIDER_INFO, getProviderInfo } from './llm-direct.js'
import { ROOT_DIR, ensureHomeDirExists, getEnvPath, getCharactersDir } from './paths.js'
import { saveCharacterConfig, getDefaultConfig } from '@opencrush/core'
import type { CharacterConfig } from '@opencrush/core'

ensureHomeDirExists()

// ── Helpers ────────────────────────────────────────────────────────────────

async function openBrowser(url: string): Promise<void> {
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Open in browser to get the key?',
    default: true,
  }])
  if (confirm) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    exec(`${opener} "${url}"`)
    await new Promise(r => setTimeout(r, 800))
  }
}

function pronouns(gender: string): { they: string; them: string; their: string; theyre: string } {
  if (gender === 'male') return { they: 'He', them: 'him', their: 'his', theyre: "He's" }
  if (gender === 'nonbinary') return { they: 'They', them: 'them', their: 'their', theyre: "They're" }
  return { they: 'She', them: 'her', their: 'her', theyre: "She's" }
}

interface CharacterInfo {
  gender: string
  age: string
  location: string
  tagline: string
  hobbies: string[]
}

function getCharacterInfo(name: string): CharacterInfo {
  const dir = join(getCharactersDir(), name)
  const info: CharacterInfo = { gender: 'female', age: '', location: '', tagline: '', hobbies: [] }

  const identityPath = join(dir, 'IDENTITY.md')
  if (existsSync(identityPath)) {
    try {
      const raw = readFileSync(identityPath, 'utf-8')
      const { data, content } = matter(raw)
      info.gender = (data.gender as string) ?? 'female'
      const ageMatch = content.match(/\*\*Age:\*\*\s*(.+)/i)
      info.age = ageMatch?.[1]?.trim().split(/[,(]/)[0]?.trim() ?? ''
      const fromMatch = content.match(/\*\*From:\*\*\s*(.+)/i)
      info.location = fromMatch?.[1]?.trim().split(',')[0]?.trim() ?? ''
      const hobbiesMatch = content.match(/\*\*Hobbies:\*\*\s*(.+)/i)
      if (hobbiesMatch) {
        info.hobbies = hobbiesMatch[1].split(',').map(h => h.trim()).filter(Boolean).slice(0, 3)
      }
    } catch { /* ignore */ }
  }

  const soulPath = join(dir, 'SOUL.md')
  if (existsSync(soulPath)) {
    try {
      const soul = readFileSync(soulPath, 'utf-8')
      // First sentence of SOUL.md as tagline
      const firstLine = soul.split('\n').find(l => l.trim() && !l.startsWith('#'))
      if (firstLine) {
        info.tagline = firstLine.trim().split('.')[0]?.trim() ?? ''
        if (info.tagline.length > 60) info.tagline = info.tagline.slice(0, 57) + '...'
      }
    } catch { /* ignore */ }
  }

  return info
}

function mapSetupVoiceProvider(v: string): 'elevenlabs' | 'fish_audio' | '' {
  if (v === 'elevenlabs') return 'elevenlabs'
  if (v === 'fishaudio' || v === 'fish_audio') return 'fish_audio'
  return ''
}

function getExistingCharacters(): string[] {
  const dir = getCharactersDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'example')
      .filter(d => existsSync(join(dir, d.name, 'IDENTITY.md')))
      .map(d => d.name)
  } catch { return [] }
}

function maybeOpenCard(name: string): void {
  const cardPath = join(getCharactersDir(), name, 'card.png')
  if (!existsSync(cardPath)) return
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${opener} "${cardPath}"`)
}

function generateEnvFile(values: Record<string, string>): string {
  // Platform/voice/twitter/autonomous settings now live in per-character config.json.
  // .env only holds LLM provider keys, media keys, browser, and Spotify.
  const sections: Record<string, string[]> = {
    '# ── AI Provider ──': ['LLM_PROVIDER', 'LLM_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY', 'ZHIPU_API_KEY', 'MINIMAX_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'JINA_API_KEY'],
    '# ── Character ──': ['CHARACTER_NAME'],
    '# ── Media (Selfies, Video) ──': ['FAL_KEY', 'IMAGE_MODEL', 'IMAGE_REFERENCE_MODEL'],
    '# ── Browser Automation ──': ['BROWSER_AUTOMATION_ENABLED', 'BROWSER_MODE', 'BROWSER_CDP_ENDPOINT', 'BROWSER_PROFILE_DIR'],
    '# ── Spotify ──': ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  }

  const lines = [
    '# Opencrush Configuration',
    '# Generated by setup wizard — edit anytime',
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

  // Keys that live in per-character config.json — exclude from .env
  const configJsonKeys = new Set([
    'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_OWNER_ID',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'WHATSAPP_ENABLED',
    'TTS_PROVIDER', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID',
    'FISH_AUDIO_API_KEY', 'FISH_AUDIO_VOICE_ID',
    'TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET',
    'SOCIAL_AUTO_POST', 'SOCIAL_MIN_POST_INTERVAL',
    'QUIET_HOURS_START', 'QUIET_HOURS_END',
    'PROACTIVE_MESSAGE_MIN_INTERVAL', 'PROACTIVE_MESSAGE_MAX_INTERVAL',
  ])

  for (const [key, value] of Object.entries(values)) {
    if (!used.has(key) && !configJsonKeys.has(key)) lines.push(`${key}=${value}`)
  }

  lines.push('')
  return lines.join('\n')
}

// ── Main Wizard ────────────────────────────────────────────────────────────

export async function runSetupWizard(): Promise<void> {
  console.clear()
  console.log(chalk.magenta(`
  ╔══════════════════════════════════════════╗
  ║          💝  O P E N C R U S H           ║
  ║  Your AI companion lives on your device  ║
  ╚══════════════════════════════════════════╝
  `))

  console.log(chalk.cyan("  Let's get you set up. Takes about 2 minutes.\n"))

  // ── Mode selection ──────────────────────────────────────────────────────
  const { setupMode } = await inquirer.prompt([{
    type: 'list',
    name: 'setupMode',
    message: 'Pick a setup mode:',
    choices: [
      {
        name: `⚡ Quick setup  ${chalk.gray('— pick or create a companion, core features (recommended)')}`,
        value: 'quick',
        short: 'Quick',
      },
      {
        name: `🔧 Full setup   ${chalk.gray('— pick or create a companion + voice, browser, Twitter')}`,
        value: 'full',
        short: 'Full',
      },
    ],
  }])

  const TOTAL = 4
  const step = (n: number, label: string) => console.log(chalk.cyan(`\n  [${n}/${TOTAL}] ${label}`))

  // ── Step 1: AI Brain ────────────────────────────────────────────────────
  step(1, 'Choose your AI brain')
  console.log(chalk.gray('  Pick whichever you already have a key for.\n'))

  const envValues: Record<string, string> = {}

  const providerChoices = [
    PROVIDER_INFO.find(p => p.id === 'anthropic')!,
    PROVIDER_INFO.find(p => p.id === 'openai')!,
    PROVIDER_INFO.find(p => p.id === 'xai')!,
    PROVIDER_INFO.find(p => p.id === 'deepseek')!,
    PROVIDER_INFO.find(p => p.id === 'qwen')!,
    PROVIDER_INFO.find(p => p.id === 'kimi')!,
    PROVIDER_INFO.find(p => p.id === 'zhipu')!,
    PROVIDER_INFO.find(p => p.id === 'minimax')!,
    PROVIDER_INFO.find(p => p.id === 'minimax-global')!,
    PROVIDER_INFO.find(p => p.id === 'zai')!,
    PROVIDER_INFO.find(p => p.isLocal)!,
  ].filter(Boolean)

  const { llmProvider } = await inquirer.prompt([{
    type: 'list',
    name: 'llmProvider',
    message: 'Which AI provider?',
    choices: providerChoices.map(p => ({
      name: `${p.emoji}  ${p.name}\n     ${chalk.gray(p.tagline)}`,
      value: p.id,
      short: p.name,
    })),
  }])

  envValues.LLM_PROVIDER = llmProvider
  const providerInfo = getProviderInfo(llmProvider)!

  let collectedApiKey: string | undefined
  let collectedProvider: string | undefined

  if (llmProvider !== 'ollama') {
    console.log(chalk.yellow(`\n  Get your API key: ${providerInfo.keyUrl}`))
    await openBrowser(providerInfo.keyUrl)

    if (llmProvider === 'anthropic') {
      console.log(chalk.gray('  Sign up → API Keys → Create Key → copy the key (starts with "sk-ant-")\n'))
    } else if (llmProvider === 'openai') {
      console.log(chalk.gray('  Sign up → API Keys → Create new secret key\n'))
    } else if (llmProvider === 'xai') {
      console.log(chalk.gray('  Sign up → get $25 free credit → copy API key\n'))
    } else if (llmProvider === 'deepseek') {
      console.log(chalk.gray('  Sign up → API Keys → Create key (new users get free credits)\n'))
    }

    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: `Paste your ${providerInfo.name} API key:`,
      mask: '*',
      validate: (v: string) => {
        if (!v.trim()) return 'API key required'
        if (providerInfo.keyPrefix && !v.startsWith(providerInfo.keyPrefix)) {
          return `Should start with "${providerInfo.keyPrefix}"`
        }
        return true
      },
    }])

    envValues[providerInfo.envKey] = apiKey
    collectedApiKey = apiKey
    collectedProvider = llmProvider
  } else {
    console.log(chalk.yellow('\n  Make sure Ollama is running: https://ollama.ai'))
    console.log(chalk.gray('  Run: ollama pull qwen2.5:7b\n'))
    envValues.OLLAMA_BASE_URL = 'http://localhost:11434'
    envValues.OLLAMA_MODEL = 'qwen2.5:7b'
  }

  // ── Step 2: Pick Your Companion ─────────────────────────────────────────
  step(2, 'Pick your companion')

  const characters = getExistingCharacters()
  let characterName: string
  let characterCreatedNew = false
  let gender = 'female'

  if (characters.length > 0) {
    console.log(chalk.gray('  These companions are ready to go:\n'))

    const choices = characters.map(c => {
      const info = getCharacterInfo(c)
      const parts = [info.age, info.location].filter(Boolean)
      const desc = info.tagline || info.hobbies.join(', ')
      if (desc) parts.push(desc)
      const preview = parts.length > 0 ? chalk.gray(' · ' + parts.join(' · ')) : ''
      return {
        name: `✨ ${c}${preview}`,
        value: c,
        short: c,
      }
    })
    choices.push({ name: '➕ Create someone new', value: '__new__', short: 'New' })

    const { pick } = await inquirer.prompt([{
      type: 'list',
      name: 'pick',
      message: 'Who do you want to talk to?',
      choices,
    }])

    if (pick === '__new__') {
      const created = await createCharacterFlow(collectedApiKey, collectedProvider)
      characterName = created.folderName
      characterCreatedNew = true
      gender = created.gender
    } else {
      characterName = pick
      gender = getCharacterInfo(pick).gender
      maybeOpenCard(characterName)
    }
  } else {
    console.log(chalk.gray("  No companions found yet — let's create one!\n"))
    const created = await createCharacterFlow(collectedApiKey, collectedProvider)
    characterName = created.folderName
    characterCreatedNew = true
    gender = created.gender
  }

  envValues.CHARACTER_NAME = characterName
  const pro = pronouns(gender)

  // Quick test chat if character was just created
  if (characterCreatedNew && collectedApiKey) {
    await runTestChat(characterName, collectedApiKey, collectedProvider ?? 'anthropic')
  }

  // ── Step 3: Where Do You Want to Chat? ──────────────────────────────────
  step(3, `Where do you want to chat with ${characterName}?`)

  const { platforms } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'platforms',
    message: 'Pick at least one:',
    choices: [
      { name: "💬 WhatsApp — scan a QR code and you're done (recommended)", value: 'whatsapp', checked: true },
      { name: '🎮 Discord — supports voice calls', value: 'discord' },
      { name: '📬 Telegram', value: 'telegram' },
    ],
    validate: (v: string[]) => v.length > 0 ? true : 'Pick at least one',
  }])

  if (platforms.includes('discord')) {
    console.log(chalk.yellow('\n  Discord bot setup (~2 min):'))
    console.log(chalk.gray('  1. Go to discord.com/developers/applications'))
    console.log(chalk.gray(`  2. "New Application" → name it "${characterName}"`))
    console.log(chalk.gray('  3. "Bot" → "Reset Token" → copy the token'))
    console.log(chalk.gray('  4. Turn on "Message Content Intent"\n'))

    const answers = await inquirer.prompt([
      { type: 'password', name: 'token', message: 'Paste your Discord Bot Token:', mask: '*' },
      {
        type: 'input', name: 'clientId',
        message: 'Application ID (General Information → Application ID):',
        validate: (v: string) => /^\d{17,20}$/.test(v) ? true : 'Should be a number like 123456789012345678',
      },
      {
        type: 'input', name: 'ownerId',
        message: 'Your Discord User ID (right-click your name → Copy User ID):',
        validate: (v: string) => /^\d{17,20}$/.test(v) ? true : 'Should be a number like 123456789012345678',
      },
    ])
    envValues.DISCORD_BOT_TOKEN = answers.token
    envValues.DISCORD_CLIENT_ID = answers.clientId
    envValues.DISCORD_OWNER_ID = answers.ownerId

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${answers.clientId}&permissions=277025770560&scope=bot`
    console.log(chalk.cyan(`\n  Invite ${characterName} to your server:`))
    console.log(chalk.white(`  ${inviteUrl}\n`))
  }

  if (platforms.includes('telegram')) {
    console.log(chalk.yellow('\n  Telegram bot setup:'))
    console.log(chalk.gray('  1. Open Telegram → search @BotFather'))
    console.log(chalk.gray('  2. Send /newbot → follow the steps'))
    console.log(chalk.gray('  3. Copy the token it gives you'))
    console.log(chalk.gray('  4. Your user ID: search @userinfobot → send /start\n'))

    const answers = await inquirer.prompt([
      { type: 'password', name: 'token', message: 'Paste your Telegram Bot Token:', mask: '*' },
      {
        type: 'input', name: 'ownerId',
        message: 'Your Telegram User ID (a number):',
        validate: (v: string) => /^\d+$/.test(v) ? true : 'Should be a number',
      },
    ])
    envValues.TELEGRAM_BOT_TOKEN = answers.token
    envValues.TELEGRAM_OWNER_ID = answers.ownerId
  }

  if (platforms.includes('whatsapp')) {
    envValues.WHATSAPP_ENABLED = 'true'
    console.log(chalk.cyan(`\n  WhatsApp needs no setup! A QR code will appear when ${characterName} starts.`))
    console.log(chalk.gray('  Scan it with WhatsApp → Linked Devices on your phone.'))
  }

  // ── Step 4: Extras (all optional) ───────────────────────────────────────
  step(4, 'Extras')
  console.log(chalk.gray('  All optional — skip everything by pressing Enter.\n'))

  const quickChoices = [
    { name: `📸 Send selfies and videos  ${chalk.gray('(fal.ai — free credits on signup)')}`, value: 'images', checked: true },
    { name: `🎵 Listen to Spotify and share songs  ${chalk.gray('(Spotify API — free)')}`, value: 'spotify' },
  ]
  const fullChoices = [
    { name: `📸 Send selfies and videos  ${chalk.gray('(fal.ai — free credits on signup)')}`, value: 'images', checked: true },
    { name: `🎵 Listen to Spotify and share songs  ${chalk.gray('(Spotify API — free)')}`, value: 'spotify' },
    { name: `🎤 Send voice messages  ${chalk.gray('(ElevenLabs / Fish Audio / FAL)')}`, value: 'voice' },
    { name: `🌐 Browse the web and share screenshots  ${chalk.gray('(Playwright)')}`, value: 'browser' },
    { name: `🐦 Post on Twitter/X  ${chalk.gray('(Twitter API + OAuth)')}`, value: 'twitter' },
  ]

  const { extras } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'extras',
    message: `What else should ${characterName} do?`,
    choices: setupMode === 'quick' ? quickChoices : fullChoices,
  }])

  // ── Collect keys for selected extras ────────────────────────────────────

  if (extras.includes('images')) {
    console.log(chalk.yellow('\n  fal.ai API key (free credits on signup):'))
    console.log(chalk.gray('  https://fal.ai → Sign up → Dashboard → API Keys\n'))
    const { falKey } = await inquirer.prompt([{
      type: 'password', name: 'falKey',
      message: 'Paste your fal.ai key (or Enter to skip):',
      mask: '*',
    }])
    if (falKey) envValues.FAL_KEY = falKey
  }

  if (extras.includes('spotify')) {
    console.log(chalk.yellow('\n  Spotify API (free):'))
    console.log(chalk.gray('  https://developer.spotify.com/dashboard → Create App → Copy Client ID & Secret\n'))
    const answers = await inquirer.prompt([
      { type: 'password', name: 'clientId', message: 'Spotify Client ID:', mask: '*' },
      { type: 'password', name: 'clientSecret', message: 'Spotify Client Secret:', mask: '*' },
    ])
    if (answers.clientId) {
      envValues.SPOTIFY_CLIENT_ID = answers.clientId
      envValues.SPOTIFY_CLIENT_SECRET = answers.clientSecret
    }
  }

  if (extras.includes('voice')) {
    const { ttsProvider } = await inquirer.prompt([{
      type: 'list',
      name: 'ttsProvider',
      message: 'Which voice provider?',
      choices: [
        { name: `🗣️  ElevenLabs  ${chalk.gray('— most natural, $5/mo or free tier')}`, value: 'elevenlabs', short: 'ElevenLabs' },
        { name: `🐟  Fish Audio  ${chalk.gray('— good multilingual, free tier')}`, value: 'fishaudio', short: 'Fish Audio' },
        { name: `⚡  FAL Kokoro  ${chalk.gray('— cheapest, reuses your fal.ai key')}`, value: 'fal', short: 'FAL Kokoro' },
      ],
    }])
    envValues.TTS_PROVIDER = ttsProvider

    if (ttsProvider === 'elevenlabs') {
      console.log(chalk.gray('\n  https://elevenlabs.io → Sign up → Profile → API Key\n'))
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'ElevenLabs API key (Enter to skip):', mask: '*' },
        { type: 'input', name: 'voiceId', message: 'Voice ID (optional, default Rachel):' },
      ])
      if (answers.apiKey) envValues.ELEVENLABS_API_KEY = answers.apiKey
      if (answers.voiceId) envValues.ELEVENLABS_VOICE_ID = answers.voiceId
    }

    if (ttsProvider === 'fishaudio') {
      console.log(chalk.gray('\n  https://fish.audio → Sign up → Profile → API Keys\n'))
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'Fish Audio API key (Enter to skip):', mask: '*' },
        { type: 'input', name: 'voiceId', message: 'Voice ID (find in Fish Audio voice library):' },
      ])
      if (answers.apiKey) envValues.FISH_AUDIO_API_KEY = answers.apiKey
      if (answers.voiceId) envValues.FISH_AUDIO_VOICE_ID = answers.voiceId
    }

    if (ttsProvider === 'fal') {
      console.log(chalk.cyan('\n  FAL Kokoro reuses your fal.ai key — no extra setup needed.'))
      if (!envValues.FAL_KEY) {
        console.log(chalk.gray('  https://fal.ai → Dashboard → API Keys\n'))
        const { falKey } = await inquirer.prompt([{
          type: 'password', name: 'falKey', message: 'Paste your fal.ai key:', mask: '*',
        }])
        if (falKey) envValues.FAL_KEY = falKey
      }
    }
  }

  if (extras.includes('browser')) {
    console.log(chalk.gray(`\n  ${characterName} can browse the web, watch YouTube, scroll Twitter, and share screenshots.`))
    console.log(chalk.gray('  Requires Playwright: npx playwright install chromium\n'))

    const { browserMode } = await inquirer.prompt([{
      type: 'list',
      name: 'browserMode',
      message: 'Browser mode:',
      choices: [
        { name: `🔌 CDP — connect to your running Chrome (recommended)\n     ${chalk.gray('Enable: chrome://flags → Remote Debugging')}`, value: 'cdp', short: 'CDP' },
        { name: `💾 Persistent — separate browser, keeps login state`, value: 'persistent', short: 'Persistent' },
        { name: `🧪 Fresh — new browser each time (no history)`, value: 'fresh', short: 'Fresh' },
      ],
    }])
    envValues.BROWSER_AUTOMATION_ENABLED = 'true'
    envValues.BROWSER_MODE = browserMode

    if (browserMode === 'cdp') {
      const { cdpEndpoint } = await inquirer.prompt([{
        type: 'input', name: 'cdpEndpoint',
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

  if (extras.includes('twitter')) {
    console.log(chalk.yellow('\n  Twitter/X API setup (OAuth 2.0 — works on Free tier):'))
    console.log(chalk.gray('  1. developer.x.com → Dashboard → Create App'))
    console.log(chalk.gray('  2. User authentication → Enable OAuth 2.0'))
    console.log(chalk.gray('  3. App permissions: Read and Write'))
    console.log(chalk.gray('  4. Callback URL: https://localhost'))
    console.log(chalk.gray('  5. Keys and tokens → Copy Client ID and Client Secret\n'))

    const answers = await inquirer.prompt([
      { type: 'password', name: 'clientId', message: 'OAuth 2.0 Client ID:', mask: '*' },
      { type: 'password', name: 'clientSecret', message: 'OAuth 2.0 Client Secret:', mask: '*' },
    ])
    if (answers.clientId) {
      envValues.TWITTER_CLIENT_ID = answers.clientId
      envValues.TWITTER_CLIENT_SECRET = answers.clientSecret
      envValues.SOCIAL_AUTO_POST = 'true'
    }

    console.log(chalk.cyan('\n  After setup, run `node test-twitter-oauth2.mjs` to finish OAuth.'))
    console.log(chalk.gray(`  This opens a browser — after that, ${characterName} can post tweets.`))
  }

  // ── Schedule (sensible defaults, one question) ──────────────────────────

  console.log()
  const { frequency } = await inquirer.prompt([{
    type: 'list',
    name: 'frequency',
    message: `How often should ${characterName} text you first?`,
    choices: [
      { name: '🔥 A lot — every 1-2 hours', value: 'frequent' },
      { name: '⚡ Sometimes — every 2-4 hours (recommended)', value: 'moderate' },
      { name: '🌙 Rarely — every 4-8 hours', value: 'rare' },
      { name: `🔇 Never — only when I message ${pro.them}`, value: 'never' },
    ],
    default: 'moderate',
  }])

  const freqMap: Record<string, [string, string]> = {
    frequent: ['60', '120'],
    moderate: ['120', '240'],
    rare: ['240', '480'],
    never: ['99999', '99999'],
  }
  const [minInterval, maxInterval] = freqMap[frequency] ?? ['120', '240']
  envValues.QUIET_HOURS_START = '23'
  envValues.QUIET_HOURS_END = '8'
  envValues.PROACTIVE_MESSAGE_MIN_INTERVAL = minInterval
  envValues.PROACTIVE_MESSAGE_MAX_INTERVAL = maxInterval

  // ── Write .env (LLM + media keys only) ──────────────────────────────────

  const spinner = ora('Saving configuration...').start()
  const envContent = generateEnvFile(envValues)
  const envFilePath = getEnvPath()
  writeFileSync(envFilePath, envContent, 'utf-8')

  // ── Write per-character config.json (platform/voice/twitter/autonomous) ─
  const charConfig: CharacterConfig = {
    ...getDefaultConfig(),
    discord: {
      enabled: platforms.includes('discord') && Boolean(envValues.DISCORD_BOT_TOKEN),
      botToken: envValues.DISCORD_BOT_TOKEN ?? '',
      clientId: envValues.DISCORD_CLIENT_ID ?? '',
      ownerId: envValues.DISCORD_OWNER_ID ?? '',
    },
    telegram: {
      enabled: platforms.includes('telegram') && Boolean(envValues.TELEGRAM_BOT_TOKEN),
      botToken: envValues.TELEGRAM_BOT_TOKEN ?? '',
      ownerId: envValues.TELEGRAM_OWNER_ID ?? '',
    },
    whatsapp: { enabled: platforms.includes('whatsapp') },
    voice: {
      provider: mapSetupVoiceProvider(envValues.TTS_PROVIDER ?? ''),
      elevenlabsKey: envValues.ELEVENLABS_API_KEY ?? '',
      elevenlabsVoiceId: envValues.ELEVENLABS_VOICE_ID ?? '',
      fishAudioKey: envValues.FISH_AUDIO_API_KEY ?? '',
      fishAudioVoiceId: envValues.FISH_AUDIO_VOICE_ID ?? '',
      conversationEnabled: platforms.includes('discord'),
    },
    twitter: {
      clientId: envValues.TWITTER_CLIENT_ID ?? '',
      clientSecret: envValues.TWITTER_CLIENT_SECRET ?? '',
      apiKey: '',
      apiSecret: '',
      accessToken: '',
      accessSecret: '',
      autoPost: envValues.SOCIAL_AUTO_POST === 'true',
      postInterval: parseInt(envValues.SOCIAL_MIN_POST_INTERVAL ?? '120') || 120,
    },
    autonomous: {
      quietHoursStart: parseInt(envValues.QUIET_HOURS_START ?? '23') || 23,
      quietHoursEnd: parseInt(envValues.QUIET_HOURS_END ?? '8') || 8,
      proactiveMinInterval: parseInt(envValues.PROACTIVE_MESSAGE_MIN_INTERVAL ?? '60') || 60,
      proactiveMaxInterval: parseInt(envValues.PROACTIVE_MESSAGE_MAX_INTERVAL ?? '240') || 240,
    },
  }
  saveCharacterConfig(characterName, getCharactersDir(), charConfig)

  spinner.succeed(`Configuration saved to ${envFilePath} + characters/${characterName}/config.json`)

  // ── Build feature summary ──────────────────────────────────────────────

  const enabled: string[] = []
  enabled.push(`🧠 AI: ${providerInfo.name}`)
  enabled.push(`💝 Character: ${characterName}`)
  if (platforms.includes('discord'))  enabled.push('🎮 Discord')
  if (platforms.includes('telegram')) enabled.push('📬 Telegram')
  if (platforms.includes('whatsapp')) enabled.push('💬 WhatsApp')
  if (extras.includes('images'))  enabled.push('📸 Selfies & Video')
  if (extras.includes('voice'))   enabled.push(`🎤 Voice (${envValues.TTS_PROVIDER ?? 'n/a'})`)
  if (extras.includes('twitter')) enabled.push('🐦 Twitter')
  if (extras.includes('browser')) enabled.push(`🌐 Browser (${envValues.BROWSER_MODE})`)
  if (extras.includes('spotify')) enabled.push('🎵 Spotify')
  enabled.push('💕 Emotion engine')
  enabled.push('🤝 Relationship tracking')
  enabled.push('🧠 Memory')

  const nextSteps: string[] = []
  if (extras.includes('twitter')) nextSteps.push('  → Run node test-twitter-oauth2.mjs to finish Twitter auth')
  if (extras.includes('browser')) nextSteps.push('  → Run npx playwright install chromium')

  console.log('\n' + boxen(
    chalk.green('Done!\n\n') +
    chalk.white('Enabled:\n') +
    enabled.map(f => chalk.cyan(`  ${f}`)).join('\n') + '\n\n' +
    (nextSteps.length > 0
      ? chalk.yellow('Before starting:\n') + nextSteps.join('\n') + '\n\n'
      : '') +
    chalk.white(`Start ${characterName}:\n`) +
    chalk.cyan('  npx opencrush@latest start\n\n') +
    chalk.white(`Edit ${pro.their} personality:\n`) +
    chalk.cyan(`  characters/${characterName}/SOUL.md\n\n`) +
    (setupMode === 'quick' ? chalk.gray('Unlock voice/browser/Twitter: run setup again → Full setup\n\n') : '') +
    chalk.gray('https://github.com/heloraai/Opencrush'),
    { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'magenta' }
  ))

  // ── Start now? ──────────────────────────────────────────────────────────

  const { startNow } = await inquirer.prompt([{
    type: 'confirm',
    name: 'startNow',
    message: `Start ${characterName} now?`,
    default: true,
  }])

  if (startNow) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envFilePath, override: true })
    const { startOpencrush } = await import('./start.js')
    await startOpencrush()
  }
}
