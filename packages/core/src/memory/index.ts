/**
 * Three-Layer Memory System
 *
 * Layer 1 — Working Memory:    Recent conversation turns (SQLite, fast)
 * Layer 2 — Episodic Memory:   Life events log (SQLite JSON, queryable)
 * Layer 3 — Semantic Memory:   Vector embeddings for long-term recall (vectra)
 *
 * Inspired by: a16z companion-app (Redis+pgvector) → adapted for local SQLite
 * Design principle: zero cloud dependencies, everything runs locally
 */

import Database from 'better-sqlite3'
import { LocalIndex } from 'vectra'
import { join } from 'path'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  platform?: string
}

export interface Episode {
  id?: number
  type: 'music' | 'drama' | 'mood' | 'event' | 'user_fact' | 'conversation_highlight'
  title: string
  description: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export interface MemoryContext {
  recentMessages: Message[]
  relevantEpisodes: Episode[]
  semanticContext: string[]
}

export class MemorySystem {
  private db: Database.Database
  private vectorIndex: LocalIndex
  private characterName: string
  private embedFn: (text: string) => Promise<number[]>
  /** Optional LLM summarize function — injected by engine for conversation compression */
  private summarizeFn?: (text: string) => Promise<string>
  /** Cached rolling summary of older conversation history */
  private conversationSummary: string = ''
  /** Message ID up to which the summary covers */
  private summaryUpToId: number = 0
  /** Path to character data directory */
  private charDir: string
  /** Counter for consolidate calls — triggers MEMORY.md sync every N calls */
  private consolidateCount: number = 0
  /** How often to sync MEMORY.md (every N consolidate calls) */
  private readonly SYNC_INTERVAL = 10

  constructor(
    characterName: string,
    dataDir: string,
    embedFn: (text: string) => Promise<number[]>,
    summarizeFn?: (text: string) => Promise<string>
  ) {
    this.characterName = characterName
    this.embedFn = embedFn
    this.summarizeFn = summarizeFn
    this.charDir = join(dataDir, characterName)

    const dbPath = join(this.charDir, 'memory.db')
    const vectorPath = join(this.charDir, 'vectors')

    mkdirSync(join(dataDir, characterName), { recursive: true })
    mkdirSync(vectorPath, { recursive: true })

    this.db = new Database(dbPath)
    this.vectorIndex = new LocalIndex(vectorPath)
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        role      TEXT NOT NULL,
        content   TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        platform  TEXT
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT NOT NULL,
        title       TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata    TEXT,
        timestamp   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_episodes_type ON episodes(type);
      CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
    `)
  }

  /** Expose the database for shared use (e.g. relationship tracker) */
  getDatabase(): Database.Database {
    return this.db
  }

  /**
   * Reset conversation history — clears all messages from DB and in-memory caches.
   * Use when the conversation has gone off-track and needs a fresh start.
   * Does NOT affect episodes, relationship state, or MEMORY.md.
   */
  resetConversation(): void {
    this.db.prepare('DELETE FROM messages').run()
    this.conversationSummary = ''
    this.summaryUpToId = 0
    console.log('[Memory] Conversation history cleared — fresh start')
  }

  // ── Working Memory ─────────────────────────────────────────────────────────

  addMessage(msg: Message): void {
    this.db.prepare(`
      INSERT INTO messages (role, content, timestamp, platform)
      VALUES (?, ?, ?, ?)
    `).run(msg.role, msg.content, msg.timestamp, msg.platform ?? null)
  }

  getRecentMessages(limit = 30): Message[] {
    const rows = this.db.prepare(`
      SELECT role, content, timestamp, platform
      FROM messages
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as Message[]
    return rows.reverse()
  }

  // ── Episodic Memory ────────────────────────────────────────────────────────

