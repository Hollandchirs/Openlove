import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readdirSync, existsSync, statSync } from "node:fs";
import {
  loadCharacterConfig,
  saveCharacterConfig,
  type CharacterConfig,
} from "@opencrush/core";

const ENV_PATH = resolve(process.cwd(), "../../.env");
const CHARACTERS_DIR = resolve(process.cwd(), "../../characters");

// ── .env parsing ──

interface EnvEntry {
  type: "comment" | "blank" | "kv";
  raw: string;
  key?: string;
  value?: string;
}

function parseEnvStructured(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      entries.push({ type: "blank", raw: line });
    } else if (trimmed.startsWith("#")) {
      entries.push({ type: "comment", raw: line });
    } else {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        entries.push({ type: "comment", raw: line });
      } else {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        entries.push({ type: "kv", raw: line, key, value });
      }
    }
  }
  return entries;
}

function serializeEnv(entries: EnvEntry[]): string {
  return entries.map((e) => {
    if (e.type === "kv") return `${e.key}=${e.value}`;
    return e.raw;
  }).join("\n");
}

function parseEnvFlat(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of parseEnvStructured(content)) {
    if (entry.type === "kv" && entry.key) {
      env[entry.key] = entry.value ?? "";
    }
  }
  return env;
}

// ── Settings shape returned to the frontend ──

interface SettingsResponse {
  // AI
  llmProvider: string;
  llmModel: string;

  // Character
  characterName: string;

  // API Keys (raw values for masked display + editing)
  keys: Record<string, string>;

  // Platforms
  discord: { enabled: boolean; botToken: string; clientId: string; ownerId: string };
  telegram: { enabled: boolean; botToken: string; ownerId: string };
  whatsapp: { enabled: boolean };
  twitter: {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
    autoPost: boolean;
    postInterval: number;
  };

  // Features
  imageGeneration: { enabled: boolean; falKey: string; model: string };
  voice: { provider: string; enabled: boolean; conversationEnabled: boolean; elevenlabsKey: string; fishAudioKey: string };
  browserAutomation: boolean;

  // Schedule
  quietHoursStart: number;
  quietHoursEnd: number;
  proactiveMinInterval: number;
  proactiveMaxInterval: number;
}

function buildSettingsFromEnv(env: Record<string, string>): SettingsResponse {
  const get = (key: string, fallback = ""): string => env[key]?.trim() || fallback;
  const has = (key: string): boolean => Boolean(env[key]?.trim());

  // Collect all key/token/secret entries plus Ollama config
  const keys: Record<string, string> = {};
  const extraKeys = ["OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  for (const [k, v] of Object.entries(env)) {
    const lower = k.toLowerCase();
    if (lower.includes("key") || lower.includes("token") || lower.includes("secret") || extraKeys.includes(k)) {
      keys[k] = v;
    }
  }

  return {
    llmProvider: get("LLM_PROVIDER", "anthropic"),
    llmModel: get("LLM_MODEL", ""),
    characterName: get("CHARACTER_NAME", "mia"),

    keys,

    discord: {
      enabled: has("DISCORD_BOT_TOKEN"),
      botToken: get("DISCORD_BOT_TOKEN"),
      clientId: get("DISCORD_CLIENT_ID"),
      ownerId: get("DISCORD_OWNER_ID"),
    },
    telegram: {
      enabled: has("TELEGRAM_BOT_TOKEN"),
      botToken: get("TELEGRAM_BOT_TOKEN"),
      ownerId: get("TELEGRAM_OWNER_ID"),
    },
    whatsapp: {
      enabled: get("WHATSAPP_ENABLED") === "true",
    },
    twitter: {
      enabled: has("TWITTER_CLIENT_ID") || has("TWITTER_API_KEY"),
      clientId: get("TWITTER_CLIENT_ID"),
      clientSecret: get("TWITTER_CLIENT_SECRET"),
      apiKey: get("TWITTER_API_KEY"),
      apiSecret: get("TWITTER_API_SECRET"),
      accessToken: get("TWITTER_ACCESS_TOKEN"),
      accessSecret: get("TWITTER_ACCESS_TOKEN_SECRET"),
      autoPost: get("SOCIAL_AUTO_POST") === "true",
      postInterval: parseInt(get("SOCIAL_MIN_POST_INTERVAL", "120"), 10),
    },

    imageGeneration: {
      enabled: has("FAL_KEY"),
      falKey: get("FAL_KEY"),
      model: get("IMAGE_MODEL", "fal-ai/flux-realism"),
    },
    voice: {
      provider: get("TTS_PROVIDER", "elevenlabs"),
      enabled: has("ELEVENLABS_API_KEY") || has("FISH_AUDIO_API_KEY"),
      conversationEnabled: get("VOICE_CONVERSATION_ENABLED") === "true",
      elevenlabsKey: get("ELEVENLABS_API_KEY"),
      fishAudioKey: get("FISH_AUDIO_API_KEY"),
    },

    browserAutomation: get("BROWSER_AUTOMATION_ENABLED") === "true",

    quietHoursStart: parseInt(get("QUIET_HOURS_START", "23"), 10),
    quietHoursEnd: parseInt(get("QUIET_HOURS_END", "8"), 10),
    proactiveMinInterval: parseInt(get("PROACTIVE_MESSAGE_MIN_INTERVAL", "60"), 10),
    proactiveMaxInterval: parseInt(get("PROACTIVE_MESSAGE_MAX_INTERVAL", "240"), 10),
  };
}

