/**
 * Markdown Parser for Character Documents
 *
 * Extracts structured data from character AUTONOMY.md, SOUL.md, and
 * IDENTITY.md files at runtime. Replaces hardcoded character configs with
 * dynamic parsing that works for any character doc following the established
 * markdown format.
 *
 * Resilient to formatting variations: handles bold markers (**), dashes/
 * en-dashes, inconsistent casing, multi-line items, and optional whitespace.
 *
 * All returned objects are fresh — no mutation of shared state.
 */

// ── Public Types ─────────────────────────────────────────────────────────────

export interface ActivitySchedule {
  readonly peakHours: readonly number[]
  readonly warmHours: readonly number[]
  readonly quietHours: readonly number[]
  readonly weekendBehavior: string
}

export interface SoulPreferences {
  readonly loves: readonly string[]
  readonly dislikes: readonly string[]
  readonly activities: readonly string[]
}

export interface IdentityInfo {
  readonly hobbies: readonly string[]
  readonly job: string
  readonly languages: readonly string[]
}

export interface ProactiveTrigger {
  readonly category: 'time-based' | 'event-based' | 'emotional' | 'content-sharing'
  readonly name: string
  readonly description: string
  readonly timeWindow: string | null
  readonly exampleMessages: readonly string[]
}

export interface RelationshipStage {
  readonly stage: number
  readonly name: string
  readonly behaviors: readonly string[]
}

// ── Also re-export the older types used by character-activities.ts ────────────

export interface HourRange {
  readonly start: number
  readonly end: number
}

export interface ParsedSoul {
  readonly loves: readonly string[]
  readonly dislikes: readonly string[]
  readonly habits: readonly string[]
  readonly speechPatterns: readonly string[]
}

export interface ParsedIdentity {
  readonly name: string
  readonly age: string
  readonly from: string
  readonly job: string
  readonly languages: readonly string[]
  readonly hobbies: readonly string[]
  readonly gender: string
}

export interface ParsedAutonomy {
  readonly peakHours: HourRange | null
  readonly warmHours: HourRange | null
  readonly quietHours: HourRange | null
  readonly timezone: string
}

// ── 1. Activity Schedule ─────────────────────────────────────────────────────

/**
 * Parse the `## Activity Schedule` section from AUTONOMY.md.
 *
 * Extracts peak/warm/quiet hour ranges and weekend behavior.
 * Hour ranges like "11pm-3am" are expanded into arrays of 24h integers.
 *
 * Example input (from Kaia's AUTONOMY.md):
 *   - **Peak hours:** 11pm-3am (post-schedule freedom ...)
 *   - **Warm hours:** 2pm-5pm (between schedules ...)
 *   - **Quiet hours:** 4am-11am (crashed after late-night ...)
 *   - **Weekend shift:** More active overall ...
 */
export function parseActivitySchedule(autonomyMd: string): ActivitySchedule {
  const section = extractSection(autonomyMd, 'Activity Schedule')

  const peakRange = parseTimeRangeFromLabel(section, 'Peak hours')
  const warmRange = parseTimeRangeFromLabel(section, 'Warm hours')
  const quietRange = parseTimeRangeFromLabel(section, 'Quiet hours')

  return {
    peakHours: expandHourRange(peakRange),
    warmHours: expandHourRange(warmRange),
    quietHours: expandHourRange(quietRange),
    weekendBehavior: parseWeekendBehavior(section),
  }
}

// ── 2. Soul Preferences ──────────────────────────────────────────────────────

/**
 * Parse `## Loves`, `## Dislikes`, and `## Things She Does` from SOUL.md.
 *
 * Handles multiple list formats found across character docs:
 *   - Standard markdown bullets: `- item text`
 *   - Non-bulleted lines (Helora's Loves uses freeform lines)
 *   - Multi-line items where continuations are indented
 */
export function parseSoulPreferences(soulMd: string): SoulPreferences {
  return {
    loves: parseSectionItems(soulMd, 'Loves'),
    dislikes: parseSectionItems(soulMd, 'Dislikes'),
    activities: parseSectionItems(soulMd, /Things (?:She|He|They) (?:Does?|Do)/),
  }
}

// ── 3. Identity / Hobbies ────────────────────────────────────────────────────