  async logEpisode(episode: Omit<Episode, 'id'>): Promise<void> {
    const metaStr = episode.metadata ? JSON.stringify(episode.metadata) : null
    this.db.prepare(`
      INSERT INTO episodes (type, title, description, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(episode.type, episode.title, episode.description, metaStr, episode.timestamp)

    // Also embed into semantic memory for retrieval
    const text = `${episode.title}: ${episode.description}`
    await this.addToSemanticMemory(text, { type: episode.type, timestamp: episode.timestamp })
  }

  getRecentEpisodes(limit = 10, type?: Episode['type']): Episode[] {
    if (type) {
      return this.db.prepare(`
        SELECT * FROM episodes WHERE type = ?
        ORDER BY timestamp DESC LIMIT ?
      `).all(type, limit) as Episode[]
    }
    return this.db.prepare(`
      SELECT * FROM episodes ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as Episode[]
  }

  // ── Semantic Memory ────────────────────────────────────────────────────────

  async addToSemanticMemory(
    text: string,
    metadata: Record<string, string | number | boolean> = {}
  ): Promise<void> {
    try {
      if (!await this.vectorIndex.isIndexCreated()) {
        await this.vectorIndex.createIndex({ version: 1, deleteIfExists: false })
      }
      const importance = (metadata.importance as number) ?? scoreImportance(text)
      const vector = await this.embedFn(text)
      await this.vectorIndex.insertItem({
        vector,
        metadata: { text, importance, ...metadata },
      })
    } catch (err) {
      // Vector memory is best-effort — don't crash if it fails
      console.warn('[Memory] Vector store write failed:', (err as Error).message)
    }
  }

  async searchSemanticMemory(query: string, topK = 5): Promise<string[]> {
    try {
      if (!await this.vectorIndex.isIndexCreated()) return []
      const vector = await this.embedFn(query)
      // Fetch more candidates for hybrid re-ranking
      const results = await this.vectorIndex.queryItems(vector, topK * 3)

      const now = Date.now()
      const DAY_MS = 86_400_000

      return results
        .filter(r => r.score > 0.6) // lower threshold, let hybrid scoring decide
        .map(r => {
          const meta = r.item.metadata as { text: string; timestamp?: number; importance?: number }
          const age = now - (meta.timestamp ?? now)
          const ageDays = age / DAY_MS

          // Hybrid score: semantic similarity + importance bonus - time decay
          const importance = meta.importance ?? 0.5
          const decayFactor = Math.exp(-ageDays / 30) // half-life ~21 days
          const hybridScore = r.score * 0.6 + importance * 0.25 + decayFactor * 0.15

          return { text: meta.text, hybridScore }
        })
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, topK)
        .map(r => r.text)
    } catch (err) {
      console.warn('[Memory] Semantic search failed:', (err as Error).message)
      return []
    }
  }

  // ── Combined Context Retrieval ─────────────────────────────────────────────

  async getContext(userMessage: string): Promise<MemoryContext> {
    const RECENT_VERBATIM = 8  // keep last 8 messages as-is
    const OLDER_BATCH = 20     // fetch more for summarization

    const [allMessages, semanticContext] = await Promise.all([
      Promise.resolve(this.getRecentMessages(OLDER_BATCH)),
      this.searchSemanticMemory(userMessage),
    ])

    const relevantEpisodes = this.getRecentEpisodes(5)

    // Split: recent messages verbatim, older ones get summarized
    let recentMessages: Message[]
    if (allMessages.length <= RECENT_VERBATIM) {
      recentMessages = allMessages
    } else {
      const olderMessages = allMessages.slice(0, allMessages.length - RECENT_VERBATIM)
      const recentVerbatim = allMessages.slice(allMessages.length - RECENT_VERBATIM)

      // Build a rolling summary of older messages if summarize function is available
      const summary = await this.summarizeOlderMessages(olderMessages)
      if (summary) {
        // Inject summary as a synthetic "assistant" message at the start
        recentMessages = [
          { role: 'assistant', content: `[Earlier conversation summary: ${summary}]`, timestamp: olderMessages[0].timestamp },
          ...recentVerbatim,
        ]
      } else {
        // No summarizer — just use the recent verbatim messages
        recentMessages = recentVerbatim
      }
    }

    return { recentMessages, relevantEpisodes, semanticContext }
  }

