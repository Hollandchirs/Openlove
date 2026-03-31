/**
 * Character-Specific Activity Configuration
 *
 * Dynamically builds activity configs from a character's MD documents
 * (AUTONOMY.md, SOUL.md, IDENTITY.md). NO hardcoded character names or
 * switch statements -- every character gets a fully personalized config
 * derived entirely from their docs.
 *
 * Interest-to-site mapping, genre inference, and routine generation are
 * all driven by keyword matching against the parsed MD content.
 */

import type { RoutineSlot } from './activities.js'
import {
  parseSoul,
  parseIdentity,
  parseAutonomy,
  type HourRange,
  type ParsedSoul,
  type ParsedIdentity,
  type ParsedAutonomy,
} from './md-parser.js'

// ── Public types ────────────────────────────────────────────────────────

export interface CharacterActivityConfig {
  /** Character-specific daily routine (replaces DEFAULT_DAILY_ROUTINE) */
  readonly routine: RoutineSlot[]
  /** YouTube topics the character would actually search for */
  readonly youtubeTopics: string[]
  /** Websites the character would browse */
  readonly browseSites: ReadonlyArray<{ url: string; site: string }>
  /** Music artists/genres from the character's personality */
  readonly musicSeedArtists: string[]
  readonly musicSeedGenres: string[]
  /** Curated tracks that match the character's taste */
  readonly curatedTracks: ReadonlyArray<{ track: string; artist: string; emotion: 'happy' | 'melancholic' | 'energetic' | 'chill' | 'romantic' }>
  /** Show preferences for drama engine */
  readonly dramaPreferredGenres: string[]
  /** Curated shows that match the character's taste */
  readonly curatedShows: ReadonlyArray<{ showName: string; season: number; episode: number; episodeTitle?: string; summary?: string }>
}