/**
 * Parse the frontmatter bullet list from IDENTITY.md.
 *
 * Extracts:
 *   - Hobbies from the `**Hobbies:**` line (comma-separated)
 *   - Job from the `**Job:**` line
 *   - Languages from the `**Languages:**` line (parenthetical notes stripped)
 *
 * Example input (from Luna's IDENTITY.md):
 *   - **Job:** Art school dropout turned underground fashion photographer ...
 *   - **Languages:** Japanese (native), English (fluent ...), Mandarin Chinese (learning ...)
 *   - **Hobbies:** Film photography, mixing ambient music at 3 AM, ...
 */
export function parseIdentityHobbies(identityMd: string): IdentityInfo {
  const hobbiesRaw = parseFrontmatterField(identityMd, 'Hobbies')
  const hobbies = splitCommaSafe(hobbiesRaw)

  const job = parseFrontmatterField(identityMd, 'Job')

  const languagesRaw = parseFrontmatterField(identityMd, 'Languages')
  const languages = splitCommaSafe(languagesRaw).map(lang =>
    lang.replace(/\s*\(.*?\)\s*/g, '').trim(),
  )

  return { hobbies, job, languages: languages.filter(Boolean) }
}

// ── 4. Proactive Triggers ────────────────────────────────────────────────────

/**
 * Parse the `## Proactive Message Triggers` section from AUTONOMY.md.
 *
 * Extracts all trigger sub-sections (### Time-based, ### Event-based,
 * ### Emotional / Relational, ### Content Sharing) with their names,
 * descriptions, optional time windows, and example messages.
 *
 * Example trigger block:
 *   - **Post-practice check-in (6pm-8pm):** Just finished dance practice ...
 *     - [practice room mirror selfie, messy hair, no filter] "4 hours of the same 8 counts"
 *     - "just finished practice. i'm so hungry i could eat my phone"
 */
export function parseProactiveTriggers(autonomyMd: string): readonly ProactiveTrigger[] {
  const section = extractSection(autonomyMd, 'Proactive Message Triggers')
  if (!section) return []

  const triggers: ProactiveTrigger[] = []
  const subSections = splitByH3(section)

  for (const sub of subSections) {
    const category = classifyTriggerCategory(sub.heading)
    const blocks = parseTriggerBlocks(sub.body)

    for (const block of blocks) {
      triggers.push({
        category,
        name: block.name,
        description: block.description,
        timeWindow: block.timeWindow,
        exampleMessages: block.examples,
      })
    }
  }

  return triggers
}

// ── 5. Relationship-Gated Behavior ──────────────────────────────────────────

/**
 * Parse the `## Relationship-Gated Behavior` section from AUTONOMY.md.
 *
 * Extracts per-stage behavior from ### subsections like:
 *   ### Stranger (Stage 0)
 *   ### Acquaintance (Stage 1)
 *   ### Friend (Stage 2)
 *   ### Close Friend (Stage 3)
 *   ### Intimate (Stage 4)
 *
 * Returns stages sorted by stage number (0 through 4).
 */
export function parseRelationshipGatedBehavior(
  autonomyMd: string,
): readonly RelationshipStage[] {
  const section = extractSection(autonomyMd, 'Relationship-Gated Behavior')
  if (!section) return []

  const subSections = splitByH3(section)
  const stages: RelationshipStage[] = []

  for (const sub of subSections) {
    const parsed = parseStageHeading(sub.heading)
    if (parsed.stage < 0) continue

    const behaviors = sub.body
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0)

    stages.push({
      stage: parsed.stage,
      name: parsed.name,
      behaviors,
    })
  }

  return stages.sort((a, b) => a.stage - b.stage)
}

// ── Legacy Parsers (used by character-activities.ts) ─────────────────────────

/** Parse SOUL.md into the older ParsedSoul shape. */
export function parseSoul(soulMd: string): ParsedSoul {
  return {
    loves: parseSectionItems(soulMd, 'Loves'),
    dislikes: parseSectionItems(soulMd, 'Dislikes'),
    habits: parseSectionItems(soulMd, /Things (?:She|He|They) (?:Does?|Do)/),
    speechPatterns: parseSectionItems(soulMd, 'Speech Patterns'),
  }
}

/** Parse IDENTITY.md into the older ParsedIdentity shape. */
export function parseIdentity(identityMd: string): ParsedIdentity {
  const frontmatter = extractFrontmatter(identityMd)
  const body = stripFrontmatter(identityMd)

  return {
    name: extractInlineField(body, 'name') ?? extractHeading(body) ?? '',
    age: extractInlineField(body, 'Age') ?? '',
    from: extractInlineField(body, 'From') ?? '',
    job: extractInlineField(body, 'Job') ?? '',
    languages: splitCommaSafe(extractInlineField(body, 'Languages') ?? ''),
    hobbies: splitCommaSafe(extractInlineField(body, 'Hobbies') ?? ''),
    gender: frontmatter['gender'] ?? '',
  }
}