// ── Validation ──

interface UpdatePayload {
  [key: string]: string | number | boolean;
}

const VALID_PROVIDERS = ["anthropic", "openai", "xai", "deepseek", "minimax", "minimax-global", "qwen", "kimi", "zhipu", "zai", "ollama"];
const VALID_TTS_PROVIDERS = ["elevenlabs", "fish_audio"];

function validateUpdates(updates: UpdatePayload): string | null {
  if ("LLM_PROVIDER" in updates) {
    const provider = String(updates.LLM_PROVIDER).toLowerCase();
    if (!VALID_PROVIDERS.includes(provider)) {
      return `Invalid LLM_PROVIDER: ${provider}. Must be one of: ${VALID_PROVIDERS.join(", ")}`;
    }
  }

  if ("TTS_PROVIDER" in updates) {
    const provider = String(updates.TTS_PROVIDER).toLowerCase();
    if (!VALID_TTS_PROVIDERS.includes(provider)) {
      return `Invalid TTS_PROVIDER: ${provider}. Must be one of: ${VALID_TTS_PROVIDERS.join(", ")}`;
    }
  }

  // Validate numeric ranges
  const numericFields: Record<string, [number, number]> = {
    QUIET_HOURS_START: [0, 23],
    QUIET_HOURS_END: [0, 23],
    PROACTIVE_MESSAGE_MIN_INTERVAL: [1, 1440],
    PROACTIVE_MESSAGE_MAX_INTERVAL: [1, 1440],
    SOCIAL_MIN_POST_INTERVAL: [1, 1440],
  };

  for (const [field, [min, max]] of Object.entries(numericFields)) {
    if (field in updates) {
      const val = Number(updates[field]);
      if (isNaN(val) || val < min || val > max) {
        return `${field} must be a number between ${min} and ${max}`;
      }
    }
  }

  // Validate API key format (basic: must start with expected prefix or be non-empty)
  const apiKeyFields = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_GLOBAL_API_KEY",
    "ZAI_API_KEY",
    "GOOGLE_API_KEY",
    "DASHSCOPE_API_KEY",
    "MOONSHOT_API_KEY",
    "ZHIPU_API_KEY",
    "FAL_KEY",
    "ELEVENLABS_API_KEY",
    "FISH_AUDIO_API_KEY",
  ];
  for (const field of apiKeyFields) {
    if (field in updates) {
      const val = String(updates[field]).trim();
      // Allow empty (clearing a key) or non-empty string
      if (val.length > 0 && val.length < 8) {
        return `${field} looks too short to be a valid API key`;
      }
    }
  }

  // Validate Ollama fields
  if ("OLLAMA_BASE_URL" in updates) {
    const val = String(updates.OLLAMA_BASE_URL).trim();
    if (val.length > 0 && !val.startsWith("http")) {
      return "OLLAMA_BASE_URL must be a valid HTTP URL";
    }
  }

  if ("OLLAMA_MODEL" in updates) {
    const val = String(updates.OLLAMA_MODEL).trim();
    if (val.length > 0 && val.length < 2) {
      return "OLLAMA_MODEL looks too short to be a valid model name";
    }
  }

  return null;
}

// ── Character helpers ──

function listCharacters(): string[] {
  if (!existsSync(CHARACTERS_DIR)) return [];
  try {
    return readdirSync(CHARACTERS_DIR)
      .filter((entry) => {
        const entryPath = join(CHARACTERS_DIR, entry);
        return (
          statSync(entryPath).isDirectory() &&
          !entry.startsWith(".") &&
          entry !== "example"
        );
      })
      .sort();
  } catch {
    return [];
  }
}

function maskCharacterConfig(config: CharacterConfig): CharacterConfig {
  return {
    discord: {
      ...config.discord,
      botToken: maskApiKey(config.discord.botToken),
    },
    telegram: {
      ...config.telegram,
      botToken: maskApiKey(config.telegram.botToken),
    },
    whatsapp: config.whatsapp,
    voice: {
      ...config.voice,
      elevenlabsKey: maskApiKey(config.voice.elevenlabsKey),
      fishAudioKey: maskApiKey(config.voice.fishAudioKey),
    },
    twitter: {
      ...config.twitter,
      clientSecret: maskApiKey(config.twitter.clientSecret),
      apiKey: maskApiKey(config.twitter.apiKey),
      apiSecret: maskApiKey(config.twitter.apiSecret),
      accessToken: maskApiKey(config.twitter.accessToken),
      accessSecret: maskApiKey(config.twitter.accessSecret),
    },
    autonomous: config.autonomous,
  };
}

// ── Key masking ──

