/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      'better-sqlite3', '@anthropic-ai/sdk', 'openai',
      '@opencrush/core', '@opencrush/media', '@opencrush/autonomous',
      'node-cron', 'vectra', 'gpt-3-encoder', 'sharp',
      'playwright', 'playwright-core', 'chromium-bidi',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Use regex to externalize all workspace + native packages
      if (!Array.isArray(config.externals)) {
        config.externals = config.externals ? [config.externals] : [];
      }
      config.externals.push(
        /^@opencrush\/.*/,
        /^playwright.*/,
        /^chromium-bidi/,
        /^better-sqlite3/,
        /^sharp$/,
        /^vectra/,
        /^gpt-3-encoder/,
        /^ffmpeg-static/,
        /^prism-media/,
        /^@discordjs\/.*/,
        /^sodium-native/,
        /^libsodium-wrappers/,
        /^@whiskeysockets\/.*/,
        /^@anthropic-ai\/.*/,
        /^node-cron/,
      );
    }
    return config;
  },
};

module.exports = nextConfig;