  /**
   * Summarize older messages into a compact summary.
   * Uses rolling cache — only re-summarizes when new messages have aged out.
   */
  private async summarizeOlderMessages(messages: Message[]): Promise<string | null> {
    if (!this.summarizeFn || messages.length === 0) return null

    // Check if we already have a summary covering these messages
    const latestOlderId = messages[messages.length - 1].timestamp
    if (this.conversationSummary && latestOlderId <= this.summaryUpToId) {
      return this.conversationSummary
    }

    try {
      const transcript = messages
        .map(m => `${m.role}: ${m.content.slice(0, 150)}`)
        .join('\n')

      this.conversationSummary = await this.summarizeFn(
        `Summarize this conversation in 2-3 sentences, preserving key facts, emotions, and topics discussed:\n\n${transcript}`
      )
      this.summaryUpToId = latestOlderId
      return this.conversationSummary
    } catch (err) {
      console.warn('[Memory] Conversation summarization failed:', (err as Error).message)
      return null
    }
  }

  /**
   * Extract and store important facts from a conversation turn.
   * Called after each exchange to build up long-term memory.
   * Only embeds messages that contain meaningful, memorable content.
   */
  async consolidate(
    userMessage: string,
    assistantResponse: string,
    options?: { skipAssistantSave?: boolean }
  ): Promise<void> {
    // Store the exchange in working memory (always — this is the raw log)
    const now = Date.now()
    this.addMessage({ role: 'user', content: userMessage, timestamp: now })

    // When a media action (send_image/send_voice) is present, the generate-image or
    // generate-voice route will write the canonical media message to the DB.
    // Saving the assistant's text reply here too would create a duplicate message
    // (one text + one [image:url]) per selfie request.
    // skipAssistantSave=true tells us to skip the text save entirely.
    if (!options?.skipAssistantSave) {
      // Only store assistant text if it contains meaningful content — media-only responses
      // (where the entire message was a [SELFIE:] / [IMAGE:] tag) are saved separately by
      // generate-image/generate-voice. After tag stripping, the remaining text may be empty,
      // whitespace-only, or just punctuation fragments (e.g. "~", "!", "...").
      // Storing these creates phantom blank messages that show on page refresh.
      const meaningfulText = assistantResponse
        .replace(/[\s~!?.…*_\-–—]+/g, '')  // strip whitespace, punctuation, markdown emphasis
      if (meaningfulText.length > 0) {
        this.addMessage({ role: 'assistant', content: assistantResponse, timestamp: now + 1 })
      }
    }

    // Only embed into semantic memory if the message is worth remembering
    if (isWorthEmbedding(userMessage, assistantResponse)) {
      const exchange = `User said: "${userMessage}" — Response: "${assistantResponse.slice(0, 200)}"`
      await this.addToSemanticMemory(exchange, { timestamp: now })
    }

    // Periodically sync MEMORY.md with accumulated knowledge
    this.consolidateCount++
    if (this.consolidateCount % this.SYNC_INTERVAL === 0) {
      // Fire-and-forget both syncs in parallel
      Promise.all([
        this.syncMemoryFile(),
        this.syncUserFile(),
      ]).catch(err =>
        console.warn('[Memory] File sync failed:', (err as Error).message)
      )
    }
  }

  getMoodContext(): string {
    const recentEpisodes = this.getRecentEpisodes(3)
    if (recentEpisodes.length === 0) return ''

    const latest = recentEpisodes[0]
    if (latest.type === 'mood') return latest.title
    return ''
  }

