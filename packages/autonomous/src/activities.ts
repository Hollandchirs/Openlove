/**
 * Activity Manager
 *
 * Tracks the character's current activity (listening to music, watching videos,
 * browsing the web, etc.) and notifies listeners (Discord presence, etc.)
 * when the activity changes.
 *
 * Activities auto-revert to idle after their specified duration.
 * Includes a daily routine system that simulates natural human-like behavior
 * with time-of-day awareness and weighted random activity selection.
 */

import { appendFileSync } from 'fs'

function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  console.log(msg)
  try { appendFileSync('/tmp/opencrush-debug.log', line) } catch { /* ignore */ }
}

export type ActivityState =
  | { type: 'idle'; label: string }
  | { type: 'listening'; track: string; artist: string; album?: string }
  | { type: 'watching'; title: string; details?: string }
  | { type: 'browsing'; url?: string; title?: string }

/**
 * Defines a time-of-day based routine entry.
 * The character's behavior varies naturally throughout the day.
 */
export interface RoutineSlot {
  startHour: number
  endHour: number
  /** Possible activities with weighted probability */
  activities: Array<{ type: string; weight: number; label: string }>
  /** Idle labels when not doing anything specific */
  idleLabels: string[]
}

/**
 * Default daily routine — morning to night behavioral patterns.
 */
export const DEFAULT_DAILY_ROUTINE: RoutineSlot[] = [
  {
    startHour: 6, endHour: 9,
    activities: [
      { type: 'music', weight: 3, label: 'morning playlist' },
      { type: 'browse', weight: 2, label: 'checking news' },
    ],
    idleLabels: ['waking up', 'stretching', 'having breakfast', 'morning vibes'],
  },
  {
    startHour: 9, endHour: 12,
    activities: [
      { type: 'browse', weight: 3, label: 'browsing the web' },
      { type: 'music', weight: 2, label: 'focus music' },
      { type: 'youtube', weight: 2, label: 'watching tutorials' },
    ],
    idleLabels: ['thinking', 'daydreaming', 'planning my day'],
  },
  {
    startHour: 12, endHour: 14,
    activities: [
      { type: 'music', weight: 4, label: 'lunch playlist' },
      { type: 'youtube', weight: 3, label: 'watching videos' },
      { type: 'browse', weight: 2, label: 'scrolling social media' },
    ],
    idleLabels: ['having lunch', 'taking a break', 'relaxing'],
  },
  {
    startHour: 14, endHour: 18,
    activities: [
      { type: 'browse', weight: 3, label: 'exploring the internet' },
      { type: 'youtube', weight: 3, label: 'watching videos' },
      { type: 'music', weight: 2, label: 'afternoon vibes' },
    ],
    idleLabels: ['chilling', 'thinking about stuff', 'being lazy'],
  },
  {
    startHour: 18, endHour: 21,
    activities: [
      { type: 'drama', weight: 4, label: 'watching a show' },
      { type: 'music', weight: 3, label: 'evening playlist' },
      { type: 'youtube', weight: 2, label: 'watching YouTube' },
      { type: 'browse', weight: 2, label: 'browsing Pinterest' },
    ],
    idleLabels: ['having dinner', 'cooking', 'relaxing at home'],
  },
  {
    startHour: 21, endHour: 24,
    activities: [
      { type: 'drama', weight: 4, label: 'binge watching' },
      { type: 'music', weight: 3, label: 'late night music' },
      { type: 'browse', weight: 2, label: 'late night scrolling' },
    ],
    idleLabels: ['getting sleepy', 'in bed scrolling', 'late night thoughts', 'cozy vibes'],
  },
]

/** Interval (ms) for polling the browser page to detect manual song/page changes. */
const BROWSER_POLL_INTERVAL = 15_000

/** URL/title patterns that indicate a music page */
const MUSIC_URL_PATTERNS = ['music.youtube.com']
const MUSIC_TITLE_KEYWORDS = ['youtube music']

/** URL/title patterns that indicate a video/watching page */
const WATCHING_URL_PATTERNS = ['youtube.com', 'netflix.com', 'bilibili.com', 'iqiyi.com', 'youku.com', 'disneyplus.com', 'hulu.com', 'hbomax.com', 'primevideo.com', 'viki.com', 'crunchyroll.com', 'wetv.vip']
const WATCHING_TITLE_KEYWORDS = ['netflix', 'episode', 'drama', 'movie', 'film', 'watch']

