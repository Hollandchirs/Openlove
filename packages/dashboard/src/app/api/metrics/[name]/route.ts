import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { join } from 'path'
import { validateCharacterName } from '@/lib/validate-name'

const REPO_ROOT = join(process.cwd(), '..', '..')
const CHARACTERS_DIR = join(REPO_ROOT, 'characters')

// ── Types ───────────────────────────────────────────────────────────────

interface MetricsResponse {
  heartbeat: number
  closeness: number
  trust: number
  familiarity: number
  stage: string
  totalMessages: number
  totalDays: number
  currentStreak: number
  longestStreak: number
  lastInteraction: number
  messagesPerDay: number
  memoryHitRate: number | null
  recentMemories: string[]
  trendData: TrendPoint[]
  dailyMessages: DailyMessagePoint[]
  heatmap: HeatmapCell[]
}

interface TrendPoint {
  date: string
  closeness: number
  trust: number
  familiarity: number
}

interface DailyMessagePoint {
  date: string
  count: number
}

interface HeatmapCell {
  day: number   // 0=Sun ... 6=Sat
  hour: number  // 0-23
  count: number
}

// ── Helpers ─────────────────────────────────────────────────────────────

function openDb(name: string) {
  const dbPath = join(CHARACTERS_DIR, name, 'memory.db')
  if (!existsSync(dbPath)) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3')
    return new Database(dbPath, { readonly: true })
  } catch {
    return null
  }
}

function tableExists(db: ReturnType<typeof openDb>, tableName: string): boolean {
  if (!db) return false
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(tableName)
    return !!row
  } catch {
    return false
  }
}

function formatDateKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Route Handler ───────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params

  if (!validateCharacterName(name)) {
    return NextResponse.json({ error: 'Invalid character name' }, { status: 400 })
  }

  const charDir = join(CHARACTERS_DIR, name)

  if (!existsSync(charDir)) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 })
  }

  const db = openDb(name)
  if (!db) {
    // Return zeroed-out metrics so the dashboard can show a friendly empty state
    return NextResponse.json({
      heartbeat: 0,
      closeness: 0,
      trust: 0,
      familiarity: 0,
      stage: 'stranger',
      totalMessages: 0,
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastInteraction: 0,
      messagesPerDay: 0,
      memoryHitRate: null,
      recentMemories: [],
      trendData: [],
      dailyMessages: [],
      heatmap: [],
      noData: true,
    })
  }

  try {
    const metrics = computeMetrics(db, name)
    return NextResponse.json(metrics)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    db.close()
  }
}

