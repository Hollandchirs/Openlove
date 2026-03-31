import { defineConfig } from 'tsup'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),
  clean: true,
  onSuccess: async () => {
    // gpt-3-encoder reads these via __dirname at runtime — must live next to dist/index.js
    const encoderDir = resolve('../../node_modules/.pnpm/gpt-3-encoder@1.1.4/node_modules/gpt-3-encoder')
    try {
      copyFileSync(resolve(encoderDir, 'encoder.json'), resolve('dist/encoder.json'))
      copyFileSync(resolve(encoderDir, 'vocab.bpe'), resolve('dist/vocab.bpe'))
    } catch { /* not critical if missing */ }
  },
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