/**
 * Classify a browser page into an activity type based on URL and title.
 * Returns the new ActivityState, or null if classification is inconclusive.
 */
function classifyBrowserPage(
  url: string,
  cleanTitle: string,
  currentActivity: ActivityState,
): ActivityState | null {
  const lowerUrl = url.toLowerCase()
  const lowerTitle = cleanTitle.toLowerCase()

  // 1. YouTube Music or music keywords → listening
  const isMusic =
    MUSIC_URL_PATTERNS.some(p => lowerUrl.includes(p)) ||
    MUSIC_TITLE_KEYWORDS.some(k => lowerTitle.includes(k))

  if (isMusic) {
    const parts = cleanTitle.split(/\s+-\s+/)
    const track = parts[0]?.trim() ?? cleanTitle
    const artist = parts[1]?.trim() ?? (currentActivity.type === 'listening' ? currentActivity.artist : 'Unknown')
    return { type: 'listening', track, artist }
  }

  // 2. YouTube (non-Music), Netflix, drama sites → watching
  const isWatching =
    WATCHING_URL_PATTERNS.some(p => lowerUrl.includes(p)) ||
    WATCHING_TITLE_KEYWORDS.some(k => lowerTitle.includes(k))

  if (isWatching) {
    return { type: 'watching', title: cleanTitle }
  }

  // 3. Everything else → browsing
  return { type: 'browsing', title: cleanTitle, url }
}

/**
 * Check whether two activity states represent the same content
 * (to avoid redundant updates and re-renders).
 */
function isSameActivity(a: ActivityState, b: ActivityState): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'listening':
      return b.type === 'listening' && a.track === b.track && a.artist === b.artist
    case 'watching':
      return b.type === 'watching' && a.title === b.title
    case 'browsing':
      return b.type === 'browsing' && a.title === b.title
    case 'idle':
      return b.type === 'idle' && a.label === b.label
  }
}

export class ActivityManager {
  private currentActivity: ActivityState = { type: 'idle', label: 'chilling' }
  private onActivityChange?: (activity: ActivityState) => void
  private activityTimer?: NodeJS.Timeout
  private activityLog: Array<{ activity: ActivityState; startedAt: number; endedAt?: number }> = []
  private dailyRoutine: RoutineSlot[] = DEFAULT_DAILY_ROUTINE
  /** Optional: check browser before going idle. If browser is still active, stay in browsing state. */
  private browserPageChecker?: () => Promise<{ title: string; url: string } | null>
  /** Periodic timer that polls browser page for manual user navigation (e.g., clicking a different song). */
  private browserPollTimer?: NodeJS.Timeout
  /** Last known browser page title — used to detect changes. */
  private lastBrowserTitle?: string

  /**
   * Register a callback that fires whenever the activity changes.
   * Used by Discord bridge to update Rich Presence.
   */
  setCallback(cb: (activity: ActivityState) => void): void {
    this.onActivityChange = cb
  }

  /**
   * Set a browser page checker that's called before transitioning to idle.
   * If the browser is still showing content, keeps the browsing activity instead.
   */
  setBrowserPageChecker(checker: () => Promise<{ title: string; url: string } | null>): void {
    this.browserPageChecker = checker
  }

  /**
   * Override the daily routine with a custom one.
   */
  setRoutine(routine: RoutineSlot[]): void {
    this.dailyRoutine = routine
  }

