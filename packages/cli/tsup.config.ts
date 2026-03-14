import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),
  clean: true,
  // openai is optional — only needed if user picks OpenAI provider
  external: ['openai', 'better-sqlite3'],
})
