/**
 * Autonomous Behavior Scheduler
 *
 * Manages the character's "life" — when she listens to music,
 * watches dramas, browses the web, and proactively reaches out.
 *
 * Activities update Discord Rich Presence in real time and can
 * optionally open real browser windows via Playwright.
 *
 * All timings respect quiet hours (don't disturb while user sleeps).
 * Runs as a set of cron jobs alongside the main bridge process.
 */

import * as cron from 'node-cron'
import { ConversationEngine, ProactiveTrigger } from '@openlove/core'
import { MusicEngine } from './music.js'
import { DramaEngine } from './drama.js'
import { ActivityManager } from './activities.js'
import { BrowserAgent } from './browser.js'

export interface SchedulerConfig {
  engine: ConversationEngine
  music: MusicEngine
  drama: DramaEngine
  activityManager: ActivityManager
  browserAgent?: BrowserAgent
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

  constructor(config: SchedulerConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    console.log('[Autonomous] Scheduler starting...')

    // Launch browser if available
    if (this.config.browserAgent) {
      const launched = await this.config.browserAgent.launch()
      if (launched) {
        console.log('[Autonomous] Browser agent ready — real browser automation enabled')
      } else {
        console.log('[Autonomous] Browser agent unavailable — presence-only mode')
      }
    }

    // Morning greeting — 8:30 AM
    this.jobs.push(
      cron.schedule('30 8 * * *', () => this.morningGreeting())
    )

    // Music listening — twice a day (lunch & evening)
    this.jobs.push(
      cron.schedule('0 12 * * *', () => this.listenToMusic())
    )
    this.jobs.push(
      cron.schedule('0 20 * * *', () => this.listenToMusic())
    )

    // Drama watching — evening (9 PM)
    this.jobs.push(
      cron.schedule('0 21 * * *', () => this.watchDrama())
    )

    // Random YouTube browsing — mid-morning and afternoon
    this.jobs.push(
      cron.schedule('30 10 * * *', () => this.browseYouTube())
    )
    this.jobs.push(
      cron.schedule('30 15 * * *', () => this.browseYouTube())
    )

    // Random web browsing — a few times a day
    this.jobs.push(
      cron.schedule('0 11 * * *', () => this.browseRandom())
    )
    this.jobs.push(
      cron.schedule('0 14 * * *', () => this.browseRandom())
    )
    this.jobs.push(
      cron.schedule('0 17 * * *', () => this.browseRandom())
    )

    // Random thoughts throughout the day — every 2 hours during active hours
    this.jobs.push(
      cron.schedule('0 */2 9-22 * * *', () => this.maybeRandomThought())
    )

    // Check if she should reach out (if been too long since last contact)
    this.jobs.push(
      cron.schedule('*/30 * * * *', () => this.checkMissingUser())
    )

    console.log('[Autonomous] Scheduler started. She has a life now ✨')
  }

  async stop(): Promise<void> {
    for (const job of this.jobs) {
      job.stop()
    }
    this.jobs = []

    // Close browser
    if (this.config.browserAgent) {
      await this.config.browserAgent.close()
    }

    console.log('[Autonomous] Scheduler stopped')
  }

  private isQuietHours(): boolean {
    const hour = new Date().getHours()
    const start = this.config.quietHoursStart ?? 23
    const end = this.config.quietHoursEnd ?? 8

    if (start > end) {
      // E.g., quiet from 23 to 8 (overnight)
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

  private async listenToMusic(): Promise<void> {
    try {
      const track = await this.config.music.listenToSomething()

      // Update presence — "Listening to X by Y"
      this.config.activityManager.startActivity(
        {
          type: 'listening',
          track: track.track,
          artist: track.artist,
          album: track.album,
        },
        3 * 60 * 1000 // 3 minutes
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

      // 60% chance she shares it with you
      if (Math.random() < 0.6) {
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

      // Update presence — "Watching X"
      this.config.activityManager.startActivity(
        {
          type: 'watching',
          title: episode.showName,
          details: `S${episode.season}E${episode.episode}`,
        },
        25 * 60 * 1000 // 25 minutes
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

      // 70% chance she reaches out to talk about it
      if (Math.random() < 0.7) {
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

  /**
   * Browse YouTube for something related to the character's interests.
   */
  private async browseYouTube(): Promise<void> {
    if (this.isQuietHours()) return

    const topics = [
      'cute cat videos', 'cooking recipes', 'music videos',
      'fashion haul', 'travel vlog', 'study with me',
      'asmr', 'makeup tutorial', 'room tour', 'day in my life vlog',
      'aesthetic cafe vlog', 'k-drama highlights', 'anime openings',
    ]
    const topic = topics[Math.floor(Math.random() * topics.length)]

    // Update presence
    this.config.activityManager.startActivity(
      { type: 'browsing', title: `YouTube: ${topic}` },
      10 * 60 * 1000 // 10 minutes
    )

    // Open in real browser if available
    if (this.config.browserAgent?.isAvailable()) {
      await this.config.browserAgent.watchYouTube(topic)
    }

    // Log to memory
    await this.config.engine.getMemory().logEpisode({
      type: 'event',
      title: `Watched YouTube videos about ${topic}`,
      description: `Found some interesting ${topic} content on YouTube.`,
      timestamp: Date.now(),
    })

    console.log(`[Autonomous] Browsing YouTube: ${topic}`)
  }

  /**
   * Browse random websites — simulate scrolling social media, reading articles, etc.
   */
  private async browseRandom(): Promise<void> {
    if (this.isQuietHours()) return

    const activities = [
      { title: 'scrolling Twitter', label: 'Twitter' },
      { title: 'reading articles', label: 'the news' },
      { title: 'shopping online', label: 'online shopping' },
      { title: 'scrolling Pinterest', label: 'Pinterest' },
      { title: 'reading Reddit', label: 'Reddit' },
      { title: 'looking at memes', label: 'memes' },
    ]
    const activity = activities[Math.floor(Math.random() * activities.length)]

    // Update presence
    this.config.activityManager.startActivity(
      { type: 'browsing', title: activity.title },
      8 * 60 * 1000 // 8 minutes
    )

    // Open in real browser if available
    if (this.config.browserAgent?.isAvailable()) {
      await this.config.browserAgent.browseRandom()
    }

    // Log to memory
    await this.config.engine.getMemory().logEpisode({
      type: 'event',
      title: `Was ${activity.title}`,
      description: `Spent some time ${activity.title}.`,
      timestamp: Date.now(),
    })

    console.log(`[Autonomous] ${activity.title}`)
  }

  private async maybeRandomThought(): Promise<void> {
    // Only about 20% chance each check — keeps it from being too frequent
    if (Math.random() > 0.2) return
    await this.sendIfAppropriate({ type: 'random_thought' })
  }

  private async checkMissingUser(): Promise<void> {
    const maxGapMs = (this.config.maxIntervalMinutes ?? 240) * 60 * 1000
    const timeSinceLastMessage = Date.now() - this.lastProactiveMessage

    if (timeSinceLastMessage > maxGapMs && !this.isQuietHours()) {
      await this.sendIfAppropriate({ type: 'missing_you' })
    }
  }
}
