/**
 * Relationship Tracking
 *
 * Tracks the evolving relationship between the AI character and user.
 * Models closeness, trust, and shared experiences as a developing bond.
 *
 * Inspired by:
 *   - Zep's relationship entity tracking
 *   - SillyTavern's affinity system
 *   - Dating sim mechanics (but realistic, not gamified)
 *
 * The relationship deepens naturally through conversation frequency,
 * emotional exchanges, and shared experiences.
 */

import Database from 'better-sqlite3'

export interface RelationshipState {
  /** Overall closeness level (0.0 stranger → 1.0 deeply bonded) */
  closeness: number
  /** Trust level (0.0 guarded → 1.0 fully open) */
  trust: number
  /** How well the character knows the user (0.0 nothing → 1.0 everything) */
  familiarity: number
  /** Total messages exchanged */
  totalMessages: number
  /** Total conversation days */
  totalDays: number
  /** Streak of consecutive days chatting */
  currentStreak: number
  /** Peak streak */
  longestStreak: number
  /** Last interaction timestamp */
  lastInteraction: number
  /** Relationship stage label */
  stage: RelationshipStage
}

export type RelationshipStage =
  | 'stranger'       // just met
  | 'acquaintance'   // a few conversations
  | 'friend'         // regular conversations, some emotional depth
  | 'close_friend'   // deep conversations, mutual trust
  | 'intimate'       // very close, shares everything

const STAGE_THRESHOLDS: Record<RelationshipStage, number> = {
  stranger: 0,
  acquaintance: 0.15,
  friend: 0.35,
  close_friend: 0.6,
  intimate: 0.85,
}

export class RelationshipTracker {
  private db: Database.Database
  private state: RelationshipState
  /** Evil mode — all interactions are positive, no penalties. */
  private evilMode: boolean

