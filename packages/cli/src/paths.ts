/**
 * Path resolution — always relative to where the user runs the command.
 * Users clone the repo, cd into it, and run npx opencrush@latest from there.
 */

import { join } from 'path'
import { mkdirSync, existsSync, statSync } from 'fs'

export const ROOT_DIR: string = process.env.INIT_CWD ?? process.cwd()

export const getEnvPath = (): string => join(ROOT_DIR, '.env')
export const getCharactersDir = (): string => join(ROOT_DIR, 'characters')
export const getTemplatesDir = (): string => join(ROOT_DIR, 'templates')

export function ensureHomeDirExists(): void {
  mkdirSync(getCharactersDir(), { recursive: true })
}

export function isConfigured(): boolean {
  const envPath = getEnvPath()
  if (!existsSync(envPath)) return false
  try { return statSync(envPath).size > 10 } catch { return false }
}
