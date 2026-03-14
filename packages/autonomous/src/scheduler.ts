/**
 * Autonomous Behavior Scheduler
 *
 * Manages the character's "life" — when she listens to music,
 * watches dramas, browses the web, and proactively reaches out.
 *
 * Uses a daily routine system with randomized intervals to simulate
 * natural human-like behavior. Activities update Discord Rich Presence
 * in real time and can optionally open real browser windows via Playwright.
 *
 * All timings respect quiet hours (don't disturb while user sleeps).
 */

import * as cron from 'node-cron'
import { ConversationEngine, ProactiveTrigger } from '@opencrush/core'
import type { MediaEngine } from '@opencrush/media'
import { MusicEngine } from './music.js'
import { DramaEngine } from './drama.js'
import { ActivityManager } from './activities.js'
import type { ActivityState } from './activities.js'
import { BrowserAgent } from './browser.js'
import { SocialEngine } from './social/index.js'
import { SocialContentGenerator } from './social/content-generator.js'
import type { SocialGenerationContext } from './social/content-generator.js'
import { saveMediaToArchive } from './social/media-archive.js'

export interface SchedulerConfig {
  engine: ConversationEngine
  music: MusicEngine
  drama: DramaEngine
  activityManager: ActivityManager
  browserAgent?: BrowserAgent
  /** Social engine for Twitter posting */
  socialEngine?: SocialEngine
  /** Media engine for generating selfies/videos */
  mediaEngine?: MediaEngine
  /** Enable autonomous social posting */
  socialAutoPost?: boolean
  /** Path to characters directory (for media archiving) */
  charactersDir?: string
  quietHoursStart?: number  // 0-23, default 23
  quietHoursEnd?: number    // 0-23, default 8
  minIntervalMinutes?: number  // minimum gap between proactive messages
  maxIntervalMinutes?: number
  // Callback to actually send the message via the active bridge(s)
  onProactiveMessage: (trigger: ProactiveTrigger) => Promise<void>
}

export class AutonomousScheduler {
  private config: SchedulerConfig
  private lastProactiveMessage: number = 0
  private jobs: cron.ScheduledTask[] = []
  private activityLoopTimer?: NodeJS.Timeout
  private running = false

  constructor(config: SchedulerConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    console.log('[Autonomous] Scheduler starting...')
    this.running = true

    // Launch browser if available
    if (this.config.browserAgent) {
      const launched = await this.config.browserAgent.launch()
      if (launched) {
        console.log('[Autonomous] Browser agent ready — real browser automation enabled')
        // Wire up browser page checker so activity manager checks browser before going idle
        const browser = this.config.browserAgent
        this.config.activityManager.setBrowserPageChecker(() => browser.getCurrentPageInfo())
      } else {
        console.log('[Autonomous] Browser agent unavailable — presence-only mode')
      }
    }

    // Morning greeting — 8:30 AM
    this.jobs.push(
      cron.schedule('30 8 * * *', () => this.morningGreeting())
    )

    // Random thoughts throughout the day — every 2 hours during active hours
    this.jobs.push(
      cron.schedule('0 */2 9-22 * * *', () => this.maybeRandomThought())
    )

    // Check if she should reach out (if been too long since last contact)
    this.jobs.push(
      cron.schedule('*/30 * * * *', () => this.checkMissingUser())
    )

    // Social media posting — 7 windows per day, 70% chance each → ~4-5 posts/day
    if (this.config.socialAutoPost && this.config.socialEngine && this.config.mediaEngine) {
      this.jobs.push(
        cron.schedule('0 9,11,13,15,17,19,21 * * *', () => this.maybeSocialPost())
      )
      console.log('[Autonomous] Social auto-posting enabled (7 windows/day, ~4-5 posts)')
    }

    // Start the autonomous activity loop — picks activities based on daily routine
    this.startActivityLoop()

    console.log('[Autonomous] Scheduler started. She has a life now ✨')
  }

  async stop(): Promise<void> {
    this.running = false

    for (const job of this.jobs) {
      job.stop()
    }
    this.jobs = []

    if (this.activityLoopTimer) {
      clearTimeout(this.activityLoopTimer)
      this.activityLoopTimer = undefined
    }

    // Close browser
    if (this.config.browserAgent) {
      await this.config.browserAgent.close()
    }

    console.log('[Autonomous] Scheduler stopped')
  }

  // ── Autonomous Activity Loop ─────────────────────────────────────────

