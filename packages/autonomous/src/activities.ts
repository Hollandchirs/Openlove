/**
 * Activity Manager
 *
 * Tracks the character's current activity (listening to music, watching videos,
 * browsing the web, etc.) and notifies listeners (Discord presence, etc.)
 * when the activity changes.
 *
 * Activities auto-revert to idle after their specified duration.
 */

export type ActivityState =
  | { type: 'idle'; label: string }
  | { type: 'listening'; track: string; artist: string; album?: string }
  | { type: 'watching'; title: string; details?: string }
  | { type: 'browsing'; url?: string; title?: string }

export class ActivityManager {
  private currentActivity: ActivityState = { type: 'idle', label: 'chilling' }
  private onActivityChange?: (activity: ActivityState) => void
  private activityTimer?: NodeJS.Timeout

  /**
   * Register a callback that fires whenever the activity changes.
   * Used by Discord bridge to update Rich Presence.
   */
  setCallback(cb: (activity: ActivityState) => void): void {
    this.onActivityChange = cb
  }

  /**
   * Start a new activity. Automatically reverts to idle after durationMs.
   */
  startActivity(activity: ActivityState, durationMs: number): void {
    this.currentActivity = activity
    this.onActivityChange?.(activity)

    if (this.activityTimer) {
      clearTimeout(this.activityTimer)
    }

    this.activityTimer = setTimeout(() => {
      this.currentActivity = { type: 'idle', label: 'chilling' }
      this.onActivityChange?.(this.currentActivity)
      this.activityTimer = undefined
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
    this.currentActivity = { type: 'idle', label: 'chilling' }
    this.onActivityChange?.(this.currentActivity)
  }

  getCurrentActivity(): ActivityState {
    return this.currentActivity
  }
}