function computeMetrics(db: ReturnType<typeof openDb>, name: string): MetricsResponse {
  // ── Relationship state ────────────────────────────────────────────────
  let closeness = 0
  let trust = 0
  let familiarity = 0
  let stage = 'stranger'
  let totalMessages = 0
  let totalDays = 0
  let currentStreak = 0
  let longestStreak = 0
  let lastInteraction = 0

  if (tableExists(db, 'relationship')) {
    try {
      const row = db!.prepare("SELECT value FROM relationship WHERE key = 'state'").get() as
        | { value: string }
        | undefined
      if (row) {
        const parsed = JSON.parse(row.value)
        closeness = parsed.closeness ?? 0
        trust = parsed.trust ?? 0
        familiarity = parsed.familiarity ?? 0
        stage = parsed.stage ?? 'stranger'
        totalMessages = parsed.totalMessages ?? 0
        totalDays = parsed.totalDays ?? 0
        currentStreak = parsed.currentStreak ?? 0
        longestStreak = parsed.longestStreak ?? 0
        lastInteraction = parsed.lastInteraction ?? 0
      }
    } catch {
      // ignore parse errors
    }
  }

  // Heartbeat score: closeness * 0.4 + trust * 0.3 + familiarity * 0.3
  const heartbeat = closeness * 0.4 + trust * 0.3 + familiarity * 0.3

  // ── Messages per day (last 7 days) ────────────────────────────────────
  let messagesPerDay = 0
  if (tableExists(db, 'messages')) {
    try {
      const sevenDaysAgo = Date.now() - 7 * 86_400_000
      const row = db!
        .prepare('SELECT COUNT(*) as cnt FROM messages WHERE timestamp > ?')
        .get(sevenDaysAgo) as { cnt: number }
      messagesPerDay = Math.round((row.cnt / 7) * 10) / 10
    } catch {
      // ignore
    }

    // Fallback total messages from messages table if relationship state didn't have it
    if (totalMessages === 0) {
      try {
        const row = db!.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }
        totalMessages = row.cnt
      } catch {
        // ignore
      }
    }
  }

  // ── Memory hit rate ───────────────────────────────────────────────────
  let memoryHitRate: number | null = null
  if (tableExists(db, 'episodes')) {
    try {
      const totalEpisodes = (db!.prepare('SELECT COUNT(*) as cnt FROM episodes').get() as { cnt: number }).cnt
      if (totalEpisodes > 0 && totalMessages > 0) {
        memoryHitRate = Math.min(1, totalEpisodes / totalMessages)
      }
    } catch {
      // ignore
    }
  }

  // ── Recent memories from MEMORY.md ────────────────────────────────────
  const recentMemories: string[] = []
  try {
    const { readFileSync } = require('fs')
    const memoryPath = join(CHARACTERS_DIR, name, 'MEMORY.md')
    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, 'utf-8') as string
      const lines = content.split('\n').filter((l: string) => l.trim().startsWith('-'))
      for (const line of lines.slice(-5)) {
        recentMemories.push(line.replace(/^-\s*/, '').trim())
      }
    }
  } catch {
    // ignore
  }

  // ── 30-day trend data from relationship_history ───────────────────────
  const trendData: TrendPoint[] = []
  if (tableExists(db, 'relationship_history')) {
    try {
      const thirtyDaysAgo = Date.now() - 30 * 86_400_000
      const rows = db!
        .prepare(
          `SELECT timestamp, closeness, trust, familiarity
           FROM relationship_history
           WHERE timestamp > ?
           ORDER BY timestamp ASC`
        )
        .all(thirtyDaysAgo) as Array<{
        timestamp: number
        closeness: number
        trust: number
        familiarity: number
      }>

      // Aggregate by day (take last entry per day)
      const byDay = new Map<string, { closeness: number; trust: number; familiarity: number }>()
      for (const row of rows) {
        const key = formatDateKey(row.timestamp)
        byDay.set(key, {
          closeness: row.closeness,
          trust: row.trust,
          familiarity: row.familiarity,
        })
      }

      Array.from(byDay.entries()).forEach(([date, values]) => {
        trendData.push({
          date,
          closeness: Math.round(values.closeness * 100),
          trust: Math.round(values.trust * 100),
          familiarity: Math.round(values.familiarity * 100),
        })
      })
    } catch {
      // ignore
    }
  }

  // ── Daily message counts (last 14 days) ───────────────────────────────
  const dailyMessages: DailyMessagePoint[] = []
  if (tableExists(db, 'messages')) {
    try {
      const fourteenDaysAgo = Date.now() - 14 * 86_400_000
      const rows = db!
        .prepare(
          `SELECT timestamp FROM messages WHERE timestamp > ? ORDER BY timestamp ASC`
        )
        .all(fourteenDaysAgo) as Array<{ timestamp: number }>

      const byDay = new Map<string, number>()

      // Pre-fill all 14 days
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000)
        const key = formatDateKey(d.getTime())
        byDay.set(key, 0)
      }

      for (const row of rows) {
        const key = formatDateKey(row.timestamp)
        byDay.set(key, (byDay.get(key) ?? 0) + 1)
      }

      Array.from(byDay.entries()).forEach(([date, count]) => {
        dailyMessages.push({ date, count })
      })
    } catch {
      // ignore
    }
  }

  // ── Activity heatmap (hour x day of week) ─────────────────────────────
  const heatmap: HeatmapCell[] = []
  if (tableExists(db, 'messages')) {
    try {
      const rows = db!
        .prepare('SELECT timestamp FROM messages')
        .all() as Array<{ timestamp: number }>

      const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))

      for (const row of rows) {
        const d = new Date(row.timestamp)
        grid[d.getDay()][d.getHours()]++
      }

      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          heatmap.push({ day, hour, count: grid[day][hour] })
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    heartbeat,
    closeness,
    trust,
    familiarity,
    stage,
    totalMessages,
    totalDays,
    currentStreak,
    longestStreak,
    lastInteraction,
    messagesPerDay,
    memoryHitRate,
    recentMemories,
    trendData,
    dailyMessages,
    heatmap,
  }
}
