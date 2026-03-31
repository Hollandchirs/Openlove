/**
 * Character Generator
 *
 * Produces all 5 character MD files (IDENTITY, SOUL, AUTONOMY, USER, MEMORY)
 * from minimal user input via LLM calls.
 *
 * Provider-agnostic: accepts an `llmFn` callback so it works with any backend.
 */

import {
  buildIdentityPrompt,
  buildSoulPrompt,
  buildAutonomyPrompt,
  buildUserPrompt,
  buildMemoryPrompt,
} from './prompts.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface GeneratorInput {
  readonly name: string
  readonly gender: 'female' | 'male' | 'nonbinary'
  readonly briefDescription?: string
  readonly personalityKeywords?: string[]
  readonly timezone?: string
  readonly language?: string
}

export interface GeneratedCharacter {
  readonly name: string
  readonly identity: string   // IDENTITY.md content
  readonly soul: string       // SOUL.md content
  readonly autonomy: string   // AUTONOMY.md content
  readonly user: string       // USER.md content
  readonly memory: string     // MEMORY.md content
}

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

/** Provider-agnostic LLM function: (systemPrompt, userPrompt) => generated text */
export type LLMFunction = (system: string, user: string) => Promise<string>

// ── Validation rules ──────────────────────────────────────────────────────────

interface SectionRule {
  readonly file: string
  readonly heading: string
  /** Regex pattern the section body must match (optional) */
  readonly bodyPattern?: RegExp
}

const IDENTITY_RULES: readonly SectionRule[] = [
  { file: 'IDENTITY', heading: '## Appearance' },
  { file: 'IDENTITY', heading: '## Background' },
]

const SOUL_RULES: readonly SectionRule[] = [
  { file: 'SOUL', heading: '## Voice & Vibe' },
  { file: 'SOUL', heading: '## Loves' },
  { file: 'SOUL', heading: '## Dislikes' },
  { file: 'SOUL', heading: '## Emotional Patterns' },
  { file: 'SOUL', heading: '## Speech Patterns' },
  // "## Things <Name> Does" is validated separately below since the heading is dynamic
]

const AUTONOMY_RULES: readonly SectionRule[] = [
  { file: 'AUTONOMY', heading: '## Activity Schedule' },
  { file: 'AUTONOMY', heading: '## Proactive Message Triggers' },
  { file: 'AUTONOMY', heading: '### Time-based' },
  { file: 'AUTONOMY', heading: '### Event-based' },
  { file: 'AUTONOMY', heading: '### Emotional / Relational' },
  { file: 'AUTONOMY', heading: '## Relationship-Gated Behavior' },
  { file: 'AUTONOMY', heading: '### Stranger (Stage 0)' },
  { file: 'AUTONOMY', heading: '### Acquaintance (Stage 1)' },
  { file: 'AUTONOMY', heading: '### Friend (Stage 2)' },
  { file: 'AUTONOMY', heading: '### Close Friend (Stage 3)' },
  { file: 'AUTONOMY', heading: '### Intimate (Stage 4)' },
  { file: 'AUTONOMY', heading: '## Silence Behavior' },
]

const USER_RULES: readonly SectionRule[] = [
  { file: 'USER', heading: '## How We Met' },
  { file: 'USER', heading: '## Our Dynamic' },
]

const MEMORY_RULES: readonly SectionRule[] = [
  { file: 'MEMORY', heading: '## Conversation Highlights' },
]

// ── Bullet-count validation ───────────────────────────────────────────────────

interface BulletCountRule {
  readonly file: string
  readonly section: string
  readonly min: number
  readonly label: string
}

const BULLET_COUNTS: readonly BulletCountRule[] = [
  { file: 'SOUL', section: '## Loves', min: 5, label: 'Loves items' },
  { file: 'SOUL', section: '## Dislikes', min: 5, label: 'Dislikes items' },
  { file: 'SOUL', section: '## Emotional Patterns', min: 5, label: 'Emotional patterns' },
  { file: 'SOUL', section: '## Speech Patterns', min: 5, label: 'Speech patterns' },
  { file: 'AUTONOMY', section: '### Time-based', min: 3, label: 'Time-based triggers' },
  { file: 'AUTONOMY', section: '### Event-based', min: 3, label: 'Event-based triggers' },
  { file: 'AUTONOMY', section: '### Emotional / Relational', min: 3, label: 'Emotional/relational triggers' },
]

// ── Generic anti-pattern checks ───────────────────────────────────────────────

const GENERIC_TERMS = [
  /\blikes music\b/i,
  /\blikes movies\b/i,
  /\blikes reading\b/i,
  /\blikes cooking\b/i,
  /\blikes traveling\b/i,
  /\blikes photography\b/i,
  /\bkind and caring\b/i,
  /\bfun-loving\b/i,
  /\beasy-going\b/i,
  /\bfriendly and outgoing\b/i,
  /\bloving family\b/i,
  /\blikes hanging out with friends\b/i,
]

// ── Helper: extract section body between headings ─────────────────────────────

