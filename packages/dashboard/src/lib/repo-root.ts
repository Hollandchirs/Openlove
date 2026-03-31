/**
 * Shared repo-root resolution and .env parsing utilities.
 *
 * Extracted from 9 duplicate copies across API route files.
 * Single source of truth for finding the monorepo root,
 * reading the .env file, and deriving standard paths.
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";

// ── Resolve repo root by walking up to find .env + characters/ ──────────

export function findRepoRoot(): string {
  const candidates = [
    resolve(process.cwd(), "../.."),       // from packages/dashboard
    resolve(process.cwd()),                // from repo root (turbo)
    resolve(__dirname, "../../../../.."),   // from compiled route location
  ];

  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, ".env")) &&
      existsSync(join(candidate, "characters"))
    ) {
      return candidate;
    }
  }

  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, ".env")) &&
      existsSync(join(dir, "characters"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // During Next.js build (SSG/ISR), .env and characters/ may not exist.
  // Return a fallback so the build completes — runtime routes will
  // re-resolve when actually called.
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PHASE === "phase-production-build") {
    return process.cwd();
  }

  throw new Error(
    "Cannot find repo root (.env + characters/). Run `npx opencrush@latest setup` first."
  );
}

// ── .env parser ─────────────────────────────────────────────────────────

export function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eqIndex).trim()] = value;
  }
  return env;
}

// ── Cached .env reader (5-minute TTL) ───────────────────────────────────

let envCache: { readonly env: Record<string, string>; readonly timestamp: number } | null = null;
const ENV_CACHE_TTL = 5 * 60 * 1000;

export function readEnvCached(): Record<string, string> {
  if (envCache && Date.now() - envCache.timestamp < ENV_CACHE_TTL) {
    return envCache.env;
  }
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      "No .env found — run `npx opencrush@latest setup` first."
    );
  }
  const env = parseEnv(readFileSync(ENV_PATH, "utf-8"));
  envCache = { env, timestamp: Date.now() };
  return env;
}

// ── Lazy-evaluated path constants ───────────────────────────────────────

let _repoRoot: string | null = null;

function getRepoRoot(): string {
  if (_repoRoot === null) {
    _repoRoot = findRepoRoot();
  }
  return _repoRoot;
}

export const REPO_ROOT: string = (() => getRepoRoot())();
export const CHARACTERS_DIR: string = join(REPO_ROOT, "characters");
export const ENV_PATH: string = join(REPO_ROOT, ".env");
