/**
 * Memory Database Access Layer
 *
 * Reads from a character's memory.db (SQLite) to power the dashboard.
 * All functions open/close the database per call to avoid stale handles.
 * The database is opened in readonly mode — the dashboard never writes.
 */

import Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'

// ── Types ──────────────────────────────────────────────────────────────────

// Re-export stage display utilities from the shared module (safe for client bundles)
export {
  type RelationshipStage,
  STAGE_DISPLAY,
  STAGE_ORDER,
  STAGE_THRESHOLDS,
  STAGE_LABELS,
  getStageDisplay,
} from './stage-display'

import type { RelationshipStage } from './stage-display'

export interface RelationshipState {
  closeness: number
  trust: number
  familiarity: number
  totalMessages: number
  totalDays: number
  currentStreak: number
  longestStreak: number
  lastInteraction: number
  stage: RelationshipStage
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  platform?: string
}

export interface Episode {
  id: number
  type: 'music' | 'drama' | 'mood' | 'event' | 'user_fact' | 'conversation_highlight'
  title: string
  description: string
  metadata?: string
  timestamp: number
}

export interface RelationshipHistoryEntry {
  id: number
  timestamp: number
  closeness: number
  trust: number
  familiarity: number
  closeness_delta: number
  trust_delta: number
  familiarity_delta: number
  trigger_text: string | null
  stage: string
}


// ── Database helpers ───────────────────────────────────────────────────────

function findCharacterDir(slug?: string): string | null {
  // Characters are stored at repo_root/characters/<slug>/
  const repoRoot = join(process.cwd(), '..', '..')
  const charsDir = join(repoRoot, 'characters')

  if (!existsSync(charsDir)) return null

  if (slug) {
    const dir = join(charsDir, slug)
    if (existsSync(join(dir, 'memory.db'))) return dir
    return null
  }

  // Find first character with a memory.db
  try {
    const entries = readdirSync(charsDir)
    for (const entry of entries) {
      const entryPath = join(charsDir, entry)
      if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, 'memory.db'))) {
        return entryPath
      }
    }
  } catch {
    // ignore
  }
  return null
}

function openDb(slug?: string): Database.Database | null {
  const charDir = findCharacterDir(slug)
  if (!charDir) return null

  const dbPath = join(charDir, 'memory.db')
  if (!existsSync(dbPath)) return null

  try {
    return new Database(dbPath, { readonly: true })
  } catch {
    return null
  }
}

// ── Data Access Functions ──────────────────────────────────────────────────

export function getRelationshipState(slug?: string): RelationshipState | null {
  const db = openDb(slug)
  if (!db) return null

  try {
    const row = db.prepare("SELECT value FROM relationship WHERE key = 'state'").get() as
      | { value: string }
      | undefined

    if (!row) return null
    return JSON.parse(row.value) as RelationshipState
  } catch {
    return null
  } finally {
    db.close()
  }
}

export function getMessages(limit = 50, search?: string, slug?: string): Message[] {
  const db = openDb(slug)
  if (!db) return []

  try {
    if (search && search.trim().length > 0) {
      const rows = db
        .prepare(
          `SELECT role, content, timestamp, platform
           FROM messages
           WHERE content LIKE ?
           ORDER BY timestamp DESC
           LIMIT ?`
        )
        .all(`%${search}%`, limit) as Message[]
      return rows.reverse()
    }

    const rows = db
      .prepare(
        `SELECT role, content, timestamp, platform
         FROM messages
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(limit) as Message[]
    return rows.reverse()
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Internal proactive-message episodes are server bookkeeping and should
 * never surface in user-facing views (timeline, activity cards, etc.).
 */
function isProactiveMessageEpisode(ep: Episode): boolean {
  const lower = ep.title.toLowerCase()
  return lower.includes('proactive message') || lower.includes('proactive_message')
}

export function getEpisodes(limit = 50, type?: string, slug?: string): Episode[] {
  const db = openDb(slug)
  if (!db) return []

  // Fetch extra rows so we still have `limit` results after filtering out
  // internal proactive-message episodes.
  const fetchLimit = limit + 20

  try {
    let raw: Episode[]

    if (type && type !== 'all') {
      raw = db
        .prepare(
          `SELECT id, type, title, description, metadata, timestamp
           FROM episodes
           WHERE type = ?
           ORDER BY timestamp DESC
           LIMIT ?`
        )
        .all(type, fetchLimit) as Episode[]
    } else {
      raw = db
        .prepare(
          `SELECT id, type, title, description, metadata, timestamp
           FROM episodes
           ORDER BY timestamp DESC
           LIMIT ?`
        )
        .all(fetchLimit) as Episode[]
    }

    return raw.filter((ep) => !isProactiveMessageEpisode(ep)).slice(0, limit)
  } catch {
    return []
  } finally {
    db.close()
  }
}

export function getRelationshipHistory(days = 7, slug?: string): RelationshipHistoryEntry[] {
  const db = openDb(slug)
  if (!db) return []

  const cutoff = Date.now() - days * 86_400_000

  try {
    // Check if the table exists
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relationship_history'")
      .get()

    if (!tableExists) return []

    return db
      .prepare(
        `SELECT id, timestamp, closeness, trust, familiarity,
                closeness_delta, trust_delta, familiarity_delta,
                trigger_text, stage
         FROM relationship_history
         WHERE timestamp > ?
         ORDER BY timestamp ASC`
      )
      .all(cutoff) as RelationshipHistoryEntry[]
  } catch {
    return []
  } finally {
    db.close()
  }
}

export function getMemoryFileContent(slug?: string): string {
  const charDir = findCharacterDir(slug)
  if (!charDir) return ''

  const memoryPath = join(charDir, 'MEMORY.md')
  if (!existsSync(memoryPath)) return ''

  try {
    return readFileSync(memoryPath, 'utf-8')
  } catch {
    return ''
  }
}

export function getCharacterName(slug?: string): string {
  const charDir = findCharacterDir(slug)
  if (!charDir) return 'Unknown'
  return basename(charDir)
}