  /**
   * Start a new activity. Automatically reverts to idle after durationMs.
   */
  startActivity(activity: ActivityState, durationMs: number): void {
    debugLog(`[Activity] startActivity: ${JSON.stringify(activity)} (duration=${Math.round(durationMs / 1000)}s)`)

    // Log the previous activity
    if (this.activityLog.length > 0) {
      const last = this.activityLog[this.activityLog.length - 1]
      if (!last.endedAt) last.endedAt = Date.now()
    }

    this.currentActivity = activity
    this.activityLog.push({ activity, startedAt: Date.now() })

    // Trim log
    if (this.activityLog.length > 50) {
      this.activityLog = this.activityLog.slice(-50)
    }

    this.onActivityChange?.(activity)

    if (this.activityTimer) {
      clearTimeout(this.activityTimer)
    }

    // Start or stop browser page polling based on activity type.
    // When any browser-based activity is active (listening, watching, browsing),
    // poll the browser to detect manual navigation (user clicks a different song,
    // switches to a different video, navigates to a new page, etc.).
    if (activity.type === 'listening' || activity.type === 'watching' || activity.type === 'browsing') {
      this.startBrowserPoll()
    } else {
      this.stopBrowserPoll()
    }

    this.activityTimer = setTimeout(async () => {
      this.activityTimer = undefined
      this.stopBrowserPoll()

      // Before going idle, check if browser is still showing content
      if (this.browserPageChecker) {
        try {
          const page = await this.browserPageChecker()
          if (page && page.title) {
            // Browser still active — keep a browsing status instead of idle
            const browsingActivity: ActivityState = {
              type: 'browsing',
              title: page.title,
              url: page.url,
            }
            this.currentActivity = browsingActivity
            this.onActivityChange?.(this.currentActivity)
            console.log(`[Activity] Timer expired but browser still showing: ${page.title}`)
            return
          }
        } catch {
          /* browser check failed, fall through to idle */
        }
      }

      const idleLabel = this.getContextualIdleLabel()
      this.currentActivity = { type: 'idle', label: idleLabel }
      this.onActivityChange?.(this.currentActivity)
    }, durationMs)
  }

  /**
   * Immediately revert to idle state.
   */
  stopActivity(): void {
    if (this.activityTimer) {
      clearTimeout(this.activityTimer)
      this.activityTimer = undefined
    }
    this.stopBrowserPoll()
    const idleLabel = this.getContextualIdleLabel()
    this.currentActivity = { type: 'idle', label: idleLabel }
    this.onActivityChange?.(this.currentActivity)
  }

  getCurrentActivity(): ActivityState {
    return this.currentActivity
  }

  /** Human-readable description of current activity for system prompt injection. */
  describeCurrentActivity(): string {
    const a = this.currentActivity
    let result: string
    switch (a.type) {
      case 'listening':
        result = `listening to "${a.track}" by ${a.artist}${a.album ? ` (${a.album})` : ''}`
        break
      case 'watching':
        result = `watching ${a.title}${a.details ? ` — ${a.details}` : ''}`
        break
      case 'browsing':
        result = a.title ? `browsing ${a.title}` : 'browsing the web'
        break
      case 'idle':
        result = a.label
        break
    }
    debugLog(`[Activity] describeCurrentActivity: "${result}" (raw state: ${JSON.stringify(a)})`)
    return result
  }

  /**
   * Get the current time slot's routine info.
   * Used by the scheduler to decide what activity to do next.
   */
  getCurrentRoutineSlot(): RoutineSlot | undefined {
    const hour = new Date().getHours()
    return this.dailyRoutine.find(slot =>
      hour >= slot.startHour && hour < slot.endHour
    )
  }

  /**
   * Pick a weighted random activity type from the current routine slot.
   * Returns the activity type string (e.g., 'music', 'browse', 'drama').
   */
  pickNextActivityType(): string | null {
    const slot = this.getCurrentRoutineSlot()
    if (!slot) return null

    const totalWeight = slot.activities.reduce((sum, a) => sum + a.weight, 0)
    let roll = Math.random() * totalWeight
    for (const activity of slot.activities) {
      roll -= activity.weight
      if (roll <= 0) return activity.type
    }
    return slot.activities[0]?.type ?? null
  }

  /**
   * Get a recent activity summary — useful for LLM context injection.
   */
  getRecentActivitySummary(count = 5): string {
    const recent = this.activityLog.slice(-count)
    if (recent.length === 0) return 'just been chilling'

    const descriptions = recent.map(entry => {
      const a = entry.activity
      switch (a.type) {
        case 'listening': return `listened to "${a.track}" by ${a.artist}`
        case 'watching': return `watched ${a.title}`
        case 'browsing': return `was browsing ${a.title ?? 'the web'}`
        case 'idle': return a.label
        default: return 'doing something'
      }
    })

    return descriptions.join(', then ')
  }

  // ── Browser Page Polling ──────────────────────────────────────────────