  /**
   * Sync MEMORY.md with accumulated knowledge from the database.
   * Uses LLM to extract key facts from recent conversations + episodes,
   * then writes a structured markdown file the AI reads at startup.
   */
  async syncMemoryFile(): Promise<void> {
    if (!this.summarizeFn) return

    const memoryPath = join(this.charDir, 'MEMORY.md')

    // Gather data from all memory layers
    const recentMessages = this.getRecentMessages(30)
    const recentEpisodes = this.getRecentEpisodes(20)

    // Build transcript for LLM analysis
    const transcript = recentMessages
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n')

    const episodeList = recentEpisodes
      .map(e => `[${e.type}] ${e.title}: ${e.description}`)
      .join('\n')

    // Read existing MEMORY.md to preserve manually-added notes
    let existingMemory = ''
    if (existsSync(memoryPath)) {
      existingMemory = readFileSync(memoryPath, 'utf-8')
    }

    const prompt = `You are updating a character's memory file based on recent conversations and activities.

EXISTING MEMORY FILE:
${existingMemory}

RECENT CONVERSATIONS:
${transcript}

RECENT LIFE EVENTS:
${episodeList}

Write an updated MEMORY.md with these sections. Keep ALL existing facts and add new ones discovered from the conversations. Remove placeholder text like "[add your own]". Be specific — use real names, preferences, and details mentioned in conversation.

FORMAT (use exactly this structure):
## Things She Knows About You
- (bullet points of facts about the user: name, timezone, preferences, personal details, habits)

## Her Current Obsessions
Watching: (specific shows from episodes)
Listening to: (specific songs/artists from episodes)
Browsing: (websites she's been visiting)

## Conversation Highlights
- (memorable moments, jokes, emotional exchanges from recent chats)

## Notes to Self
- (character's personal thoughts, goals, feelings mentioned in conversation)

RULES:
- Keep it concise — max 25 bullet points total
- Only include FACTS actually mentioned in conversations or episodes
- Do NOT invent or hallucinate facts
- Use casual, first-person voice (as if the character is writing notes to herself)
- If existing memory has real facts, KEEP them. Only remove placeholder text.
- NEVER include negative relationship events like blocking, deactivating, ending friendships, or refusing to talk.
- NEVER include content about boundaries being violated, harassment, or trust being broken.
- Focus on POSITIVE and NEUTRAL facts. The memory file should reflect a healthy, ongoing relationship.
- If the existing MEMORY.md was manually edited by the user, respect those edits as the source of truth.`

    const newContent = await this.summarizeFn(prompt)
    if (newContent && newContent.length > 50) {
      writeFileSync(memoryPath, newContent.trim() + '\n', 'utf-8')
      console.log('[Memory] MEMORY.md synced with latest knowledge')
    }
  }