/** Input docs passed to the config builder */
export interface CharacterDocs {
  readonly autonomyMd: string
  readonly soulMd: string
  readonly identityMd: string
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Build character-specific activity config entirely from MD docs.
 *
 * Parses AUTONOMY.md schedule, SOUL.md loves/interests, and IDENTITY.md
 * hobbies to create a unique behavioral profile. No character-name
 * switch statements -- a new character with well-written docs gets a
 * fully personalized config automatically.
 */
export function buildCharacterActivityConfig(
  docs: CharacterDocs,
): CharacterActivityConfig {
  const soul = parseSoul(docs.soulMd)
  const identity = parseIdentity(docs.identityMd)
  const autonomy = parseAutonomy(docs.autonomyMd)

  // Merge all interest sources into a single flat list for matching
  const allInterests = [
    ...soul.loves,
    ...identity.hobbies,
    ...soul.habits,
  ]

  const routine = buildRoutine(autonomy, allInterests, soul)
  const youtubeTopics = inferYoutubeTopics(allInterests, soul)
  const browseSites = inferBrowseSites(allInterests)
  const { artists, genres } = inferMusic(allInterests, soul)
  const dramaPreferredGenres = inferDramaGenres(allInterests, soul)

  return {
    routine,
    youtubeTopics,
    browseSites,
    musicSeedArtists: artists,
    musicSeedGenres: genres,
    curatedTracks: [],  // Curated tracks require human curation; left empty for dynamic discovery
    dramaPreferredGenres,
    curatedShows: [],   // Curated shows require human curation; left empty for dynamic discovery
  }
}

// ── Interest-to-site catalog ────────────────────────────────────────────

interface SiteCatalogEntry {
  readonly keywords: RegExp
  readonly sites: ReadonlyArray<{ url: string; site: string }>
}

/**
 * Maps interest keywords to relevant websites.
 * When a character's interests match a keyword pattern, the associated
 * sites are included in their browseSites config.
 */
const SITE_CATALOG: readonly SiteCatalogEntry[] = [
  {
    keywords: /photo|camera|film\s*photography|analog|darkroom|lomograph/i,
    sites: [
      { url: 'https://www.flickr.com/explore', site: 'Flickr' },
      { url: 'https://www.lomography.com', site: 'Lomography' },
      { url: 'https://www.reddit.com/r/analog', site: 'Reddit - Analog Photography' },
      { url: 'https://www.reddit.com/r/streetphotography', site: 'Reddit - Street Photography' },
    ],
  },
  {
    keywords: /k-?drama|korean\s*drama|kdrama|korean\s*show/i,
    sites: [
      { url: 'https://www.mydramalist.com', site: 'MyDramaList' },
    ],
  },
  {
    keywords: /gaming|league\s*of\s*legends|ranked|LOL|esports|gamer/i,
    sites: [
      { url: 'https://www.op.gg', site: 'OP.GG' },
      { url: 'https://www.twitch.tv/directory/game/League%20of%20Legends', site: 'Twitch - League' },
      { url: 'https://www.reddit.com/r/leagueoflegends', site: 'Reddit - League' },
      { url: 'https://www.youtube.com/gaming', site: 'YouTube Gaming' },
    ],
  },
  {
    keywords: /design|UX|UI|figma|graphic|visual\s*design/i,
    sites: [
      { url: 'https://dribbble.com', site: 'Dribbble' },
      { url: 'https://www.behance.net', site: 'Behance' },
      { url: 'https://www.figma.com/community', site: 'Figma Community' },
    ],
  },
  {
    keywords: /fashion|thrift|vintage|style|outfit/i,
    sites: [
      { url: 'https://www.etsy.com', site: 'Etsy' },
      { url: 'https://www.pinterest.com', site: 'Pinterest' },
    ],
  },
  {
    keywords: /mood\s*board|aesthetic|visual\s*inspir|collage|pinterest/i,
    sites: [
      { url: 'https://www.pinterest.com', site: 'Pinterest' },
    ],
  },
  {
    keywords: /film|cinema|movie|director|art\s*house|letterboxd/i,
    sites: [
      { url: 'https://letterboxd.com', site: 'Letterboxd' },
    ],
  },
  {
    keywords: /music\s*produc|mixing|ambient|bandcamp|shoegaze|lo-?fi/i,
    sites: [
      { url: 'https://bandcamp.com', site: 'Bandcamp' },
    ],
  },
  {
    keywords: /anime|manga|webtoon|otaku/i,
    sites: [
      { url: 'https://myanimelist.net', site: 'MyAnimeList' },
      { url: 'https://www.crunchyroll.com', site: 'Crunchyroll' },
    ],
  },
  {
    keywords: /cook|recipe|food|baking|ramen|culinary/i,
    sites: [
      { url: 'https://www.reddit.com/r/cooking', site: 'Reddit - Cooking' },
    ],
  },
  {
    keywords: /k-?pop|idol|choreography|dance\s*practice/i,
    sites: [
      { url: 'https://www.bilibili.com', site: 'Bilibili' },
    ],
  },
  {
    keywords: /urban\s*explor|abandoned|rooftop|night\s*walk/i,
    sites: [
      { url: 'https://www.reddit.com/r/urbanexploration', site: 'Reddit - Urban Exploration' },
    ],
  },
  {
    keywords: /tattoo|ink|body\s*art/i,
    sites: [
      { url: 'https://www.instagram.com/explore/tags/tattoo', site: 'Instagram - Tattoo' },
    ],
  },
  {
    keywords: /perfume|fragrance|scent/i,
    sites: [
      { url: 'https://www.fragrantica.com', site: 'Fragrantica' },
    ],
  },
  {
    keywords: /sketch|draw|illustrat|art/i,
    sites: [
      { url: 'https://www.deviantart.com', site: 'DeviantArt' },
    ],
  },
  {
    keywords: /travel|explore|wander|backpack/i,
    sites: [
      { url: 'https://www.reddit.com/r/travel', site: 'Reddit - Travel' },
    ],
  },
  {
    keywords: /cat|kitten|stray\s*cat/i,
    sites: [
      { url: 'https://www.reddit.com/r/cats', site: 'Reddit - Cats' },
    ],
  },
]

/** Baseline sites every character gets */
const BASELINE_SITES: ReadonlyArray<{ url: string; site: string }> = [
  { url: 'https://twitter.com/explore', site: 'Twitter' },
  { url: 'https://www.instagram.com/explore', site: 'Instagram' },
]

// ── Interest-to-music catalog ───────────────────────────────────────────

interface MusicMapping {
  readonly keywords: RegExp
  readonly artists: readonly string[]
  readonly genres: readonly string[]
}

const MUSIC_CATALOG: readonly MusicMapping[] = [
  {
    keywords: /k-?pop|idol|K-pop|korean\s*pop|choreograph/i,
    artists: ['BLACKPINK', 'aespa', 'IVE', 'NewJeans', 'LE SSERAFIM', 'Stray Kids'],
    genres: ['k-pop'],
  },
  {
    keywords: /lo-?fi|lofi|chill\s*beat|study\s*beat/i,
    artists: ['Nujabes', 'Jinsang'],
    genres: ['lo-fi'],
  },
  {
    keywords: /ambient|shoegaze|dream\s*pop/i,
    artists: ['Slowdive', 'My Bloody Valentine', 'Cocteau Twins', 'Brian Eno', 'Grouper', 'Sigur Ros'],
    genres: ['ambient', 'shoegaze'],
  },
  {
    keywords: /indie\s*pop|indie\s*rock|alternative/i,
    artists: ['beabadoobee', 'Maisie Peters', 'girl in red', 'Novo Amor'],
    genres: ['indie-pop'],
  },
  {
    keywords: /hip-?hop|rap|trap/i,
    artists: ['Epik High', 'DEAN', 'ZICO'],
    genres: ['hip-hop'],
  },
  {
    keywords: /french|paris|café|cafe/i,
    artists: ['Edith Piaf'],
    genres: ['chanson'],
  },
  {
    keywords: /electronic|synth|EDM|techno/i,
    artists: ['Petit Biscuit', 'ODESZA'],
    genres: ['electronic'],
  },
  {
    keywords: /jazz|swing|blues/i,
    artists: ['Chet Baker', 'Miles Davis'],
    genres: ['jazz'],
  },
  {
    keywords: /classical|orchestra|piano/i,
    artists: ['Ryuichi Sakamoto', 'Debussy'],
    genres: ['classical'],
  },
  {
    keywords: /IU|아이유/i,
    artists: ['IU'],
    genres: ['k-pop'],
  },
  {
    keywords: /Nujabes|samurai\s*champloo/i,
    artists: ['Nujabes'],
    genres: ['lo-fi', 'hip-hop'],
  },
  {
    keywords: /rock|punk|grunge|metal/i,
    artists: [],
    genres: ['rock'],
  },
  {
    keywords: /R&B|soul|neo\s*soul/i,
    artists: ['Frank Ocean', 'SZA'],
    genres: ['r&b'],
  },
]

// ── Interest-to-drama genre catalog ─────────────────────────────────────

interface DramaMapping {
  readonly keywords: RegExp
  readonly genres: readonly string[]
}

const DRAMA_CATALOG: readonly DramaMapping[] = [
  { keywords: /k-?drama|korean\s*drama|romance|love/i, genres: ['romance', 'slice-of-life'] },
  { keywords: /fantasy|magic|supernatural|goblin/i, genres: ['fantasy-romance'] },
  { keywords: /anime|manga|webtoon/i, genres: ['anime'] },
  { keywords: /art\s*house|experimental|film|cinema|director/i, genres: ['art-house'] },
  { keywords: /psycholog|thriller|suspense|mystery|crime|detective/i, genres: ['psychological', 'thriller'] },
  { keywords: /action|fight|combat|martial/i, genres: ['action'] },
  { keywords: /cyberpunk|sci-?fi|neon|futuris/i, genres: ['cyberpunk', 'sci-fi'] },
  { keywords: /horror|dark|creep|scary/i, genres: ['horror'] },
  { keywords: /comedy|funny|humor|sitcom/i, genres: ['comedy'] },
  { keywords: /document|true\s*crime|real|non-?fiction/i, genres: ['documentary'] },
  { keywords: /slice.of.life|cozy|comfort|wholesome|healing/i, genres: ['slice-of-life'] },
]

// ── Interest-to-activity type catalog ───────────────────────────────────

interface ActivityTypeMapping {
  readonly keywords: RegExp
  readonly type: string
  readonly labelTemplate: string // {interest} is replaced with matched term
}

const ACTIVITY_TYPE_CATALOG: readonly ActivityTypeMapping[] = [
  { keywords: /gaming|league|ranked|LOL|esports|gamer|video\s*game/i, type: 'gaming', labelTemplate: 'playing games' },
  { keywords: /music|playlist|song|mixing|lo-?fi|ambient|shoegaze|k-?pop/i, type: 'music', labelTemplate: 'listening to music' },
  { keywords: /drama|anime|show|film|movie|series|cinema|K-drama/i, type: 'drama', labelTemplate: 'watching something' },
  { keywords: /photo|camera|shoot|film\s*photography/i, type: 'browse', labelTemplate: 'editing photos' },
  { keywords: /design|sketch|draw|illustrat|mood\s*board|figma/i, type: 'browse', labelTemplate: 'working on designs' },
  { keywords: /browse|scroll|pinterest|reddit|twitter|social/i, type: 'browse', labelTemplate: 'browsing the web' },
  { keywords: /youtube|video|tutorial|vlog/i, type: 'youtube', labelTemplate: 'watching videos' },
  { keywords: /cook|recipe|food|baking|ramen/i, type: 'browse', labelTemplate: 'looking up recipes' },
  { keywords: /read|book|novel|manga|webtoon/i, type: 'browse', labelTemplate: 'reading' },
  { keywords: /thrift|shop|fashion|vintage/i, type: 'browse', labelTemplate: 'shopping online' },
]

// ── Routine builder ─────────────────────────────────────────────────────

/**
 * Build a full 24-hour routine from parsed schedule + interests.
 * Uses quiet hours for sleep, peak hours for high-activity, and
 * warm hours for moderate activity. Fills gaps with transitional slots.
 */
function buildRoutine(
  autonomy: ParsedAutonomy,
  allInterests: readonly string[],
  soul: ParsedSoul,
): RoutineSlot[] {
  const { quietHours, peakHours, warmHours } = autonomy

  // If we have no schedule data at all, return empty (caller uses DEFAULT_DAILY_ROUTINE)
  if (!quietHours && !peakHours && !warmHours) return []

  // Determine detected activity types from interests
  const detectedActivities = inferActivityTypes(allInterests)

  // Build personality-driven idle labels
  const personalityIdleLabels = buildIdleLabels(soul, allInterests)

  const slots: RoutineSlot[] = []

  // Sleep slot (quiet hours)
  if (quietHours) {
    const sleepLabels = buildSleepLabels(soul)
    if (quietHours.start < quietHours.end) {
      // Simple range: e.g. 1am-9am
      slots.push({
        startHour: quietHours.start,
        endHour: quietHours.end,
        activities: [],
        idleLabels: sleepLabels,
      })
    } else {
      // Wrapping range: e.g. 4am-11am means sleep 4-11 OR e.g. 23-6 means 23-24 + 0-6
      // For most characters quiet hours are "late night to morning" like 4am-11am (start < end)
      // or wrapping like 1am-9am. Handle both.
      slots.push({
        startHour: quietHours.start,
        endHour: quietHours.end,
        activities: [],
        idleLabels: sleepLabels,
      })
    }
  }

  // Peak hours: highest activity density
  if (peakHours) {
    const peakActivities = detectedActivities.map((a, idx) => ({
      type: a.type,
      weight: 5 - Math.min(idx, 3),
      label: a.label,
    }))

    if (peakHours.start < peakHours.end) {
      slots.push({
        startHour: peakHours.start,
        endHour: peakHours.end,
        activities: peakActivities.slice(0, 5),
        idleLabels: personalityIdleLabels.peak,
      })
    } else {
      // Wrapping: e.g. 23-3 -> two slots: 23-24 and 0-3
      slots.push({
        startHour: peakHours.start,
        endHour: 24,
        activities: peakActivities.slice(0, 5),
        idleLabels: personalityIdleLabels.peak,
      })
      slots.push({
        startHour: 0,
        endHour: peakHours.end,
        activities: peakActivities.slice(0, 4),
        idleLabels: personalityIdleLabels.lateNight,
      })
    }
  }

  // Warm hours: moderate activity
  if (warmHours) {
    const warmActivities = detectedActivities
      .slice(0, 3)
      .map((a, idx) => ({
        type: a.type,
        weight: 3 - Math.min(idx, 2),
        label: a.label,
      }))

    slots.push({
      startHour: warmHours.start,
      endHour: warmHours.end,
      activities: warmActivities,
      idleLabels: personalityIdleLabels.warm,
    })
  }

  // Fill uncovered hours with transition slots
  const covered = buildCoverageMap(slots)
  const uncovered = findUncoveredRanges(covered)

  for (const range of uncovered) {
    const transitionActivities = detectedActivities
      .slice(0, 2)
      .map((a, idx) => ({
        type: a.type,
        weight: 2 - Math.min(idx, 1),
        label: a.label,
      }))

    slots.push({
      startHour: range.start,
      endHour: range.end,
      activities: transitionActivities,
      idleLabels: personalityIdleLabels.transition,
    })
  }

  // Sort by startHour for clarity
  return [...slots].sort((a, b) => a.startHour - b.startHour)
}

// ── Inference functions ─────────────────────────────────────────────────

/** Infer activity types from the combined interest list */
function inferActivityTypes(allInterests: readonly string[]): ReadonlyArray<{ type: string; label: string }> {
  const joined = allInterests.join(' | ')
  const seen = new Set<string>()
  const result: Array<{ type: string; label: string }> = []

  for (const mapping of ACTIVITY_TYPE_CATALOG) {
    if (mapping.keywords.test(joined) && !seen.has(mapping.type + mapping.labelTemplate)) {
      seen.add(mapping.type + mapping.labelTemplate)
      result.push({ type: mapping.type, label: mapping.labelTemplate })
    }
  }

  // Always ensure at least music + browse
  if (!result.some(r => r.type === 'music')) {
    result.push({ type: 'music', label: 'listening to music' })
  }
  if (!result.some(r => r.type === 'browse')) {
    result.push({ type: 'browse', label: 'browsing the web' })
  }

  return result
}

/** Infer YouTube search topics from interests and loves */
function inferYoutubeTopics(allInterests: readonly string[], soul: ParsedSoul): string[] {
  const topics: string[] = []

  // Direct interest-derived topics (truncate to reasonable YouTube search length)
  for (const interest of allInterests) {
    const cleaned = interest
      .replace(/\s*—\s*.+$/, '')   // Remove explanatory dash suffix
      .replace(/\(.+?\)/g, '')      // Remove parenthetical
      .trim()
    if (cleaned.length > 3 && cleaned.length < 60) {
      topics.push(cleaned)
    }
  }

  // Add "tutorial", "compilation", "vlog" variations for top interests
  const topInterests = allInterests.slice(0, 5)
  for (const interest of topInterests) {
    const core = interest.replace(/\s*—\s*.+$/, '').replace(/\(.+?\)/g, '').trim()
    if (core.length > 3 && core.length < 40) {
      topics.push(`${core} tutorial`)
      topics.push(`${core} compilation`)
    }
  }

  // Deduplicate and limit
  return [...new Set(topics)].slice(0, 16)
}

/** Infer browse sites from the interest-to-site catalog */
function inferBrowseSites(allInterests: readonly string[]): Array<{ url: string; site: string }> {
  const joined = allInterests.join(' | ')
  const seenUrls = new Set<string>()
  const result: Array<{ url: string; site: string }> = []

  // Add baseline sites first
  for (const site of BASELINE_SITES) {
    seenUrls.add(site.url)
    result.push({ ...site })
  }

  // Match against catalog
  for (const entry of SITE_CATALOG) {
    if (entry.keywords.test(joined)) {
      for (const site of entry.sites) {
        if (!seenUrls.has(site.url)) {
          seenUrls.add(site.url)
          result.push({ ...site })
        }
      }
    }
  }

  return result
}

/** Infer music artists and genres from interests */
function inferMusic(
  allInterests: readonly string[],
  soul: ParsedSoul,
): { artists: string[]; genres: string[] } {
  const joined = [...allInterests, ...soul.loves].join(' | ')
  const artistSet = new Set<string>()
  const genreSet = new Set<string>()

  for (const mapping of MUSIC_CATALOG) {
    if (mapping.keywords.test(joined)) {
      for (const artist of mapping.artists) artistSet.add(artist)
      for (const genre of mapping.genres) genreSet.add(genre)
    }
  }

  // Fallback if nothing matched
  if (genreSet.size === 0) {
    genreSet.add('pop')
    genreSet.add('indie')
  }

  return {
    artists: [...artistSet].slice(0, 10),
    genres: [...genreSet].slice(0, 4),
  }
}

/** Infer drama/show genre preferences from interests */
function inferDramaGenres(allInterests: readonly string[], soul: ParsedSoul): string[] {
  const joined = [...allInterests, ...soul.loves].join(' | ')
  const genreSet = new Set<string>()

  for (const mapping of DRAMA_CATALOG) {
    if (mapping.keywords.test(joined)) {
      for (const genre of mapping.genres) genreSet.add(genre)
    }
  }

  // Fallback
  if (genreSet.size === 0) {
    genreSet.add('drama')
  }

  return [...genreSet].slice(0, 5)
}

// ── Idle label builders ─────────────────────────────────────────────────

interface IdleLabelSet {
  readonly peak: string[]
  readonly warm: string[]
  readonly transition: string[]
  readonly lateNight: string[]
}

/** Build personality-driven idle labels from soul + interests */
function buildIdleLabels(soul: ParsedSoul, allInterests: readonly string[]): IdleLabelSet {
  const habits = soul.habits.slice(0, 6).map(h =>
    h.replace(/\s*—\s*.+$/, '').replace(/\(.+?\)/g, '').trim().toLowerCase()
  )

  // Extract short activity phrases from loves
  const loveActivities = soul.loves
    .map(l => l.replace(/\s*—\s*.+$/, '').replace(/\(.+?\)/g, '').trim().toLowerCase())
    .filter(l => l.length > 3 && l.length < 50)
    .slice(0, 8)

  // Interest-derived short labels
  const interestLabels = allInterests
    .map(i => i.replace(/\s*—\s*.+$/, '').replace(/\(.+?\)/g, '').trim().toLowerCase())
    .filter(i => i.length > 3 && i.length < 40)
    .slice(0, 6)

  const peakLabels = [
    ...habits.slice(0, 3),
    ...loveActivities.slice(0, 3),
    'in the zone',
  ].filter(Boolean)

  const warmLabels = [
    ...habits.slice(0, 2),
    ...interestLabels.slice(0, 2),
    'taking a break',
    'checking my phone',
  ].filter(Boolean)

  const transitionLabels = [
    'between things',
    ...interestLabels.slice(0, 2),
    'just vibing',
  ].filter(Boolean)

  const lateNightLabels = [
    ...loveActivities.slice(0, 2),
    'late night vibes',
    'should be sleeping',
  ].filter(Boolean)

  return {
    peak: dedupe(peakLabels),
    warm: dedupe(warmLabels),
    transition: dedupe(transitionLabels),
    lateNight: dedupe(lateNightLabels),
  }
}

/** Build sleep idle labels from personality hints */
function buildSleepLabels(soul: ParsedSoul): string[] {
  const base = ['sleeping', 'zzz']

  // Look for sleep-related personality cues in loves/habits
  const allText = [...soul.loves, ...soul.habits].join(' ')

  if (/game|gaming|league|ranked/i.test(allText)) {
    base.push('knocked out after gaming')
  }
  if (/drama|K-drama|series/i.test(allText)) {
    base.push('fell asleep mid-episode')
  }
  if (/photo|shoot|camera/i.test(allText)) {
    base.push('passed out after a shoot')
  }
  if (/music|mixing|ambient/i.test(allText)) {
    base.push('fell asleep to music')
  }
  if (/nocturnal|night|3\s*am|late/i.test(allText)) {
    base.push('DO NOT disturb')
  }

  return dedupe(base)
}

// ── Hour coverage helpers ───────────────────────────────────────────────

/** Build a boolean[24] indicating which hours are covered by existing slots */
function buildCoverageMap(slots: readonly RoutineSlot[]): boolean[] {
  const covered = new Array<boolean>(24).fill(false)
  for (const slot of slots) {
    if (slot.startHour < slot.endHour) {
      for (let h = slot.startHour; h < slot.endHour; h++) {
        covered[h] = true
      }
    } else {
      // Wrapping range (should not typically happen after our split above, but handle it)
      for (let h = slot.startHour; h < 24; h++) covered[h] = true
      for (let h = 0; h < slot.endHour; h++) covered[h] = true
    }
  }
  return covered
}

/** Find contiguous uncovered hour ranges */
function findUncoveredRanges(covered: boolean[]): ReadonlyArray<HourRange> {
  const ranges: Array<{ start: number; end: number }> = []
  let start: number | null = null

  for (let h = 0; h < 24; h++) {
    if (!covered[h] && start === null) {
      start = h
    } else if (covered[h] && start !== null) {
      ranges.push({ start, end: h })
      start = null
    }
  }
  if (start !== null) {
    ranges.push({ start, end: 24 })
  }

  return ranges
}

// ── Utility ─────────────────────────────────────────────────────────────

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)]
}
