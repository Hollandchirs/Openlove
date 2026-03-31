export interface OpencrushConfig {
  // AI Provider
  llmProvider: string;
  llmModel: string;

  // Character
  characterName: string;

  // Platforms
  discord: {
    configured: boolean;
    clientId: string;
    ownerId: string;
  };
  telegram: {
    configured: boolean;
    ownerId: string;
  };
  whatsapp: {
    enabled: boolean;
  };
  twitter: {
    configured: boolean;
    autoPost: boolean;
    postInterval: number;
  };

  // Image Generation
  imageGeneration: {
    configured: boolean;
    model: string;
  };

  // Voice
  voice: {
    provider: string;
    configured: boolean;
    conversationEnabled: boolean;
  };

  // Schedule
  quietHoursStart: number;
  quietHoursEnd: number;
  proactiveMinInterval: number;
  proactiveMaxInterval: number;

  // Features
  browserAutomation: boolean;

  // Raw key presence (for masked display)
  keys: Record<string, string>;
}

export function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? "****" : "";
  const prefix = key.slice(0, key.indexOf("-") + 1 || 4);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

export function getEnabledFeatures(config: OpencrushConfig): string[] {
  const features: string[] = [];

  if (config.imageGeneration.configured) features.push("Selfies / Image Generation");
  if (config.voice.configured) features.push("Voice Messages");
  if (config.voice.conversationEnabled) features.push("Voice Conversation");
  if (config.browserAutomation) features.push("Browser Automation");
  if (config.twitter.configured) features.push("Twitter Posting");
  if (config.twitter.autoPost) features.push("Auto-posting");

  return features;
}