  /**
   * Sync USER.md with accumulated knowledge about the user.
   * Extracts personal facts, preferences, and relationship dynamics
   * from recent conversations and writes them to USER.md.
   */
  async syncUserFile(): Promise<void> {
    if (!this.summarizeFn) return

    const userPath = join(this.charDir, 'USER.md')

    const recentMessages = this.getRecentMessages(30)
    const transcript = recentMessages
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n')

    let existingUser = ''
    if (existsSync(userPath)) {
      existingUser = readFileSync(userPath, 'utf-8')
    }

    // Get relationship data
    let relationshipInfo = ''
    try {
      const row = this.db.prepare("SELECT value FROM relationship WHERE key='state'").get() as { value: string } | undefined
      if (row) {
        const r = JSON.parse(row.value)
        relationshipInfo = `Relationship stage: ${r.stage}, closeness: ${(r.closeness * 100).toFixed(0)}%, trust: ${(r.trust * 100).toFixed(0)}%, ${r.totalMessages} total messages over ${r.totalDays} days, streak: ${r.currentStreak} days`
      }
    } catch { /* ignore */ }

    const prompt = `You are updating the USER.md file for an AI companion character. This file contains what the character knows about the user.

EXISTING USER FILE:
${existingUser}

RECENT CONVERSATIONS:
${transcript}

RELATIONSHIP DATA:
${relationshipInfo}

Write an updated USER.md with these sections. Keep existing real facts and add new discoveries. Replace placeholders with real info.

FORMAT (use exactly this structure):
## How We Met
(brief origin story — keep existing if it's not a placeholder, otherwise write based on conversation context)

## Our Dynamic
(describe the current relationship vibe based on actual conversations — formal? teasing? flirty? close friends?)

## Things She Knows About You
- (bullet points: timezone, habits, preferences, job, hobbies, personal details ACTUALLY mentioned)
- (include language preference if apparent)

## Recent History
- (key recent interactions, memorable moments, arguments, jokes)

RULES:
- ONLY include facts ACTUALLY mentioned or clearly implied in conversations
- Do NOT invent facts. If unsure, don't include it.
- Replace generic placeholders ("[something personal]", "strong opinions about food") with real data or remove them
- Keep it concise — max 20 bullet points total
- Write from the character's perspective (casual, warm)`

    const newContent = await this.summarizeFn(prompt)
    if (newContent && newContent.length > 50) {
      writeFileSync(userPath, newContent.trim() + '\n', 'utf-8')
      console.log('[Memory] USER.md synced with latest knowledge')
    }
  }
}

// ── Importance scoring (inspired by Zep's high/med/low rating) ────────────

/** Rate memory importance from 0.0 (trivial) to 1.0 (critical personal fact) */
function scoreImportance(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.3 // baseline

  // High importance: personal facts, identity, relationships
  const highPatterns = [
    /my (name|birthday|age|job|work|school|major|hometown|家|学校|工作|生日|名字)/i,
    /i (live|work|study|moved|graduate|毕业|住在|搬到)/i,
    /boyfriend|girlfriend|partner|husband|wife|engaged|married|男朋友|女朋友|老公|老婆/i,
    /family|mother|father|sister|brother|parent|爸|妈|哥|姐|弟|妹|家人/i,
    /allergic|allergy|disease|sick|hospital|过敏|生病|医院/i,
    /died|death|passed away|去世|离开/i,
    /promise|swear|答应|发誓/i,
  ]
  if (highPatterns.some(p => p.test(lower))) score = 0.9

  // Medium-high: preferences, emotions, plans
  const medHighPatterns = [
    /i (love|hate|prefer|enjoy|favorite|最喜欢|讨厌|喜欢)/i,
    /dream|goal|plan|hope|wish|梦想|目标|计划|希望/i,
    /feel|feeling|emotion|sad|happy|angry|scared|afraid|感觉|心情|难过|开心|害怕/i,
    /remember when|do you remember|还记得|你记得/i,
    /anniversary|birthday|holiday|travel|trip|纪念日|旅行|出差/i,
  ]
  if (medHighPatterns.some(p => p.test(lower))) score = Math.max(score, 0.7)

  // Medium: events, activities, opinions
  const medPatterns = [
    /yesterday|tomorrow|last week|next week|昨天|明天|上周|下周/i,
    /bought|purchased|ordered|买了|下单/i,
    /watching|listened|playing|reading|看了|听了|玩了|读了/i,
    /because|reason|原因|因为/i,
    /told|said|mentioned|说过|提到/i,
  ]
  if (medPatterns.some(p => p.test(lower))) score = Math.max(score, 0.5)

  return score
}

// ── Embedding filter ──────────────────────────────────────────────────────

/** Small-talk patterns that don't need to be in long-term memory */
const SMALLTALK_PATTERNS = [
  /^(hi|hey|hello|yo|sup|哈喽|你好|嗨|嗯|ok|okay|好的|行|嗯嗯|哈哈|lol|haha|wow|omg|nice|cool)[\s!?.,]*$/i,
  /^(good morning|good night|晚安|早安|早上好|gm|gn|bye|晚安啦|拜拜)[\s!?.,]*$/i,
  /^(thanks|thank you|谢谢|thx|ty)[\s!?.,]*$/i,
  /^(yes|no|yeah|yep|nah|nope|是|不|对|没)[\s!?.,]*$/i,
]

/**
 * Determine if an exchange contains enough meaningful content
 * to be worth embedding into semantic memory.
 *
 * Filters: greetings, very short messages, pure small talk.
 * Keeps: personal facts, preferences, events, emotional moments, plans.
 */
function isWorthEmbedding(userMessage: string, assistantResponse: string): boolean {
  const userTrimmed = userMessage.trim()

  // Too short to be meaningful
  if (userTrimmed.length < 10) return false

  // Pure small talk
  if (SMALLTALK_PATTERNS.some(p => p.test(userTrimmed))) return false

  // Check for fact-bearing patterns (names, preferences, events, emotions)
  const combined = `${userMessage} ${assistantResponse}`.toLowerCase()
  const factPatterns = [
    /my (name|age|job|work|school|birthday|favorite|hobby|dog|cat|pet|家|学校|工作|生日)/i,
    /i (love|hate|like|prefer|enjoy|miss|remember|forgot|want|need|plan|喜欢|讨厌|想)/i,
    /tomorrow|yesterday|last week|next week|明天|昨天|上周|下周/i,
    /because|reason|why|因为|原因/i,
    /feel|feeling|emotion|mood|sad|happy|angry|lonely|感觉|心情|难过|开心|生气/i,
    /told|said|mentioned|promise|说过|提到|答应/i,
    /birthday|anniversary|holiday|travel|trip|vacation|旅行|假期|出差/i,
  ]

  // If it matches any fact pattern, definitely embed
  if (factPatterns.some(p => p.test(combined))) return true

  // If the user message is reasonably long, it probably has content worth keeping
  if (userTrimmed.length > 40) return true

  return false
}