/** Parse AUTONOMY.md schedule into the older ParsedAutonomy shape. */
export function parseAutonomy(autonomyMd: string): ParsedAutonomy {
  const section = extractSection(autonomyMd, 'Activity Schedule')

  const peakHours = parseTimeRangeFromLabel(section, 'Peak hours')
  const warmHours = parseTimeRangeFromLabel(section, 'Warm hours')
  const quietHours = parseTimeRangeFromLabel(section, 'Quiet hours')

  const tzMatch = autonomyMd.match(/Timezone persona:\s*(\S+)/i)
  const timezone = tzMatch?.[1] ?? ''

  return { peakHours, warmHours, quietHours, timezone }
}

// ── Internal: Section Extraction ─────────────────────────────────────────────

/**
 * Extract a `## Section` body from markdown.
 * Returns text between the matched heading and the next `## ` or EOF.
 */
function extractSection(md: string, heading: string | RegExp): string {
  const headingSource = heading instanceof RegExp
    ? heading.source
    : escapeRegex(heading)

  // Try strict multiline match first
  const strict = new RegExp(
    `^##\\s+${headingSource}\\s*$([\\s\\S]*?)(?=^##\\s|\\z)`,
    'mi',
  )
  const strictMatch = md.match(strict)
  if (strictMatch) return strictMatch[1].trim()

  // Fallback: allow trailing text on the heading line
  const loose = new RegExp(
    `^##\\s+${headingSource}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'mi',
  )
  const looseMatch = md.match(loose)
  return looseMatch ? looseMatch[1].trim() : ''
}

// ── Internal: List Parsing ───────────────────────────────────────────────────

/**
 * Parse a section's content as a list of items.
 *
 * Handles three formats found across character docs:
 *   1. Bullet lists: `- Item description — extra context`
 *   2. Non-bulleted lines (e.g. Helora's Loves has no dash prefix on some lines)
 *   3. Multi-line items where continuation lines are indented by 2+ spaces
 */
function parseSectionItems(md: string, heading: string | RegExp): readonly string[] {
  const section = extractSection(md, heading)
  if (!section) return []

  const lines = section.split('\n')
  const items: string[] = []
  let currentItem = ''

  for (const line of lines) {
    const trimmed = line.trimEnd()
    const stripped = trimmed.trim()

    // Empty line ends the current item
    if (stripped === '') {
      if (currentItem) {
        items.push(cleanInlineMarkdown(currentItem.trim()))
        currentItem = ''
      }
      continue
    }

    // New bullet item
    if (/^[-*]\s+/.test(stripped)) {
      if (currentItem) {
        items.push(cleanInlineMarkdown(currentItem.trim()))
      }
      currentItem = stripped.replace(/^[-*]\s+/, '')
      continue
    }

    // Indented continuation of previous item
    if (currentItem && /^\s{2,}/.test(line)) {
      currentItem += ' ' + stripped
      continue
    }

    // Non-bulleted top-level line (freeform list format)
    if (currentItem) {
      items.push(cleanInlineMarkdown(currentItem.trim()))
    }
    currentItem = stripped
  }

  if (currentItem) {
    items.push(cleanInlineMarkdown(currentItem.trim()))
  }

  return items.filter(Boolean)
}

// ── Internal: Time Parsing ───────────────────────────────────────────────────

/**
 * Parse a time range from a labeled line.
 *
 * Matches patterns like:
 *   **Peak hours:** 11pm-3am (description...)
 *   - **Warm hours:** 2pm–5pm (description...)
 *   Quiet hours: 6am-3pm
 */
function parseTimeRangeFromLabel(
  text: string,
  label: string,
): HourRange | null {
  const pattern = new RegExp(
    `${escapeRegex(label)}[^\\n]*?(\\d{1,2})\\s*(am|pm)\\s*[-–]\\s*(\\d{1,2})\\s*(am|pm)`,
    'i',
  )
  const match = text.match(pattern)
  if (!match) return null

  const start = to24h(parseInt(match[1], 10), match[2].toLowerCase())
  const end = to24h(parseInt(match[3], 10), match[4].toLowerCase())

  return { start, end }
}

/** Convert 12-hour time to 24-hour integer. */
function to24h(hour: number, period: string): number {
  if (period === 'am') return hour === 12 ? 0 : hour
  return hour === 12 ? 12 : hour + 12
}

/**
 * Expand a `{ start, end }` range into an array of hour integers (0-23).
 * Handles wraparound (e.g. start=23, end=3 => [23, 0, 1, 2, 3]).
 */
function expandHourRange(range: HourRange | null): readonly number[] {
  if (!range) return []

  const hours: number[] = []
  let current = range.start
  const limit = 25 // safety cap to prevent infinite loops

  for (let i = 0; i < limit; i++) {
    hours.push(current % 24)
    if (current % 24 === range.end % 24) break
    current++
  }

  return hours
}

/** Extract weekend behavior text from the Activity Schedule section. */
function parseWeekendBehavior(section: string): string {
  const patterns = [
    /\*{0,2}Weekend shift[:\s]*?\*{0,2}\s*(.*)/i,
    /\*{0,2}Weekend[:\s]*?\*{0,2}\s*(.*)/i,
  ]

  for (const pattern of patterns) {
    const match = section.match(pattern)
    if (match) return cleanInlineMarkdown(match[1].trim())
  }

  return ''
}

// ── Internal: Frontmatter Parsing ────────────────────────────────────────────

/** Extract YAML frontmatter key-value pairs from `---` blocks. */
function extractFrontmatter(md: string): Readonly<Record<string, string>> {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}

  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    result[key] = value
  }
  return result
}

/** Strip YAML frontmatter from markdown content. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

/**
 * Parse a value from the IDENTITY.md frontmatter-style bullet list.
 *
 * Matches lines like:
 *   - **Job:** Freelance UX designer + part-time art director
 *   - **Hobbies:** K-dramas, sketching people in coffee shops, ...
 */
function parseFrontmatterField(identityMd: string, fieldName: string): string {
  const escaped = escapeRegex(fieldName)
  const pattern = new RegExp(
    `\\*{0,2}${escaped}[:\\s]*\\*{0,2}\\s*(.+)`,
    'i',
  )
  const match = identityMd.match(pattern)
  return match ? match[1].trim() : ''
}

/** Extract a `- **Field:** value` from markdown body text. */
function extractInlineField(md: string, field: string): string | null {
  const pattern = new RegExp(
    `\\*\\*${escapeRegex(field)}:\\*\\*\\s*(.+)`,
    'i',
  )
  const match = md.match(pattern)
  return match ? match[1].trim() : null
}

/** Extract the first H1 heading (`# Name`) from markdown. */
function extractHeading(md: string): string | null {
  const match = md.match(/^#\s+(.+)/m)
  return match ? match[1].trim() : null
}

/** Split on commas, preserving content inside parentheses/brackets. */
function splitCommaSafe(text: string): readonly string[] {
  if (!text) return []

  const parts: string[] = []
  let current = ''
  let depth = 0

  for (const char of text) {
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) parts.push(trimmed)
      current = ''
      continue
    }
    current += char
  }

  const last = current.trim()
  if (last) parts.push(last)

  return parts
}

// ── Internal: H3 Sub-sections ────────────────────────────────────────────────

interface SubSection {
  readonly heading: string
  readonly body: string
}

/** Split section text by `### ` headings into sub-sections. */
function splitByH3(text: string): readonly SubSection[] {
  const results: SubSection[] = []
  const regex = /^###\s+(.+)$/gm
  const headings: Array<{ heading: string; contentStart: number; lineStart: number }> = []

  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    headings.push({
      heading: m[1].trim(),
      contentStart: m.index + m[0].length,
      lineStart: m.index,
    })
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].contentStart
    const end = i + 1 < headings.length
      ? headings[i + 1].lineStart
      : text.length
    results.push({
      heading: headings[i].heading,
      body: text.slice(start, end).trim(),
    })
  }

  return results
}