function extractSection(md: string, heading: string): string | undefined {
  const headingLevel = heading.match(/^(#+)/)?.[1]?.length ?? 2
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `${escapedHeading}[\\t ]*\\n([\\s\\S]*?)(?=\\n#{1,${headingLevel}} |$)`,
    'm'
  )
  const match = md.match(pattern)
  return match?.[1]?.trim()
}

function countBullets(text: string): number {
  const lines = text.split('\n')
  return lines.filter(line => /^\s*-\s/.test(line)).length
}

// ── CharacterGenerator ──────────────────────────────────────────────────────

export class CharacterGenerator {
  private readonly llmFn: LLMFunction

  constructor(llmFn: LLMFunction) {
    this.llmFn = llmFn
  }

  /**
   * Generate all 5 character MD files from minimal input.
   *
   * Call chain:
   *   1. IDENTITY.md (standalone)
   *   2. SOUL.md (depends on IDENTITY)
   *   3. AUTONOMY.md (depends on IDENTITY + SOUL)
   *   4. USER.md + MEMORY.md (in parallel, depend on IDENTITY + SOUL)
   */
  async generate(input: GeneratorInput): Promise<GeneratedCharacter> {
    validateInput(input)

    // Step 1: Generate IDENTITY.md
    const identityPrompt = buildIdentityPrompt({
      name: input.name,
      gender: input.gender,
      briefDescription: input.briefDescription,
      personalityKeywords: input.personalityKeywords,
      timezone: input.timezone,
      language: input.language,
    })
    const identity = await this.llmFn(identityPrompt.system, identityPrompt.user)

    // Step 2: Generate SOUL.md (needs IDENTITY)
    const soulPrompt = buildSoulPrompt({
      name: input.name,
      gender: input.gender,
      identityMd: identity,
      personalityKeywords: input.personalityKeywords,
    })
    const soul = await this.llmFn(soulPrompt.system, soulPrompt.user)

    // Step 3: Generate AUTONOMY.md (needs IDENTITY + SOUL)
    const autonomyPrompt = buildAutonomyPrompt({
      name: input.name,
      gender: input.gender,
      identityMd: identity,
      soulMd: soul,
      timezone: input.timezone,
    })
    const autonomy = await this.llmFn(autonomyPrompt.system, autonomyPrompt.user)

    // Step 4: Generate USER.md and MEMORY.md in parallel (both need IDENTITY + SOUL)
    const userPrompt = buildUserPrompt({
      name: input.name,
      gender: input.gender,
    })
    const memoryPrompt = buildMemoryPrompt({
      name: input.name,
      gender: input.gender,
      identityMd: identity,
      soulMd: soul,
    })

    const [userMd, memory] = await Promise.all([
      this.llmFn(userPrompt.system, userPrompt.user),
      this.llmFn(memoryPrompt.system, memoryPrompt.user),
    ])

    return Object.freeze({
      name: input.name,
      identity,
      soul,
      autonomy,
      user: userMd,
      memory,
    })
  }

  /**
   * Validate a generated character's markdown for required sections,
   * bullet-count minimums, and anti-pattern violations.
   */
  validate(character: GeneratedCharacter): ValidationResult {
    const errors: string[] = []

    const fileMap: Record<string, string> = {
      IDENTITY: character.identity,
      SOUL: character.soul,
      AUTONOMY: character.autonomy,
      USER: character.user,
      MEMORY: character.memory,
    }

    // Check required sections exist
    const allRules: readonly SectionRule[] = [
      ...IDENTITY_RULES,
      ...SOUL_RULES,
      ...AUTONOMY_RULES,
      ...USER_RULES,
      ...MEMORY_RULES,
    ]
    for (const rule of allRules) {
      const content = fileMap[rule.file]
      if (!content) {
        errors.push(`${rule.file}.md: file content is empty`)
        continue
      }
      if (!content.includes(rule.heading)) {
        errors.push(`${rule.file}.md: missing required section "${rule.heading}"`)
      }
      if (rule.bodyPattern) {
        const section = extractSection(content, rule.heading)
        if (section && !rule.bodyPattern.test(section)) {
          errors.push(`${rule.file}.md: section "${rule.heading}" body does not match expected pattern`)
        }
      }
    }

    // Check SOUL.md has a "Things <Name> Does" section (dynamic heading)
    if (character.soul) {
      const thingsDoesPattern = /## Things .+ Does/
      if (!thingsDoesPattern.test(character.soul)) {
        errors.push(`SOUL.md: missing required section "## Things ${character.name} Does"`)
      }
    }

    // Check IDENTITY frontmatter
    if (!character.identity.startsWith('---')) {
      errors.push('IDENTITY.md: missing YAML frontmatter (must start with ---)')
    } else {
      const frontmatter = extractFrontmatter(character.identity)
      if (!frontmatter.includes('gender:')) {
        errors.push('IDENTITY.md: frontmatter missing "gender" field')
      }
      if (!frontmatter.includes('language:')) {
        errors.push('IDENTITY.md: frontmatter missing "language" field')
      }
      if (!frontmatter.includes('timezone:')) {
        errors.push('IDENTITY.md: frontmatter missing "timezone" field')
      }
    }

    // Check IDENTITY has character name as H1
    if (!character.identity.includes(`# ${character.name}`)) {
      errors.push(`IDENTITY.md: missing H1 heading with character name "${character.name}"`)
    }

    // Check IDENTITY bio fields
    const requiredBioFields = ['**Age:**', '**From:**', '**Job:**', '**Languages:**', '**Hobbies:**']
    for (const field of requiredBioFields) {
      if (!character.identity.includes(field)) {
        errors.push(`IDENTITY.md: missing bio field "${field}"`)
      }
    }

    // Check bullet counts in sections
    for (const rule of BULLET_COUNTS) {
      const content = fileMap[rule.file]
      if (!content) continue
      const section = extractSection(content, rule.section)
      if (!section) continue
      const count = countBullets(section)
      if (count < rule.min) {
        errors.push(
          `${rule.file}.md: "${rule.label}" has ${count} bullet(s), minimum is ${rule.min}`
        )
      }
    }

    // Check all 5 relationship stages in AUTONOMY
    const relationshipStages = [
      'Stranger (Stage 0)',
      'Acquaintance (Stage 1)',
      'Friend (Stage 2)',
      'Close Friend (Stage 3)',
      'Intimate (Stage 4)',
    ]
    for (const stage of relationshipStages) {
      if (!character.autonomy.includes(stage)) {
        errors.push(`AUTONOMY.md: missing relationship stage "${stage}"`)
      }
    }

    // Check silence behavior escalation
    const silenceMarkers = ['After 6h', 'After 24h', 'After 48h', 'After 72h']
    for (const marker of silenceMarkers) {
      if (!character.autonomy.includes(marker)) {
        errors.push(`AUTONOMY.md: silence behavior missing "${marker}" escalation`)
      }
    }

    // Anti-pattern: detect generic terms
    const allContent = Object.values(fileMap).join('\n')
    for (const pattern of GENERIC_TERMS) {
      const match = allContent.match(pattern)
      if (match) {
        errors.push(`Anti-pattern violation: found generic term "${match[0]}" — be more specific`)
      }
    }

    // Anti-pattern: check SOUL loves have texture (each bullet > 20 chars)
    const lovesSection = extractSection(character.soul, '## Loves')
    if (lovesSection) {
      const loveLines = lovesSection.split('\n').filter(l => /^\s*-\s/.test(l))
      const shortLoves = loveLines.filter(l => l.replace(/^\s*-\s*/, '').length < 20)
      if (shortLoves.length > 0) {
        errors.push(
          `SOUL.md: ${shortLoves.length} love(s) lack texture (< 20 chars) — add detail about WHY they love it`
        )
      }
    }

    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze([...errors]),
    })
  }

  /**
   * Generate and validate in one call. Throws if validation fails.
   */
  async generateAndValidate(input: GeneratorInput): Promise<GeneratedCharacter> {
    const character = await this.generate(input)
    const result = this.validate(character)

    if (!result.valid) {
      const errorSummary = result.errors.map(e => `  - ${e}`).join('\n')
      throw new GeneratorValidationError(
        `Generated character "${character.name}" failed validation:\n${errorSummary}`,
        result.errors,
        character
      )
    }

    return character
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateInput(input: GeneratorInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new GeneratorInputError('name is required and must be non-empty')
  }

  if (input.name.trim().length > 50) {
    throw new GeneratorInputError('name must be 50 characters or fewer')
  }

  const validGenders = ['female', 'male', 'nonbinary'] as const
  if (!validGenders.includes(input.gender)) {
    throw new GeneratorInputError(`gender must be one of: ${validGenders.join(', ')}`)
  }

  if (input.briefDescription && input.briefDescription.length > 500) {
    throw new GeneratorInputError('briefDescription must be 500 characters or fewer')
  }

  if (input.personalityKeywords && input.personalityKeywords.length > 10) {
    throw new GeneratorInputError('personalityKeywords must have 10 items or fewer')
  }

  if (input.timezone && !/^[A-Za-z_]+\/[A-Za-z_]+/.test(input.timezone)) {
    throw new GeneratorInputError('timezone must be a valid IANA timezone (e.g., "America/New_York")')
  }

  if (input.language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(input.language)) {
    throw new GeneratorInputError('language must be a valid ISO 639-1 code (e.g., "en", "zh-CN")')
  }
}

// ── Frontmatter extraction ────────────────────────────────────────────────────

function extractFrontmatter(md: string): string {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  return match?.[1] ?? ''
}

// ── Custom errors ─────────────────────────────────────────────────────────────

export class GeneratorInputError extends Error {
  constructor(message: string) {
    super(`[CharacterGenerator] Invalid input: ${message}`)
    this.name = 'GeneratorInputError'
  }
}

export class GeneratorValidationError extends Error {
  readonly errors: readonly string[]
  readonly character: GeneratedCharacter

  constructor(message: string, errors: readonly string[], character: GeneratedCharacter) {
    super(message)
    this.name = 'GeneratorValidationError'
    this.errors = errors
    this.character = character
  }
}
