import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  // openai is optional — only needed if user picks OpenAI provider
  external: [
    // native modules
    'openai', 'better-sqlite3', 'sharp',
    // heavy optional runtime deps — installed separately if user wants them
    'playwright', 'playwright-core', 'chromium-bidi',
    'ffmpeg-static', 'prism-media', '@discordjs/opus',
    // discord voice
    '@discordjs/voice', 'sodium-native', 'libsodium-wrappers',
    // baileys whatsapp
    '@whiskeysockets/baileys',
  ],
})
