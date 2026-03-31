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
import { writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
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

function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  console.log(msg)
  try { appendFileSync('/tmp/opencrush-debug.log', line) } catch { /* ignore */ }
}

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
  /** Character-specific YouTube topics (replaces generic list) */
  youtubeTopics?: string[]
  /** Character-specific browse sites (replaces generic list) */
  browseSites?: Array<{ url: string; site: string }>
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
        // Sleeping — set sleep status, check again in 60 min
        const sleepLabels = ['sleeping 💤', 'zzz...', 'dreaming', 'passed out']
        const sl = sleepLabels[Math.floor(Math.random() * sleepLabels.length)]
        this.config.activityManager.startActivity({ type: 'idle', label: sl }, 60 * 60 * 1000)
        this.scheduleNextActivity(60 * 60 * 1000)
        return
      }

      await this.performRoutineActivity()

      // Time-aware intervals: busier during the day, calmer at night
      const hour = new Date().getHours()
      let minMs: number, maxMs: number
      if (hour >= 9 && hour < 18) {
        minMs = 3 * 60 * 1000; maxMs = 8 * 60 * 1000   // daytime: 3-8 min
      } else if (hour >= 18 && hour < 22) {
        minMs = 5 * 60 * 1000; maxMs = 12 * 60 * 1000  // evening: 5-12 min
      } else {
        minMs = 10 * 60 * 1000; maxMs = 20 * 60 * 1000  // late night: 10-20 min
      }
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
        case 'gaming':
          await this.playGame()
          break
        default:
          console.log(`[Autonomous] Unknown activity type: ${activityType}`)
      }
      // Update emotion based on the activity
      try {
        const currentActivity = this.config.activityManager.getCurrentActivity()
        const actLabel = currentActivity?.title ?? activityType
        this.config.engine.emotion?.updateFromActivity?.(activityType, actLabel)
      } catch { /* emotion update is best-effort */ }

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

    // Capture a real browser screenshot if the browser is active during an activity.
    // This gives the proactive message an authentic "here's what I'm doing" attachment.
    const enrichedTrigger = await this.maybeAttachBrowserScreenshot(trigger)

    try {
      await this.config.onProactiveMessage(enrichedTrigger)
      this.lastProactiveMessage = Date.now()
      console.log(`[Autonomous] Sent proactive message: ${enrichedTrigger.type}${enrichedTrigger.screenshotPath ? ' (with screenshot)' : ''}`)
    } catch (err) {
      console.error(`[Autonomous] Failed to send ${trigger.type}:`, err)
    }
  }

  /**
   * If the browser is active and showing relevant content, take a screenshot
   * and save it to /tmp so it can be attached to the proactive message.
   * Only attaches screenshots for activity-based triggers (music, drama, random_thought).
   */
  private async maybeAttachBrowserScreenshot(trigger: ProactiveTrigger): Promise<ProactiveTrigger> {
    // Only attach screenshots for activity-based triggers where a browser view is relevant
    const screenshotTriggerTypes = ['music', 'drama', 'random_thought', 'missing_you']
    if (!screenshotTriggerTypes.includes(trigger.type)) return trigger
    if (!this.config.browserAgent?.isAvailable()) return trigger

    // 50% chance to attach a screenshot — don't want every message to have one
    if (Math.random() > 0.5) return trigger

    try {
      const screenshot = await this.config.browserAgent.takeScreenshot()
      if (!screenshot) return trigger

      // Verify the browser is showing something interesting (not blank/new tab)
      const pageInfo = await this.config.browserAgent.getCurrentPageInfo()
      if (!pageInfo || pageInfo.url === 'about:blank' || pageInfo.url === 'chrome://newtab/') {
        return trigger
      }

      // Save screenshot to /tmp with a unique filename
      const filename = `opencrush-activity-${Date.now()}.png`
      const filepath = join('/tmp', filename)
      writeFileSync(filepath, screenshot)
      console.log(`[Autonomous] Browser screenshot saved: ${filepath} (${pageInfo.title})`)

      return { ...trigger, screenshotPath: filepath }
    } catch (err) {
      console.warn('[Autonomous] Browser screenshot failed:', (err as Error).message)
      return trigger
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
      debugLog(`[Autonomous] MusicEngine picked: "${track.track}" by ${track.artist}`)

      // Randomized duration: 2-5 minutes
      const durationMs = (2 + Math.random() * 3) * 60 * 1000

      // Track the actual playing track/artist — may be updated by browser result
      let actualTrack = track.track
      let actualArtist = track.artist

      // Set initial activity state (will be updated after browser confirms actual track)
      this.config.activityManager.startActivity(
        {
          type: 'listening',
          track: actualTrack,
          artist: actualArtist,
          album: track.album,
        },
        durationMs
      )
      debugLog(`[Autonomous] Initial activity set: listening to "${actualTrack}" by ${actualArtist}`)

      // Open YouTube Music in real browser if available (try recovery if needed)
      if (this.config.browserAgent) {
        debugLog(`[Autonomous] Browser agent exists, isAvailable=${this.config.browserAgent.isAvailable()}`)
        if (!this.config.browserAgent.isAvailable()) {
          debugLog(`[Autonomous] Attempting browser recovery...`)
          await this.config.browserAgent.tryRecoverPage()
          debugLog(`[Autonomous] After recovery, isAvailable=${this.config.browserAgent.isAvailable()}`)
        }
        if (this.config.browserAgent.isAvailable()) {
          const searchQuery = `${track.track} ${track.artist}`
          debugLog(`[Autonomous] Sending to browser.listenToMusic: "${searchQuery}"`)
          const browserResult = await this.config.browserAgent.listenToMusic(searchQuery)
          debugLog(`[Autonomous] Browser listenToMusic returned: ${JSON.stringify(browserResult)}`)

          // Sync activity state with what the browser is ACTUALLY playing.
          // The browser page title contains the real song name, which may differ
          // from the original search query (e.g., search for "Blinding Lights The Weeknd"
          // but YouTube Music plays a cover or remix with a different title).
          if (browserResult?.title) {
            const parsed = parseBrowserMusicTitle(browserResult.title)
            debugLog(`[Autonomous] parseBrowserMusicTitle("${browserResult.title}") => track="${parsed.track}", artist="${parsed.artist ?? '(none)'}"`)

            // If the browser title can be parsed into track/artist, use it.
            // But if it looks like our original search query was echoed back (no separator),
            // keep the MusicEngine's structured data instead.
            if (parsed.artist) {
              actualTrack = parsed.track
              actualArtist = parsed.artist
            } else {
              debugLog(`[Autonomous] Browser title has no artist separator — keeping MusicEngine data`)
            }

            // Update the activity state with the actual playing track
            this.config.activityManager.startActivity(
              {
                type: 'listening',
                track: actualTrack,
                artist: actualArtist,
                album: track.album,
              },
              durationMs
            )
            debugLog(`[Autonomous] SYNCED activity to browser track: "${actualTrack}" by ${actualArtist}`)
          } else {
            debugLog(`[Autonomous] Browser returned no title — keeping MusicEngine pick`)
          }
        } else {
          debugLog(`[Autonomous] Browser not available — using MusicEngine pick only`)
        }
      } else {
        debugLog(`[Autonomous] No browser agent configured`)
      }

      // Final state confirmation
      const finalActivity = this.config.activityManager.getCurrentActivity()
      debugLog(`[Autonomous] Final activity state: ${JSON.stringify(finalActivity)}`)

      // Log to memory using the actual track (post-browser-sync)
      await this.config.engine.getMemory().logEpisode({
        type: 'music',
        title: `Listened to "${actualTrack}" by ${actualArtist}`,
        description: `Feeling ${track.emotion ?? 'something'} after this one.`,
        metadata: { track: actualTrack, artist: actualArtist },
        timestamp: Date.now(),
      })

      // 40% chance she shares it with you
      if (Math.random() < 0.4) {
        await this.sendIfAppropriate({
          type: 'music',
          data: { track: actualTrack, artist: actualArtist },
        })
      }
    } catch (err) {
      console.error('[Autonomous] Music listen error:', err)
      debugLog(`[Autonomous] Music listen error: ${err instanceof Error ? err.stack : err}`)
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

      // Open YouTube to "watch" in real browser if available (try recovery if needed)
      if (this.config.browserAgent) {
        if (!this.config.browserAgent.isAvailable()) {
          await this.config.browserAgent.tryRecoverPage()
        }
        if (this.config.browserAgent.isAvailable()) {
          await this.config.browserAgent.watchYouTube(
            `${episode.showName} season ${episode.season} episode ${episode.episode}`
          )
        }
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

    const defaultTopics = [
      'cute cat videos', 'cooking recipes', 'music videos',
      'fashion haul', 'travel vlog', 'study with me',
      'asmr', 'makeup tutorial', 'room tour', 'day in my life vlog',
      'aesthetic cafe vlog', 'k-drama highlights', 'anime openings',
    ]
    const topics = (this.config.youtubeTopics && this.config.youtubeTopics.length > 0)
      ? this.config.youtubeTopics
      : defaultTopics
    const topic = topics[Math.floor(Math.random() * topics.length)]

    // Randomized duration: 5-15 minutes
    const durationMs = (5 + Math.random() * 10) * 60 * 1000

    // Try browser first to get real page title
    let activityTitle = `YouTube: ${topic}`
    if (this.config.browserAgent?.isAvailable()) {
      const result = await this.config.browserAgent.watchYouTube(topic)
      if (result) {
        activityTitle = result.title
      }
    }

    this.config.activityManager.startActivity(
      { type: 'watching', title: activityTitle, details: topic },
      durationMs
    )

    await this.config.engine.getMemory().logEpisode({
      type: 'event',
      title: `Watched YouTube: ${activityTitle}`,
      description: `Watching "${activityTitle}" on YouTube (searched: ${topic}).`,
      timestamp: Date.now(),
    })

    console.log(`[Autonomous] Watching YouTube: ${activityTitle}`)
  }

  private async browseRandom(): Promise<void> {
    if (this.isQuietHours()) return

    // Randomized duration: 5-12 minutes
    const durationMs = (5 + Math.random() * 7) * 60 * 1000

    // Try recovery if browser is in circuit-breaker state
    if (this.config.browserAgent && !this.config.browserAgent.isAvailable()) {
      await this.config.browserAgent.tryRecoverPage()
    }

    // If browser is available, open a real website and sync activity status
    if (this.config.browserAgent?.isAvailable()) {
      const result = await this.config.browserAgent.browseRandom(this.config.browseSites)
      if (result) {
        this.config.activityManager.startActivity(
          { type: 'browsing', title: result.title, url: result.site },
          durationMs
        )

        await this.config.engine.getMemory().logEpisode({
          type: 'event',
          title: `Browsing ${result.site}`,
          description: `Browsing ${result.site}: ${result.title}`,
          timestamp: Date.now(),
        })

        console.log(`[Autonomous] Browsing ${result.site}: ${result.title}`)
        return
      }
    }

    // Fallback: no browser available — use generic idle labels, NOT fake browsing
    const idleLabels = [
      'scrolling on my phone', 'reading articles', 'looking at memes',
    ]
    const label = idleLabels[Math.floor(Math.random() * idleLabels.length)]

    this.config.activityManager.startActivity(
      { type: 'idle', label },
      durationMs
    )

    console.log(`[Autonomous] ${label} (no browser)`)
  }

  /**
   * Simulate playing a game (e.g., League of Legends for Kaia).
   * Opens a gaming-related page in the browser if available.
   */
  private async playGame(): Promise<void> {
    const slot = this.config.activityManager.getCurrentRoutineSlot()
    const gamingActivity = slot?.activities.find(a => a.type === 'gaming')
    const label = gamingActivity?.label ?? 'playing a game'

    // Randomized duration: 15-40 minutes (gaming sessions are longer)
    const durationMs = (15 + Math.random() * 25) * 60 * 1000

    // Map game labels to relevant browser pages
    const gamingSites: Record<string, string[]> = {
      'league': ['https://www.op.gg', 'https://www.twitch.tv/directory/game/League%20of%20Legends'],
      'valorant': ['https://tracker.gg/valorant', 'https://www.twitch.tv/directory/game/VALORANT'],
      'genshin': ['https://genshin-impact.fandom.com', 'https://www.twitch.tv/directory/game/Genshin%20Impact'],
    }

    // Try to open a gaming-related page in the browser
    let activityTitle = `Gaming: ${label}`
    if (this.config.browserAgent) {
      if (!this.config.browserAgent.isAvailable()) {
        await this.config.browserAgent.tryRecoverPage()
      }
      if (this.config.browserAgent.isAvailable()) {
        // Find a matching gaming site from the label
        const lowerLabel = label.toLowerCase()
        let sites: string[] = []
        for (const [key, urls] of Object.entries(gamingSites)) {
          if (lowerLabel.includes(key)) { sites = urls; break }
        }
        // Fallback: search Twitch for the game
        if (sites.length === 0) {
          sites = [`https://www.twitch.tv/directory/game/${encodeURIComponent(label)}`]
        }
        const url = sites[Math.floor(Math.random() * sites.length)]
        const result = await this.config.browserAgent.watchYouTube(label + ' gameplay')
        if (result) {
          activityTitle = result.title
        }
      }
    }

    this.config.activityManager.startActivity(
      { type: 'browsing', title: activityTitle },
      durationMs
    )

    await this.config.engine.getMemory().logEpisode({
      type: 'event',
      title: `Gaming: ${label}`,
      description: label,
      timestamp: Date.now(),
    })

    // 30% chance she reaches out about the game
    if (Math.random() < 0.3) {
      await this.sendIfAppropriate({
        type: 'random_thought',
        data: { recentActivity: label, recentTopics: '' },
      })
    }

    console.log(`[Autonomous] Gaming: ${activityTitle}`)
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

/**
 * Parse a YouTube Music browser page title into track and artist.
 * YouTube Music titles typically follow the pattern: "Track Name - Artist - YouTube Music"
 * or just "Track Name - YouTube Music" when the full metadata isn't in the title.
 */
function parseBrowserMusicTitle(pageTitle: string): { track: string; artist?: string } {
  debugLog(`[parseBrowserMusicTitle] input: "${pageTitle}"`)

  // Remove the " - YouTube Music" suffix (or " - YouTube")
  const cleaned = pageTitle
    .replace(/\s*-\s*YouTube Music\s*$/i, '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .trim()

  debugLog(`[parseBrowserMusicTitle] after suffix removal: "${cleaned}"`)

  if (!cleaned) {
    debugLog(`[parseBrowserMusicTitle] cleaned is empty, returning original title as track`)
    return { track: pageTitle }
  }

  // YouTube Music typically formats as "Track - Artist"
  // Split on " - " (with spaces) to avoid splitting on hyphens within names
  const parts = cleaned.split(/\s+-\s+/)

  if (parts.length >= 2) {
    const result = {
      track: parts[0].trim(),
      artist: parts[1].trim(),
    }
    debugLog(`[parseBrowserMusicTitle] parsed: track="${result.track}", artist="${result.artist}"`)
    return result
  }

  // Could not parse artist — return the whole cleaned title as the track name
  debugLog(`[parseBrowserMusicTitle] no separator found, returning full cleaned title as track: "${cleaned}"`)
  return { track: cleaned }
}