// ── Internal: Trigger Block Parsing ──────────────────────────────────────────

interface TriggerBlock {
  readonly name: string
  readonly description: string
  readonly timeWindow: string | null
  readonly examples: readonly string[]
}

/** Classify a ### heading into a trigger category. */
function classifyTriggerCategory(
  heading: string,
): ProactiveTrigger['category'] {
  const lower = heading.toLowerCase()
  if (lower.includes('time')) return 'time-based'
  if (lower.includes('event')) return 'event-based'
  if (lower.includes('emotion') || lower.includes('relational')) return 'emotional'
  if (lower.includes('content') || lower.includes('sharing')) return 'content-sharing'
  return 'event-based'
}

/**
 * Parse individual trigger blocks from a sub-section body.
 *
 * Each block starts with a bold header line:
 *   - **Post-practice check-in (6pm-8pm):** description text
 *     - "example message one"
 *     - [photo context] "example message two"
 */
function parseTriggerBlocks(body: string): readonly TriggerBlock[] {
  const blocks: TriggerBlock[] = []
  const lines = body.split('\n')

  let current: {
    name: string
    description: string
    timeWindow: string | null
    examples: string[]
  } | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Detect a new trigger block header:
    //   - **Name (time):** description
    //   - **Name:** description
    const headerMatch = trimmed.match(/^[-*]\s*\*{2}(.+?)\*{2}[:\s]*(.*)/)
    if (headerMatch) {
      if (current) blocks.push(current)

      const rawName = headerMatch[1].trim()
      const description = headerMatch[2].replace(/^\s*:\s*/, '').trim()

      // Extract optional time window like "(6pm-8pm)" or "(2:30am-3:30am)"
      const twMatch = rawName.match(
        /\((\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))\)/i,
      )
      const timeWindow = twMatch ? twMatch[1].trim() : null
      const name = rawName.replace(/\s*\([^)]*\)\s*/, '').trim()

      current = { name, description, timeWindow, examples: [] }
      continue
    }

    if (!current) continue

    // Example lines come in several flavors:
    //   - "quoted text"
    //   - [bracketed context] "quoted text"
    //   - [bracketed context] no quotes, just description
    //   - "bare quoted line" (no bullet)

    // Bullet with quoted content (with optional bracket prefix)
    const bulletQuotedMatch = trimmed.match(
      /^[-*]\s+(\[.*?\]\s*)?["\u201c](.+?)["\u201d]?\s*$/,
    )
    if (bulletQuotedMatch) {
      const prefix = bulletQuotedMatch[1] ? bulletQuotedMatch[1].trim() + ' ' : ''
      current.examples.push(cleanQuotes(prefix + '"' + bulletQuotedMatch[2] + '"'))
      continue
    }

    // Bullet with bracket-only content (e.g. "[sends a meme] no caption needed")
    const bulletBracketMatch = trimmed.match(/^[-*]\s+(\[.*?\])\s*(.*)$/)
    if (bulletBracketMatch) {
      const bracket = bulletBracketMatch[1].trim()
      const trail = bulletBracketMatch[2].trim()
      current.examples.push(cleanQuotes(trail ? bracket + ' ' + trail : bracket))
      continue
    }

    // Bare quoted line (no bullet prefix)
    if (trimmed.startsWith('"') || trimmed.startsWith('\u201c')) {
      current.examples.push(cleanQuotes(trimmed))
      continue
    }
  }

  if (current) blocks.push(current)

  return blocks
}