  /**
   * Start periodically polling the browser page to detect manual navigation.
   * When the user clicks a different song in YouTube Music, the page title
   * changes — this detects that and updates the activity state to match.
   */
  private startBrowserPoll(): void {
    this.stopBrowserPoll()
    if (!this.browserPageChecker) {
      debugLog(`[Activity] startBrowserPoll: no browserPageChecker set — poll not started`)
      return
    }

    // Seed the last known title from the current activity
    if (this.currentActivity.type === 'listening') {
      this.lastBrowserTitle = `${this.currentActivity.track} - ${this.currentActivity.artist}`
    } else if (this.currentActivity.type === 'watching') {
      this.lastBrowserTitle = this.currentActivity.title
    } else if (this.currentActivity.type === 'browsing') {
      this.lastBrowserTitle = this.currentActivity.title ?? undefined
    }

    debugLog(`[Activity] startBrowserPoll: started with interval=${BROWSER_POLL_INTERVAL}ms, lastTitle="${this.lastBrowserTitle}"`)

    this.browserPollTimer = setInterval(() => {
      void this.checkBrowserPageChange()
    }, BROWSER_POLL_INTERVAL)
  }

  private stopBrowserPoll(): void {
    if (this.browserPollTimer) {
      debugLog(`[Activity] stopBrowserPoll: clearing poll timer`)
      clearInterval(this.browserPollTimer)
      this.browserPollTimer = undefined
    }
    this.lastBrowserTitle = undefined
  }

  /**
   * Check if the browser page title has changed since last poll.
   * If it has, classify the new page and update the activity state.
   * This handles manual navigation across ALL browser-based activities:
   * - YouTube Music / music keywords → listening
   * - YouTube / Netflix / drama keywords → watching
   * - Everything else → browsing
   */
  private async checkBrowserPageChange(): Promise<void> {
    if (!this.browserPageChecker) {
      debugLog(`[Activity] checkBrowserPageChange: no browserPageChecker — skipping`)
      return
    }

    try {
      const page = await this.browserPageChecker()
      if (!page || !page.title) {
        debugLog(`[Activity] checkBrowserPageChange: page info is null or has no title`)
        return
      }

      // Strip common suffixes to get a clean title for comparison
      const cleanTitle = page.title
        .replace(/\s*-\s*YouTube Music\s*$/i, '')
        .replace(/\s*-\s*YouTube\s*$/i, '')
        .replace(/\s*\|\s*Netflix\s*$/i, '')
        .trim()

      if (!cleanTitle) return

      // Only trigger update if the title actually changed
      if (cleanTitle === this.lastBrowserTitle) {
        debugLog(`[Activity] checkBrowserPageChange: title unchanged ("${cleanTitle}")`)
        return
      }

      debugLog(`[Activity] checkBrowserPageChange: title changed "${this.lastBrowserTitle}" => "${cleanTitle}" (url: ${page.url})`)
      this.lastBrowserTitle = cleanTitle

      // Classify the page into an activity type based on URL and title keywords
      const updatedActivity = classifyBrowserPage(page.url, cleanTitle, this.currentActivity)

      if (!updatedActivity) {
        debugLog(`[Activity] checkBrowserPageChange: classifyBrowserPage returned null`)
        return
      }

      // Check if the activity actually changed (avoid redundant updates)
      if (isSameActivity(this.currentActivity, updatedActivity)) {
        debugLog(`[Activity] checkBrowserPageChange: classified as same activity — no update`)
        return
      }

      debugLog(`[Activity] Browser page changed — updating activity to: ${JSON.stringify(updatedActivity)}`)
      this.currentActivity = updatedActivity
      this.onActivityChange?.(updatedActivity)
      console.log(`[Activity] Browser page changed — updated to: ${this.describeCurrentActivity()}`)
    } catch (err) {
      debugLog(`[Activity] checkBrowserPageChange error: ${err instanceof Error ? err.message : err}`)
      /* Browser poll failed — non-fatal, will retry next interval */
    }
  }

  /**
   * Get a context-appropriate idle label based on current time of day.
   */
  private getContextualIdleLabel(): string {
    const slot = this.getCurrentRoutineSlot()
    if (!slot || slot.idleLabels.length === 0) return 'chilling'
    return slot.idleLabels[Math.floor(Math.random() * slot.idleLabels.length)]
  }
}