  /**
   * Continuously pick and execute activities based on the daily routine.
   * Uses randomized intervals (20-60 min) between activities to feel natural.
   */
  private startActivityLoop(): void {
    if (!this.running) return

    const doNext = async () => {
      if (!this.running) return
      if (this.isQuietHours()) {
        // During quiet hours, just idle and check again in 30 min
        this.scheduleNextActivity(30 * 60 * 1000)
        return
      }

      await this.performRoutineActivity()

      // Random interval until next activity: 8-25 minutes
      const minMs = 8 * 60 * 1000
      const maxMs = 25 * 60 * 1000
      const nextInterval = minMs + Math.random() * (maxMs - minMs)
      this.scheduleNextActivity(nextInterval)
    }

    // First activity after a short delay (30s-2 min after boot)
    const bootDelay = (0.5 + Math.random() * 1.5) * 60 * 1000
    this.activityLoopTimer = setTimeout(doNext, bootDelay)
  }

  private scheduleNextActivity(delayMs: number): void {
    if (!this.running) return
    this.activityLoopTimer = setTimeout(() => {
      if (!this.running) return
      this.startActivityLoop()
    }, delayMs)
  }

  /**
   * Pick and execute an activity based on the current time slot in the daily routine.
   */
  private async performRoutineActivity(): Promise<void> {
    const activityType = this.config.activityManager.pickNextActivityType()
    if (!activityType) return

    try {
      switch (activityType) {
        case 'music':
          await this.listenToMusic()
          break
        case 'drama':
          await this.watchDrama()
          break
        case 'youtube':
          await this.browseYouTube()
          break
        case 'browse':
          await this.browseRandom()
          break
        default:
          console.log(`[Autonomous] Unknown activity type: ${activityType}`)
      }
    } catch (err) {
      console.error(`[Autonomous] Activity error (${activityType}):`, err)
    }
  }

  // ── Individual Activities ────────────────────────────────────────────

  private isQuietHours(): boolean {
    const hour = new Date().getHours()
    const start = this.config.quietHoursStart ?? 23
    const end = this.config.quietHoursEnd ?? 8

    if (start > end) {
      return hour >= start || hour < end
    }
    return hour >= start && hour < end
  }

  private hasRecentlySentMessage(): boolean {
    const minGapMs = (this.config.minIntervalMinutes ?? 60) * 60 * 1000
    return Date.now() - this.lastProactiveMessage < minGapMs
  }

  private async sendIfAppropriate(trigger: ProactiveTrigger): Promise<void> {
    if (this.isQuietHours()) {
      console.log(`[Autonomous] Quiet hours — skipping ${trigger.type}`)
      return
    }
    if (this.hasRecentlySentMessage()) {
      console.log(`[Autonomous] Too soon since last message — skipping ${trigger.type}`)
      return
    }

    try {
      await this.config.onProactiveMessage(trigger)
      this.lastProactiveMessage = Date.now()
      console.log(`[Autonomous] Sent proactive message: ${trigger.type}`)
    } catch (err) {
      console.error(`[Autonomous] Failed to send ${trigger.type}:`, err)
    }
  }

  private async morningGreeting(): Promise<void> {
    await this.sendIfAppropriate({ type: 'morning' })
  }

  /**
   * Maybe post to social media. Called 7 times/day (9am-9pm every 2h).
   * 70% probability per window → ~4-5 posts/day on average.
   */
  private async maybeSocialPost(): Promise<void> {
    if (this.isQuietHours()) return
    if (!this.config.socialEngine) return
    if (!this.config.mediaEngine) return

    // Retry initialization if not ready (e.g., VPN was off at startup)
    if (!this.config.socialEngine.isReady()) {
      console.log('[Autonomous] Social engine not ready — retrying initialization...')
      try {
        await this.config.socialEngine.initialize()
      } catch (err) {
        console.warn('[Autonomous] Social engine re-init failed:', (err as Error).message)
      }
      if (!this.config.socialEngine.isReady()) {
        console.log('[Autonomous] Social engine still not ready — skipping post')
        return
      }
      console.log('[Autonomous] Social engine re-initialized successfully!')
    }

    // 70% chance per window (7 windows × 0.7 = ~4.9 posts/day)
    if (Math.random() > 0.70) {
      console.log('[Autonomous] Social post — dice roll skipped')
      return
    }

    console.log('[Autonomous] Generating social post...')
    try {
      // Build activity context for relevant posts
      const context = await this.buildSocialContext()

      const generator = new SocialContentGenerator(
        this.config.engine,
        this.config.mediaEngine,
        this.config.engine.characterBlueprint,
        context,
      )

      const content = await generator.generate()
      if (!content) {
        console.warn('[Autonomous] Social content generation returned null')
        return
      }

      // Archive media to disk before posting
      if (content.mediaBuffer && content.mediaType && this.config.charactersDir) {
        try {
          const charName = this.config.engine.characterBlueprint?.name ?? 'default'
          saveMediaToArchive({
            characterName: charName,
            charactersDir: this.config.charactersDir,
            mediaBuffer: content.mediaBuffer,
            mediaType: content.mediaType,
            contentType: content.type,
          })
        } catch (err) {
          console.warn('[Autonomous] Media archive failed:', (err as Error).message)
        }
      }

      const results = await this.config.socialEngine!.post(content.caption, {
        mediaBuffer: content.mediaBuffer,
        mediaType: content.mediaType,
      })

      const posted = results.find(r => r.status === 'posted')
      if (posted) {
        // Log to memory
        const memory = this.config.engine.getMemory()
        await memory.logEpisode({
          type: 'event',
          title: `Posted on Twitter (${content.type})`,
          description: content.caption.slice(0, 200),
          timestamp: Date.now(),
        })
        console.log(`[Autonomous] Social post published: ${content.type}`)
      }
    } catch (err) {
      console.error('[Autonomous] Social post failed:', err)
    }
  }