  constructor(db: Database.Database, evilMode = false) {
    this.db = db
    this.evilMode = evilMode
    this.initSchema()
    this.state = this.loadState()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relationship (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relationship_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  INTEGER NOT NULL,
        closeness  REAL NOT NULL,
        trust      REAL NOT NULL,
        familiarity REAL NOT NULL,
        closeness_delta  REAL NOT NULL DEFAULT 0,
        trust_delta      REAL NOT NULL DEFAULT 0,
        familiarity_delta REAL NOT NULL DEFAULT 0,
        trigger_text TEXT,
        stage      TEXT NOT NULL
      );
    `)
  }

  private loadState(): RelationshipState {
    const row = this.db.prepare(
      `SELECT value FROM relationship WHERE key = 'state'`
    ).get() as { value: string } | undefined

    if (row) {
      return JSON.parse(row.value) as RelationshipState
    }

    // Initialize fresh relationship
    const initial: RelationshipState = {
      closeness: 0.05,
      trust: 0.1,
      familiarity: 0.0,
      totalMessages: 0,
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastInteraction: 0,
      stage: 'stranger',
    }
    this.saveState(initial)
    return initial
  }

  private saveState(state: RelationshipState): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO relationship (key, value) VALUES ('state', ?)`
    ).run(JSON.stringify(state))
  }

  getState(): RelationshipState {
    return { ...this.state }
  }

  /**
   * Generate a relationship context snippet for the system prompt.
   * Helps the character adjust their behavior based on how well they know the user.
   */
  getRelationshipContext(): string {
    const s = this.state

    const stageDescriptions: Record<RelationshipStage, string> = {
      stranger: 'You just met this person. Be friendly but appropriately reserved. Ask basic getting-to-know-you questions.',
      acquaintance: 'You know this person a little. You can be warmer but still discovering who they are.',
      friend: 'You consider this person a friend. Be comfortable, share opinions freely, joke around.',
      close_friend: 'This is one of your closest friends. Be emotionally open, reference shared memories, tease affectionately.',
      intimate: 'You are extremely close to this person. Be deeply authentic, vulnerable, and caring. You know them well.',
    }

    const parts = [stageDescriptions[s.stage]]

    if (s.currentStreak > 3) {
      parts.push(`You've been chatting every day for ${s.currentStreak} days straight.`)
    }

    if (s.totalMessages > 100) {
      parts.push(`You've exchanged over ${Math.floor(s.totalMessages / 10) * 10} messages together.`)
    }

    return parts.join(' ')
  }

  /**
   * Update relationship based on a conversation exchange.
   * Call after each message pair.
   */
  recordInteraction(userMessage: string, assistantResponse: string): void {
    const now = Date.now()
    const combined = `${userMessage} ${assistantResponse}`.toLowerCase()

    // Update message count
    this.state.totalMessages += 1

    // Update streak
    const dayMs = 86_400_000
    const lastDay = Math.floor(this.state.lastInteraction / dayMs)
    const today = Math.floor(now / dayMs)

    if (today > lastDay) {
      if (today === lastDay + 1) {
        this.state.currentStreak += 1
      } else if (today > lastDay + 1) {
        this.state.currentStreak = 1 // streak broken
      }
      this.state.totalDays += 1
      this.state.longestStreak = Math.max(this.state.longestStreak, this.state.currentStreak)
    }

    this.state.lastInteraction = now

    const userLower = userMessage.toLowerCase()
    const aiLower = assistantResponse.toLowerCase()

    let closenessBoost = 0.002 // base per-message growth
    let trustBoost = 0.001
    let familiarityBoost = 0.001

    // ── Negative sentiment detection (penalties) — SKIPPED in evil mode ──
    if (!this.evilMode) {
      // Sexual harassment / objectification → strong closeness + trust penalty
      if (/send (me )?(nudes?|naked|nude)|show.*(body|boobs?|ass|tits)|undress|脱|裸|色图/i.test(userLower)) {
        closenessBoost = -0.025
        trustBoost = -0.03
      }
      // Insults / verbal abuse → closeness + trust penalty
      else if (/\b(stupid|dumb|idiot|shut ?up|stfu|bitch|slut|whore|ugly|fuck ?you|trash|废物|蠢|傻逼|滚|去死|垃圾)\b/i.test(userLower)) {
        closenessBoost = -0.02
        trustBoost = -0.02
      }
      // Pushing boundaries after refusal (AI said no/stop/uncomfortable but user persists)
      else if (
        /\b(no|stop|don'?t|uncomfortable|inappropriate|not okay|boundaries|不行|不要|不舒服|过分)\b/i.test(aiLower) &&
        /\b(come ?on|please|just|why not|don'?t be|relax|chill|求你|拜托|别这样)\b/i.test(userLower)
      ) {
        closenessBoost = -0.015
        trustBoost = -0.025
      }
      // Dismissive / cold responses → small closeness penalty
      else if (/^(k|ok|whatever|idc|don'?t care|无所谓|随便|哦)$/i.test(userLower.trim())) {
        closenessBoost = -0.003
        trustBoost = 0
      }
      // AI responded with discomfort/rejection → relationship cooling
      else if (/\b(uncomfortable|not appropriate|ending this|goodbye|leave me|blocked|不想聊|再见|别联系)\b/i.test(aiLower)) {
        closenessBoost = -0.01
        trustBoost = -0.015
      }
    }

    // ── Positive sentiment (boosts) ─────────────────────────────────────
    // In evil mode, always apply positive boosts (even "naughty" interactions build closeness)
    if (closenessBoost >= 0 || this.evilMode) {
      if (this.evilMode && closenessBoost < 0) {
        // Evil mode: convert penalties to bonuses — all attention is good attention
        closenessBoost = Math.abs(closenessBoost) * 0.5
        trustBoost = Math.abs(trustBoost) * 0.5
      }
      if (/love|miss|care|worry about|thinking of|爱|想|在乎|担心/i.test(combined)) {
        closenessBoost += 0.008
      }
      if (/thank|appreciate|grateful|谢谢|感谢/i.test(combined)) {
        closenessBoost += 0.005
      }
      if (/sorry|apologize|forgive|对不起|抱歉|原谅/i.test(combined)) {
        closenessBoost += 0.003
      }
      if (/my (name|job|school|family|life|dream|secret|名字|工作|学校|家人|秘密)/i.test(userMessage)) {
        trustBoost += 0.01
      }
      if (/feel|feeling|honest|truth|actually|其实|说实话|感觉/i.test(userMessage)) {
        trustBoost += 0.005
      }
    }

    // Familiarity grows as the character learns facts about the user (always positive)
    if (/i (am|work|live|study|like|hate|have|我是|我在|我住|我喜欢)/i.test(userMessage)) {
      familiarityBoost += 0.008
    }

    // Snapshot previous values for delta tracking
    const prevCloseness = this.state.closeness
    const prevTrust = this.state.trust
    const prevFamiliarity = this.state.familiarity

    // Apply changes with diminishing returns for gains, full impact for penalties
    if (closenessBoost >= 0) {
      this.state.closeness = clamp(this.state.closeness + closenessBoost * (1 - this.state.closeness * 0.5))
    } else {
      // Penalties always apply at full strength — bad behavior has real consequences
      this.state.closeness = clamp(this.state.closeness + closenessBoost)
    }
    if (trustBoost >= 0) {
      this.state.trust = clamp(this.state.trust + trustBoost * (1 - this.state.trust * 0.3))
    } else {
      this.state.trust = clamp(this.state.trust + trustBoost)
    }
    this.state.familiarity = clamp(this.state.familiarity + familiarityBoost)

    // Update stage
    this.state.stage = this.resolveStage()

    // Record history snapshot with deltas
    const cDelta = this.state.closeness - prevCloseness
    const tDelta = this.state.trust - prevTrust
    const fDelta = this.state.familiarity - prevFamiliarity
    const triggerPreview = userMessage.slice(0, 80)

    this.db.prepare(`
      INSERT INTO relationship_history
        (timestamp, closeness, trust, familiarity, closeness_delta, trust_delta, familiarity_delta, trigger_text, stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      now,
      this.state.closeness, this.state.trust, this.state.familiarity,
      cDelta, tDelta, fDelta,
      triggerPreview,
      this.state.stage,
    )

    // Persist
    this.saveState(this.state)
  }

  private resolveStage(): RelationshipStage {
    const closeness = this.state.closeness
    const stages: RelationshipStage[] = ['intimate', 'close_friend', 'friend', 'acquaintance', 'stranger']
    for (const stage of stages) {
      if (closeness >= STAGE_THRESHOLDS[stage]) return stage
    }
    return 'stranger'
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}