function maskApiKey(value: string): string {
  if (!value || value.length < 8) return value ? "****" : "";
  return value.slice(0, 4) + "****";
}

function maskSettingsKeys(settings: SettingsResponse): SettingsResponse {
  const maskedKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings.keys)) {
    maskedKeys[k] = maskApiKey(v);
  }

  return {
    ...settings,
    keys: maskedKeys,
    discord: {
      ...settings.discord,
      botToken: maskApiKey(settings.discord.botToken),
    },
    telegram: {
      ...settings.telegram,
      botToken: maskApiKey(settings.telegram.botToken),
    },
    twitter: {
      ...settings.twitter,
      clientSecret: maskApiKey(settings.twitter.clientSecret),
      apiKey: maskApiKey(settings.twitter.apiKey),
      apiSecret: maskApiKey(settings.twitter.apiSecret),
      accessToken: maskApiKey(settings.twitter.accessToken),
      accessSecret: maskApiKey(settings.twitter.accessSecret),
    },
    imageGeneration: {
      ...settings.imageGeneration,
      falKey: maskApiKey(settings.imageGeneration.falKey),
    },
    voice: {
      ...settings.voice,
      elevenlabsKey: maskApiKey(settings.voice.elevenlabsKey),
      fishAudioKey: maskApiKey(settings.voice.fishAudioKey),
    },
  };
}

// ── GET ──

export async function GET(request: NextRequest) {
  try {
    const content = await readFile(ENV_PATH, "utf-8");
    const env = parseEnvFlat(content);
    const settings = buildSettingsFromEnv(env);
    const masked = maskSettingsKeys(settings);

    const characterName = request.nextUrl.searchParams.get("character");
    const characters = listCharacters();

    const response: Record<string, unknown> = {
      ...masked,
      characters,
    };

    if (characterName && characters.includes(characterName)) {
      const charConfig = loadCharacterConfig(characterName, CHARACTERS_DIR);
      response.characterConfig = maskCharacterConfig(charConfig);
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read configuration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── PUT ──

interface CharacterUpdatePayload {
  character?: string;
  characterConfig?: Partial<CharacterConfig>;
  [key: string]: string | number | boolean | Partial<CharacterConfig> | undefined;
}

export async function PUT(request: NextRequest) {
  try {
    const body: CharacterUpdatePayload = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const { character: characterName, characterConfig: charConfigUpdate, ...envUpdates } = body;

    // ── Save character config if provided ──
    if (characterName && charConfigUpdate) {
      const characters = listCharacters();
      if (!characters.includes(characterName)) {
        return NextResponse.json(
          { error: `Unknown character: ${characterName}` },
          { status: 400 },
        );
      }

      // Load existing config, merge with updates, save
      const existingConfig = loadCharacterConfig(characterName, CHARACTERS_DIR);
      const mergedConfig: CharacterConfig = {
        discord: { ...existingConfig.discord, ...charConfigUpdate.discord },
        telegram: { ...existingConfig.telegram, ...charConfigUpdate.telegram },
        whatsapp: { ...existingConfig.whatsapp, ...charConfigUpdate.whatsapp },
        voice: { ...existingConfig.voice, ...charConfigUpdate.voice },
        twitter: { ...existingConfig.twitter, ...charConfigUpdate.twitter },
        autonomous: { ...existingConfig.autonomous, ...charConfigUpdate.autonomous },
      };
      saveCharacterConfig(characterName, CHARACTERS_DIR, mergedConfig);
    }

    // ── Save global .env updates if any ──
    const globalUpdates: UpdatePayload = {};
    for (const [key, value] of Object.entries(envUpdates)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        globalUpdates[key] = value;
      }
    }

    if (Object.keys(globalUpdates).length > 0) {
      const validationError = validateUpdates(globalUpdates);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }

      let content: string;
      try {
        content = await readFile(ENV_PATH, "utf-8");
      } catch {
        content = "# Opencrush Configuration\n# Generated by setup wizard\n\n";
      }

      const entries = parseEnvStructured(content);
      const existingKeys = new Set(
        entries.filter((e) => e.type === "kv").map((e) => e.key)
      );

      for (const entry of entries) {
        if (entry.type === "kv" && entry.key && entry.key in globalUpdates) {
          entry.value = String(globalUpdates[entry.key]);
        }
      }

      for (const [key, value] of Object.entries(globalUpdates)) {
        if (!existingKeys.has(key)) {
          entries.push({ type: "kv", raw: "", key, value: String(value) });
        }
      }

      const newContent = serializeEnv(entries);
      await writeFile(ENV_PATH, newContent, "utf-8");
    }

    // ── Return full response ──
    const freshContent = await readFile(ENV_PATH, "utf-8");
    const freshEnv = parseEnvFlat(freshContent);
    const settings = buildSettingsFromEnv(freshEnv);
    const characters = listCharacters();

    const response: Record<string, unknown> = {
      ...settings,
      characters,
    };

    if (characterName && characters.includes(characterName)) {
      const charConfig = loadCharacterConfig(characterName, CHARACTERS_DIR);
      response.characterConfig = maskCharacterConfig(charConfig);
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save configuration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