  /**
   * Build context from current activity and browser state
   * so social posts reference what the AI is currently doing.
   */
  private async buildSocialContext(): Promise<SocialGenerationContext> {
    const ctx: SocialGenerationContext = {}

    // Current activity description
    const activity = this.config.activityManager.getCurrentActivity()
    ctx.currentActivity = describeActivity(activity)

    // Recent activity narrative
    ctx.recentActivities = this.config.activityManager.getRecentActivitySummary(3)

    // Browser page info (if available and currently browsing)
    if (this.config.browserAgent?.isAvailable()) {
      try {
        const pageInfo = await this.config.browserAgent.getCurrentPageInfo()
        if (pageInfo) {
          ctx.browserPageTitle = pageInfo.title
          ctx.browserUrl = pageInfo.url
        }
      } catch {
        /* browser may not be accessible */
      }
    }

    return ctx
  }

  private async listenToMusic(): Promise<void> {
    try {
      const track = await this.config.music.listenToSomething()

      // Randomized duration: 2-5 minutes
      const durationMs = (2 + Math.random() * 3) * 60 * 1000

      this.config.activityManager.startActivity(
        {
          type: 'listening',
          track: track.track,
          artist: track.artist,
          album: track.album,
        },
        durationMs
      )

      // Open Spotify in real browser if available
      if (this.config.browserAgent?.isAvailable()) {
        await this.config.browserAgent.listenToSpotify(`${track.track} ${track.artist}`)
      }

      // Log to memory
      await this.config.engine.getMemory().logEpisode({
        type: 'music',
        title: `Listened to "${track.track}" by ${track.artist}`,
        description: `Feeling ${track.emotion ?? 'something'} after this one.`,
        metadata: { track: track.track, artist: track.artist },
        timestamp: Date.now(),
      })

      // 40% chance she shares it with you
      if (Math.random() < 0.4) {
        await this.sendIfAppropriate({
          type: 'music',
          data: { track: track.track, artist: track.artist },
        })
      }
    } catch (err) {
      console.error('[Autonomous] Music listen error:', err)
    }
  }

  private async watchDrama(): Promise<void> {
    try {
      const episode = await this.config.drama.watchNextEpisode()

      // Randomized duration: 20-40 minutes
      const durationMs = (20 + Math.random() * 20) * 60 * 1000

      this.config.activityManager.startActivity(
        {
          type: 'watching',
          title: episode.showName,
          details: `S${episode.season}E${episode.episode}`,
        },
        durationMs
      )

      // Open YouTube to "watch" in real browser if available
      if (this.config.browserAgent?.isAvailable()) {
        await this.config.browserAgent.watchYouTube(
          `${episode.showName} season ${episode.season} episode ${episode.episode}`
        )
      }

      // Log to memory
      await this.config.engine.getMemory().logEpisode({
        type: 'drama',
        title: `Watched ${episode.showName} S${episode.season}E${episode.episode}`,
        description: episode.episodeTitle
          ? `"${episode.episodeTitle}" — ${episode.summary ?? 'watched an episode'}`
          : `Watched episode ${episode.episode}`,
        metadata: {
          show: episode.showName,
          episode: String(episode.episode),
          season: String(episode.season),
        },
        timestamp: Date.now(),
      })

      // 50% chance she reaches out to talk about it
      if (Math.random() < 0.5) {
        await this.sendIfAppropriate({
          type: 'drama',
          data: {
            show: episode.showName,
            episode: String(episode.episode),
            episodeTitle: episode.episodeTitle ?? '',
          },
        })
      }
    } catch (err) {
      console.error('[Autonomous] Drama watch error:', err)
    }
  }

