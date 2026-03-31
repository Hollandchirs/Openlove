/**
 * Per-Character Config System
 *
 * Each character can have its own config.json with platform credentials,
 * voice settings, and autonomous behavior parameters.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface CharacterConfig {
  readonly discord: {
    readonly enabled: boolean
    readonly botToken: string
    readonly clientId: string
    readonly ownerId: string
  }
  readonly telegram: {
    readonly enabled: boolean
    readonly botToken: string
    readonly ownerId: string
  }
  readonly whatsapp: { readonly enabled: boolean }
  readonly voice: {
    readonly provider: 'elevenlabs' | 'fish_audio' | ''
    readonly elevenlabsKey: string
    readonly elevenlabsVoiceId: string
    readonly fishAudioKey: string
    readonly fishAudioVoiceId: string
    readonly conversationEnabled: boolean
  }
  readonly twitter: {
    readonly clientId: string
    readonly clientSecret: string
    readonly apiKey: string
    readonly apiSecret: string
    readonly accessToken: string
    readonly accessSecret: string
    readonly autoPost: boolean
    readonly postInterval: number
  }
  readonly autonomous: {
    readonly quietHoursStart: number
    readonly quietHoursEnd: number
    readonly proactiveMinInterval: number
    readonly proactiveMaxInterval: number
  }
}

export function getDefaultConfig(): CharacterConfig {
  return {
    discord: { enabled: false, botToken: '', clientId: '', ownerId: '' },
    telegram: { enabled: false, botToken: '', ownerId: '' },
    whatsapp: { enabled: false },
    voice: {
      provider: '', elevenlabsKey: '', elevenlabsVoiceId: '',
      fishAudioKey: '', fishAudioVoiceId: '', conversationEnabled: false,
    },
    twitter: {
      clientId: '', clientSecret: '', apiKey: '', apiSecret: '',
      accessToken: '', accessSecret: '', autoPost: false, postInterval: 120,
    },
    autonomous: {
      quietHoursStart: 23, quietHoursEnd: 8,
      proactiveMinInterval: 60, proactiveMaxInterval: 240,
    },
  }
}

export function loadCharacterConfig(
  characterName: string,
  charactersDir: string,
): CharacterConfig {
  const configPath = join(charactersDir, characterName, 'config.json')
  if (!existsSync(configPath)) return getDefaultConfig()

  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`config.json for "${characterName}" is not a valid object`)
    }
    return mergeConfig(getDefaultConfig(), parsed as Record<string, unknown>)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to load config for "${characterName}": ${msg}`)
  }
}

export function saveCharacterConfig(
  characterName: string,
  charactersDir: string,
  config: CharacterConfig,
): void {
  const dir = join(charactersDir, characterName)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8')
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to save config for "${characterName}": ${msg}`)
  }
}

export function migrateFromEnv(envPath: string): CharacterConfig {
  if (!existsSync(envPath)) {
    throw new Error(`Environment file not found: ${envPath}`)
  }
  const env = parseEnvFile(readFileSync(envPath, 'utf-8'))
  const int = (key: string, fallback: number) => parseInt(env[key] ?? '', 10) || fallback

  return {
    discord: {
      enabled: Boolean(env['DISCORD_BOT_TOKEN']),
      botToken: env['DISCORD_BOT_TOKEN'] ?? '',
      clientId: env['DISCORD_CLIENT_ID'] ?? '',
      ownerId: env['DISCORD_OWNER_ID'] ?? '',
    },
    telegram: {
      enabled: Boolean(env['TELEGRAM_BOT_TOKEN']),
      botToken: env['TELEGRAM_BOT_TOKEN'] ?? '',
      ownerId: env['TELEGRAM_OWNER_ID'] ?? '',
    },
    whatsapp: { enabled: env['WHATSAPP_ENABLED'] === 'true' },
    voice: {
      provider: mapVoiceProvider(env['TTS_PROVIDER'] ?? ''),
      elevenlabsKey: env['ELEVENLABS_API_KEY'] ?? '',
      elevenlabsVoiceId: env['ELEVENLABS_VOICE_ID'] ?? '',
      fishAudioKey: env['FISH_AUDIO_API_KEY'] ?? '',
      fishAudioVoiceId: env['FISH_AUDIO_VOICE_ID'] ?? '',
      conversationEnabled: env['VOICE_CONVERSATION_ENABLED'] === 'true',
    },
    twitter: {
      clientId: env['TWITTER_CLIENT_ID'] ?? '',
      clientSecret: env['TWITTER_CLIENT_SECRET'] ?? '',
      apiKey: env['TWITTER_API_KEY'] ?? '',
      apiSecret: env['TWITTER_API_SECRET'] ?? '',
      accessToken: env['TWITTER_ACCESS_TOKEN'] ?? '',
      accessSecret: env['TWITTER_ACCESS_TOKEN_SECRET'] ?? '',
      autoPost: env['SOCIAL_AUTO_POST'] === 'true',
      postInterval: int('SOCIAL_MIN_POST_INTERVAL', 120),
    },
    autonomous: {
      quietHoursStart: int('QUIET_HOURS_START', 23),
      quietHoursEnd: int('QUIET_HOURS_END', 8),
      proactiveMinInterval: int('PROACTIVE_MESSAGE_MIN_INTERVAL', 60),
      proactiveMaxInterval: int('PROACTIVE_MESSAGE_MAX_INTERVAL', 240),
    },
  }
}

// ── Internal helpers ───────────────────────────────────────────

function parseEnvFile(content: string): Record<string, string> {
  return Object.fromEntries(
    content.split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return i === -1 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()] as const
      })
      .filter((e): e is [string, string] => e !== null),
  )
}

function mapVoiceProvider(v: string): 'elevenlabs' | 'fish_audio' | '' {
  if (v === 'elevenlabs') return 'elevenlabs'
  if (v === 'fishaudio' || v === 'fish_audio') return 'fish_audio'
  return ''
}

function mergeSection<T extends Record<string, unknown>>(base: T, partial: unknown): T {
  if (typeof partial !== 'object' || partial === null) return base
  const result = { ...base }
  for (const key of Object.keys(base)) {
    if (key in (partial as Record<string, unknown>)) {
      const val = (partial as Record<string, unknown>)[key]
      if (typeof val === typeof base[key]) {
        ;(result as Record<string, unknown>)[key] = val
      }
    }
  }
  return result
}

function mergeConfig(defaults: CharacterConfig, overrides: Record<string, unknown>): CharacterConfig {
  return {
    discord: mergeSection(defaults.discord, overrides['discord']),
    telegram: mergeSection(defaults.telegram, overrides['telegram']),
    whatsapp: mergeSection(defaults.whatsapp, overrides['whatsapp']),
    voice: mergeSection(defaults.voice, overrides['voice']),
    twitter: mergeSection(defaults.twitter, overrides['twitter']),
    autonomous: mergeSection(defaults.autonomous, overrides['autonomous']),
  }
}
