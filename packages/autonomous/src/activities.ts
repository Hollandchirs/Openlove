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

export class ActivityManager {
  private currentActivity: ActivityState = { type: 'idle', label: 'chilling' }
  private onActivityChange?: (activity: ActivityState) => void
  private activityTimer?: NodeJS.Timeout
  private activityLog: Array<{ activity: ActivityState; startedAt: number; endedAt?: number }> = []
  private dailyRoutine: RoutineSlot[] = DEFAULT_DAILY_ROUTINE
  /** Optional: check browser before going idle. If browser is still active, stay in browsing state. */
  private browserPageChecker?: () => Promise<{ title: string; url: string } | null>

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

    this.activityTimer = setTimeout(async () => {
      this.activityTimer = undefined

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
    switch (a.type) {
      case 'listening':
        return `listening to "${a.track}" by ${a.artist}${a.album ? ` (${a.album})` : ''}`
      case 'watching':
        return `watching ${a.title}${a.details ? ` — ${a.details}` : ''}`
      case 'browsing':
        return a.title ? `browsing ${a.title}` : 'browsing the web'
      case 'idle':
        return a.label
    }
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

  /**
   * Get a context-appropriate idle label based on current time of day.
   */
  private getContextualIdleLabel(): string {
    const slot = this.getCurrentRoutineSlot()
    if (!slot || slot.idleLabels.length === 0) return 'chilling'
    return slot.idleLabels[Math.floor(Math.random() * slot.idleLabels.length)]
  }
}