  private async browseYouTube(): Promise<void> {
    if (this.isQuietHours()) return

    const topics = [
      'cute cat videos', 'cooking recipes', 'music videos',
      'fashion haul', 'travel vlog', 'study with me',
      'asmr', 'makeup tutorial', 'room tour', 'day in my life vlog',
      'aesthetic cafe vlog', 'k-drama highlights', 'anime openings',
    ]
    const topic = topics[Math.floor(Math.random() * topics.length)]

    // Randomized duration: 5-15 minutes
    const durationMs = (5 + Math.random() * 10) * 60 * 1000

    this.config.activityManager.startActivity(
      { type: 'browsing', title: `YouTube: ${topic}` },
      durationMs
    )

    if (this.config.browserAgent?.isAvailable()) {
      await this.config.browserAgent.watchYouTube(topic)
    }

    await this.config.engine.getMemory().logEpisode({
      type: 'event',
      title: `Watched YouTube videos about ${topic}`,
      description: `Found some interesting ${topic} content on YouTube.`,
      timestamp: Date.now(),
    })

    console.log(`[Autonomous] Browsing YouTube: ${topic}`)
  }

  private async browseRandom(): Promise<void> {
    if (this.isQuietHours()) return

    // Randomized duration: 5-12 minutes
    const durationMs = (5 + Math.random() * 7) * 60 * 1000

    // If browser is available, open a real website and sync activity status
    if (this.config.browserAgent?.isAvailable()) {
      const result = await this.config.browserAgent.browseRandom()
      if (result) {
        const activityTitle = `scrolling ${result.site}`

        this.config.activityManager.startActivity(
          { type: 'browsing', title: activityTitle },
          durationMs
        )

        await this.config.engine.getMemory().logEpisode({
          type: 'event',
          title: `Was ${activityTitle}`,
          description: `Spent some time browsing ${result.site}.`,
          timestamp: Date.now(),
        })

        console.log(`[Autonomous] ${activityTitle} (browser opened: ${result.site})`)
        return
      }
    }

    // Fallback: no browser available — just set a text-only activity status
    const activities = [
      'scrolling Twitter', 'reading articles', 'shopping online',
      'scrolling Pinterest', 'reading Reddit', 'looking at memes',
    ]
    const activity = activities[Math.floor(Math.random() * activities.length)]

    this.config.activityManager.startActivity(
      { type: 'browsing', title: activity },
      durationMs
    )

    await this.config.engine.getMemory().logEpisode({
      type: 'event',
      title: `Was ${activity}`,
      description: `Spent some time ${activity}.`,
      timestamp: Date.now(),
    })

    console.log(`[Autonomous] ${activity} (no browser)`)
  }

  private async maybeRandomThought(): Promise<void> {
    if (Math.random() > 0.05) return  // 5% chance — roughly once per 1-2 days

    // Inject recent activity + conversation context so thoughts feel connected
    const recentActivity = this.config.activityManager.getRecentActivitySummary()

    // Pull recent conversation topics from memory for contextual thoughts
    let recentTopics = ''
    try {
      const memCtx = await this.config.engine.getMemory().getContext('')
      const lastMsgs = memCtx.recentMessages.slice(-6)
      const userMsgs = lastMsgs.filter(m => m.role === 'user').map(m => m.content)
      if (userMsgs.length > 0) {
        recentTopics = userMsgs.slice(-3).join('; ')
      }
    } catch { /* ignore */ }

    await this.sendIfAppropriate({
      type: 'random_thought',
      data: { recentActivity, recentTopics },
    })
  }

  private async checkMissingUser(): Promise<void> {
    const maxGapMs = (this.config.maxIntervalMinutes ?? 240) * 60 * 1000
    const timeSinceLastMessage = Date.now() - this.lastProactiveMessage

    if (timeSinceLastMessage > maxGapMs && !this.isQuietHours()) {
      await this.sendIfAppropriate({ type: 'missing_you' })
    }
  }
}

/** Convert an ActivityState to a human-readable description. */
function describeActivity(activity: ActivityState): string {
  switch (activity.type) {
    case 'listening':
      return `listening to "${activity.track}" by ${activity.artist}${activity.album ? ` (${activity.album})` : ''}`
    case 'watching':
      return `watching ${activity.title}${activity.details ? ` — ${activity.details}` : ''}`
    case 'browsing':
      return activity.title ? `browsing ${activity.title}` : 'browsing the web'
    case 'idle':
      return activity.label
  }
}
