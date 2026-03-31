import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OpencrushConfig } from "./config-utils";
import { maskKey, getEnabledFeatures } from "./config-utils";

export type { OpencrushConfig } from "./config-utils";
export { maskKey, getEnabledFeatures };

function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

const ENV_PATH = resolve(process.cwd(), "../../.env");

export async function readConfig(): Promise<OpencrushConfig> {
  let content: string;
  try {
    content = await readFile(ENV_PATH, "utf-8");
  } catch {
    throw new Error(
      `Could not read .env file at ${ENV_PATH}. Run \`npx opencrush@latest setup\` first.`
    );
  }

  const env = parseEnv(content);

  const has = (key: string): boolean => Boolean(env[key]?.trim());
  const get = (key: string, fallback = ""): string => env[key]?.trim() || fallback;

  // Collect all keys for masked display
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.toLowerCase().includes("key") || k.toLowerCase().includes("token") || k.toLowerCase().includes("secret")) {
      keys[k] = maskKey(v);
    }
  }

  return {
    llmProvider: get("LLM_PROVIDER", "anthropic"),
    llmModel: get("LLM_MODEL", "(provider default)"),

    characterName: get("CHARACTER_NAME", "mia"),

    discord: {
      configured: has("DISCORD_BOT_TOKEN"),
      clientId: get("DISCORD_CLIENT_ID"),
      ownerId: get("DISCORD_OWNER_ID"),
    },
    telegram: {
      configured: has("TELEGRAM_BOT_TOKEN"),
      ownerId: get("TELEGRAM_OWNER_ID"),
    },
    whatsapp: {
      enabled: get("WHATSAPP_ENABLED") === "true",
    },
    twitter: {
      configured: has("TWITTER_CLIENT_ID") || has("TWITTER_API_KEY"),
      autoPost: get("SOCIAL_AUTO_POST") === "true",
      postInterval: parseInt(get("SOCIAL_MIN_POST_INTERVAL", "120"), 10),
    },

    imageGeneration: {
      configured: has("FAL_KEY"),
      model: get("IMAGE_MODEL", "fal-ai/flux-realism"),
    },

    voice: {
      provider: get("TTS_PROVIDER", "elevenlabs"),
      configured:
        has("ELEVENLABS_API_KEY") || has("FISH_AUDIO_API_KEY"),
      conversationEnabled: get("VOICE_CONVERSATION_ENABLED") === "true",
    },

    quietHoursStart: parseInt(get("QUIET_HOURS_START", "23"), 10),
    quietHoursEnd: parseInt(get("QUIET_HOURS_END", "8"), 10),
    proactiveMinInterval: parseInt(get("PROACTIVE_MESSAGE_MIN_INTERVAL", "60"), 10),
    proactiveMaxInterval: parseInt(get("PROACTIVE_MESSAGE_MAX_INTERVAL", "240"), 10),

    browserAutomation: get("BROWSER_AUTOMATION_ENABLED") === "true",

    keys,
  };
}