// ── Internal: Stage Heading ──────────────────────────────────────────────────

/** Parse a heading like "Stranger (Stage 0)" or "Intimate (Stage 4)". */
function parseStageHeading(heading: string): { name: string; stage: number } {
  // Explicit "(Stage N)" notation
  const explicit = heading.match(/(.+?)\s*\(Stage\s*(\d+)\)/i)
  if (explicit) {
    return { name: explicit[1].trim(), stage: parseInt(explicit[2], 10) }
  }

  // Fallback: infer stage from well-known names
  const knownStages: ReadonlyArray<readonly [RegExp, number]> = [
    [/stranger/i, 0],
    [/acquaintance/i, 1],
    [/\bfriend\b(?!\s)/i, 2],
    [/close\s+friend/i, 3],
    [/intimate/i, 4],
  ] as const

  const lower = heading.toLowerCase().trim()
  // Check close friend before friend (more specific first)
  if (/close\s+friend/i.test(lower)) return { name: heading.trim(), stage: 3 }
  for (const [pattern, stage] of knownStages) {
    if (pattern.test(lower)) return { name: heading.trim(), stage }
  }

  return { name: heading.trim(), stage: -1 }
}

// ── Internal: Text Utilities ─────────────────────────────────────────────────

/** Strip bold/italic markers from inline markdown text. */
function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\*{1,2}(.*?)\*{1,2}/g, '$1')
    .replace(/^\s*[-–—]\s*/, '')
    .trim()
}

/** Normalize curly/smart quotes to straight ASCII quotes. */
function cleanQuotes(text: string): string {
  return text
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}

/** Escape special regex characters in a literal string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
