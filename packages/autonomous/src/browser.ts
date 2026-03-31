/**
 * Browser Agent
 *
 * Uses Playwright to simulate the AI character "living" on the computer.
 * Opens real browser windows to watch YouTube, listen to YouTube Music, browse the web.
 *
 * Three launch modes (in priority order):
 *   1. CDP — connect to user's running Chrome (has real login sessions)
 *      Start Chrome with: chrome --remote-debugging-port=9222
 *   2. Persistent Profile — launch Chromium with a dedicated profile directory
 *      Cookies/logins survive restarts. User logs in once, stays logged in.
 *   3. Fresh Chromium — launch isolated Chromium (no cookies, original behavior)
 *
 * Falls back gracefully if Playwright is not installed — activities still
 * update Discord presence even without a real browser.
 *
 * Stability features:
 *   - Page lifecycle monitoring (crash, close, disconnect detection)
 *   - Automatic page recovery on failure
 *   - Health-checked isAvailable() with real connectivity test
 *   - Consecutive failure tracking with circuit breaker
 *   - Increased navigation timeouts (30s) for real-world sites
 */

import { join } from 'path'
import { mkdirSync, appendFileSync } from 'fs'

function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  console.log(msg)
  try { appendFileSync('/tmp/opencrush-debug.log', line) } catch { /* ignore */ }
}

let playwright: typeof import('playwright') | null = null

// Dynamic import — Playwright is optional
async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  if (playwright) return playwright
  try {
    playwright = await import('playwright')
    return playwright
  } catch {
    console.warn('[Browser] Playwright not installed — browser automation disabled. Install with: npx playwright install chromium')
    return null
  }
}

type Browser = Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>>
type BrowserContext = Awaited<ReturnType<typeof import('playwright')['chromium']['launchPersistentContext']>>
type Page = Awaited<ReturnType<Browser['newPage']>>

export type BrowserMode = 'cdp' | 'persistent' | 'fresh' | 'chrome'

/** Navigation timeout — 30s is more realistic for social media sites */
const NAV_TIMEOUT = 30_000

/** Max consecutive failures before circuit breaker disables browser */
const MAX_CONSECUTIVE_FAILURES = 5

export interface BrowserConfig {
  /** Launch mode: 'cdp' | 'persistent' | 'fresh' | 'chrome' (default: auto-detect) */
  mode?: BrowserMode
  /** CDP endpoint URL for connecting to user's Chrome (default: http://localhost:9222) */
  cdpEndpoint?: string
  /** Profile directory for persistent mode (default: ~/.opencrush/chrome-profile) */
  profileDir?: string
  /** Whether to run headless (default: false) */
  headless?: boolean
}

export class BrowserAgent {
  private browser?: Browser
  private context?: BrowserContext
  private page?: Page
  private available = false
  private config: BrowserConfig
  private mode: BrowserMode = 'fresh'

  /** Tracks consecutive navigation failures for circuit breaker */
  private consecutiveFailures = 0
  /** True when page has been detected as dead (crash/close/disconnect) */
  private pageIsDead = false
  /** Last known good page info — updated on every successful navigation */
  private lastPageInfo: { title: string; url: string; site?: string } | null = null

  constructor(config: BrowserConfig = {}) {
    this.config = config
  }

  /**
   * Launch the browser. Tries modes in order: CDP → Persistent → Fresh.
   * Returns false if Playwright is unavailable.
   */
  async launch(): Promise<boolean> {
    const pw = await loadPlaywright()
    if (!pw) {
      this.available = false
      return false
    }

    const requestedMode = this.config.mode

    // Try Chrome mode — launches real Google Chrome with a separate profile
    if (requestedMode === 'chrome') {
      const chromeSuccess = await this.tryLaunchChrome(pw)
      if (chromeSuccess) return true
      console.warn('[Browser] Chrome mode failed — falling back to persistent')
      return this.tryLaunchPersistent(pw)
    }

    // Try CDP first (if requested or auto-detect)
    if (!requestedMode || requestedMode === 'cdp') {
      const cdpSuccess = await this.tryLaunchCDP(pw)
      if (cdpSuccess) return true
      if (requestedMode === 'cdp') {
        console.warn('[Browser] CDP mode requested but failed — no fallback')
        return false
      }
    }

    // Try persistent profile (if requested or auto-detect)
    if (!requestedMode || requestedMode === 'persistent') {
      const persistentSuccess = await this.tryLaunchPersistent(pw)
      if (persistentSuccess) return true
      if (requestedMode === 'persistent') {
        console.warn('[Browser] Persistent mode requested but failed — no fallback')
        return false
      }
    }

    // Fall back to fresh Chromium
    return this.tryLaunchFresh(pw)
  }

  /**
   * Attach lifecycle event handlers to detect page crashes and disconnects.
   * When a page dies, we mark it immediately so isAvailable() returns false.
   */
  private attachPageLifecycleHandlers(): void {
    if (!this.page) return

    this.page.on('close', () => {
      console.warn('[Browser] Page closed unexpectedly')
      this.markPageDead()
    })

    this.page.on('crash', () => {
      console.error('[Browser] Page crashed!')
      this.markPageDead()
    })

    // Monitor browser-level disconnect
    if (this.browser) {
      this.browser.on('disconnected', () => {
        console.error('[Browser] Browser disconnected!')
        this.markPageDead()
      })
    }
    if (this.context) {
      this.context.on('close', () => {
        console.warn('[Browser] Browser context closed')
        this.markPageDead()
      })
    }
  }

  private markPageDead(): void {
    this.pageIsDead = true
    this.available = false
    this.page = undefined
  }

  /**
   * Try to recover from a dead page by creating a new one.
   * Returns true if recovery succeeded.
   */
  async tryRecoverPage(): Promise<boolean> {
    if (!this.pageIsDead) return true
    console.log('[Browser] Attempting page recovery...')

    try {
      if (this.mode === 'cdp' && this.browser) {
        const contexts = this.browser.contexts()
        if (contexts.length > 0) {
          this.page = await contexts[0].newPage()
        } else {
          this.page = await this.browser.newPage()
        }
      } else if (this.context) {
        this.page = await this.context.newPage()
      } else if (this.browser) {
        this.page = await this.browser.newPage()
      } else {
        // No browser/context — need full relaunch
        console.warn('[Browser] No browser instance — attempting full relaunch')
        const success = await this.launch()
        return success
      }

      this.pageIsDead = false
      this.available = true
      this.consecutiveFailures = 0
      this.attachPageLifecycleHandlers()
      console.log('[Browser] Page recovered successfully')
      return true
    } catch (err) {
      console.error('[Browser] Page recovery failed:', err)
      // Full relaunch as last resort
      try {
        const success = await this.launch()
        return success
      } catch {
        return false
      }
    }
  }

  /**
   * CDP mode: Connect to user's running Chrome instance.
   */
  private async tryLaunchCDP(pw: typeof import('playwright')): Promise<boolean> {
    const endpoint = this.config.cdpEndpoint ?? 'http://localhost:9222'
    try {
      this.browser = await pw.chromium.connectOverCDP(endpoint)
      const contexts = this.browser.contexts()
      if (contexts.length > 0) {
        this.page = await contexts[0].newPage()
      } else {
        this.page = await this.browser.newPage()
      }
      this.available = true
      this.pageIsDead = false
      this.consecutiveFailures = 0
      this.mode = 'cdp'
      this.attachPageLifecycleHandlers()
      console.log(`[Browser] Connected to Chrome via CDP (${endpoint}) — real login sessions available`)
      return true
    } catch {
      console.log('[Browser] CDP connection failed — Chrome not running with --remote-debugging-port=9222')
      return false
    }
  }

  /**
   * Persistent profile mode: Launch Chromium with a dedicated user data directory.
   */
  private async tryLaunchPersistent(pw: typeof import('playwright')): Promise<boolean> {
    const profileDir = this.config.profileDir
      ?? join(process.env.HOME ?? '/tmp', '.opencrush', 'chrome-profile')

    try {
      mkdirSync(profileDir, { recursive: true })

      this.context = await pw.chromium.launchPersistentContext(profileDir, {
        headless: this.config.headless ?? false,
        args: [
          '--disable-blink-features=AutomationControlled',
        ],
        viewport: { width: 1280, height: 800 },
        ignoreDefaultArgs: ['--enable-automation'],
      })
      this.page = this.context.pages()[0] ?? await this.context.newPage()
      this.available = true
      this.pageIsDead = false
      this.consecutiveFailures = 0
      this.mode = 'persistent'
      this.attachPageLifecycleHandlers()
      console.log(`[Browser] Launched with persistent profile at ${profileDir} — logins will be saved`)
      return true
    } catch (err) {
      console.error('[Browser] Persistent profile launch failed:', err)
      return false
    }
  }

  /**
   * Chrome mode: Launch the user's real Google Chrome with a dedicated profile.
   */
  private async tryLaunchChrome(pw: typeof import('playwright')): Promise<boolean> {
    const profileDir = this.config.profileDir
      ?? join(process.env.HOME ?? '/tmp', '.opencrush', 'chrome-profile')

    try {
      mkdirSync(profileDir, { recursive: true })

      this.context = await pw.chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: this.config.headless ?? false,
        args: [
          '--disable-blink-features=AutomationControlled',
        ],
        viewport: { width: 1280, height: 800 },
        ignoreDefaultArgs: ['--enable-automation'],
      })
      this.page = this.context.pages()[0] ?? await this.context.newPage()
      this.available = true
      this.pageIsDead = false
      this.consecutiveFailures = 0
      this.mode = 'chrome'
      this.attachPageLifecycleHandlers()
      console.log(`[Browser] Launched real Google Chrome with profile at ${profileDir}`)
      return true
    } catch (err) {
      console.error('[Browser] Chrome launch failed:', err)
      return false
    }
  }

  /**
   * Fresh Chromium: original behavior, isolated instance with no cookies.
   */
  private async tryLaunchFresh(pw: typeof import('playwright')): Promise<boolean> {
    try {
      this.browser = await pw.chromium.launch({
        headless: this.config.headless ?? false,
        args: ['--disable-blink-features=AutomationControlled'],
      })
      this.page = await this.browser.newPage()
      this.available = true
      this.pageIsDead = false
      this.consecutiveFailures = 0
      this.mode = 'fresh'
      this.attachPageLifecycleHandlers()
      console.log('[Browser] Launched fresh Chromium (no saved logins)')
      return true
    } catch (err) {
      console.error('[Browser] Failed to launch browser:', err)
      this.available = false
      return false
    }
  }

  /**
   * Health-checked availability: verifies page is actually alive,
   * not just that the reference exists in memory.
   */
  isAvailable(): boolean {
    if (this.pageIsDead) return false
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return false
    return this.available && !!this.page
  }

  getMode(): BrowserMode {
    return this.mode
  }

  /** Get the last known page info (updated on every successful navigation). */
  getLastPageInfo(): { title: string; url: string; site?: string } | null {
    return this.lastPageInfo
  }

  /** Reset the circuit breaker (called after successful recovery). */
  resetFailures(): void {
    this.consecutiveFailures = 0
  }

  /**
   * Safe navigation wrapper — handles errors, tracks failures, attempts recovery.
   * Returns the page title on success, null on failure.
   */
  private async safeNavigate(url: string): Promise<{ title: string } | null> {
    // Try to recover dead page before navigating
    if (this.pageIsDead) {
      const recovered = await this.tryRecoverPage()
      if (!recovered) return null
    }
    if (!this.page) return null

    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
      const title = await this.page.title()
      // Success — reset failure counter and update last known info
      this.consecutiveFailures = 0
      this.lastPageInfo = { title, url }
      return { title }
    } catch (err) {
      this.consecutiveFailures++
      const errMsg = err instanceof Error ? err.message : String(err)

      // Detect fatal errors that mean the page/browser is dead
      if (errMsg.includes('Target closed') || errMsg.includes('crashed') ||
          errMsg.includes('disconnected') || errMsg.includes('Session closed') ||
          errMsg.includes('handshake')) {
        console.error(`[Browser] Fatal navigation error (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg}`)
        this.markPageDead()
      } else {
        console.warn(`[Browser] Navigation failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg.slice(0, 120)}`)
      }

      // Circuit breaker
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error('[Browser] Circuit breaker tripped — disabling browser until recovery')
      }

      return null
    }
  }

  /**
   * Take a screenshot of the current page.
   */
  async takeScreenshot(): Promise<Buffer | null> {
    if (!this.page || this.pageIsDead) return null

    try {
      const buffer = await this.page.screenshot({ type: 'png' })
      console.log('[Browser] Screenshot taken')
      return Buffer.from(buffer)
    } catch (err) {
      console.error('[Browser] Screenshot error:', err)
      return null
    }
  }

  /**
   * Open YouTube and search for / watch a video.
   */
  async watchYouTube(query: string): Promise<{ title: string; url: string } | null> {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    const result = await this.safeNavigate(searchUrl)
    if (!result || !this.page) return null

    try {
      // Wait for video results to load, then click first one
      await this.page.waitForSelector('ytd-video-renderer', { timeout: 10000 })
      const firstVideo = this.page.locator('ytd-video-renderer a#thumbnail').first()
      await firstVideo.click()

      // Wait for video page to load
      await this.page.waitForLoadState('domcontentloaded')
      const title = await this.page.title()
      const url = this.page.url()
      const cleanTitle = title.replace(' - YouTube', '')

      this.lastPageInfo = { title: cleanTitle, url, site: 'YouTube' }
      console.log(`[Browser] Watching YouTube: ${cleanTitle}`)
      return { title: cleanTitle, url }
    } catch (err) {
      console.error('[Browser] YouTube error:', err)
      return null
    }
  }

  /**
   * Open YouTube Music and search for / play a track.
   */
  async listenToMusic(query: string): Promise<{ title: string } | null> {
    debugLog(`[Browser] listenToMusic called with query: "${query}"`)
    const searchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`
    const result = await this.safeNavigate(searchUrl)
    if (!result || !this.page) {
      debugLog(`[Browser] listenToMusic: safeNavigate failed or no page`)
      return null
    }

    try {
      // Try to click the first song result to start playback
      debugLog(`[Browser] listenToMusic: waiting for song results...`)
      await this.page.waitForSelector('ytmusic-responsive-list-item-renderer', { timeout: 10000 })
      const firstSong = this.page.locator('ytmusic-responsive-list-item-renderer').first()
      await firstSong.click()
      debugLog(`[Browser] listenToMusic: clicked first song result`)

      // Wait for the player to load and the page title to update.
      // YouTube Music takes 2-3 seconds to update the page title after playback starts.
      await this.page.waitForTimeout(3000)
      const title = await this.page.title()
      debugLog(`[Browser] listenToMusic: raw page title after 3s wait: "${title}"`)
      const cleanTitle = title.replace(/\s*-\s*YouTube Music\s*$/i, '').trim()
      debugLog(`[Browser] listenToMusic: cleaned title: "${cleanTitle}"`)

      const currentUrl = this.page.url()
      this.lastPageInfo = { title: cleanTitle, url: currentUrl, site: 'YouTube Music' }
      debugLog(`[Browser] Playing on YouTube Music: "${cleanTitle}" at ${currentUrl}`)
      return { title: cleanTitle }
    } catch (err) {
      // Navigation succeeded but clicking failed — still usable as a search page
      const errMsg = (err as Error).message
      debugLog(`[Browser] YouTube Music click failed: ${errMsg}`)
      console.warn('[Browser] YouTube Music click failed, staying on search results:', errMsg)
      this.lastPageInfo = { title: query, url: searchUrl, site: 'YouTube Music' }
      debugLog(`[Browser] Opened YouTube Music search: ${query}`)
      return { title: query }
    }
  }

  /**
   * Browse a generic URL.
   */
  async browseWeb(url: string): Promise<{ title: string } | null> {
    const result = await this.safeNavigate(url)
    if (result) {
      console.log(`[Browser] Browsing: ${result.title}`)
    }
    return result
  }

  /**
   * Browse a random website from a curated list of activities.
   * Accepts an optional character-specific site list; falls back to generic sites.
   */
  async browseRandom(
    characterSites?: Array<{ url: string; site: string }>
  ): Promise<{ title: string; site: string } | null> {
    const defaultSites = [
      { url: 'https://www.pinterest.com', site: 'Pinterest' },
      { url: 'https://twitter.com/explore', site: 'Twitter' },
      { url: 'https://www.reddit.com/r/popular', site: 'Reddit' },
      { url: 'https://www.instagram.com/explore', site: 'Instagram' },
      { url: 'https://www.tiktok.com', site: 'TikTok' },
      { url: 'https://news.ycombinator.com', site: 'Hacker News' },
      { url: 'https://www.bilibili.com', site: 'Bilibili' },
    ]
    const sites = (characterSites && characterSites.length > 0)
      ? characterSites
      : defaultSites

    const pick = sites[Math.floor(Math.random() * sites.length)]
    const result = await this.browseWeb(pick.url)
    if (result) {
      this.lastPageInfo = { title: result.title, url: pick.url, site: pick.site }
      return { title: result.title, site: pick.site }
    }
    return null
  }

  /**
   * Get current page title and URL (for context-aware features).
   * Returns null if page is dead or on about:blank.
   */
  async getCurrentPageInfo(): Promise<{ title: string; url: string } | null> {
    if (!this.page || this.pageIsDead) return this.lastPageInfo
    try {
      const title = await this.page.title()
      const url = this.page.url()
      if (!title || url === 'about:blank' || url === 'chrome://newtab/') {
        // Page is on blank — return last known info if we have it
        return this.lastPageInfo
      }
      this.lastPageInfo = { title, url }
      return { title, url }
    } catch {
      // Page might be dead — return last known info
      return this.lastPageInfo
    }
  }

  /**
   * Close the browser. Call on shutdown.
   * For CDP mode, only closes the page (not the user's Chrome).
   */
  async close(): Promise<void> {
    try {
      if (this.mode === 'cdp') {
        // Don't close user's Chrome — just close our page
        await this.page?.close()
      } else if (this.context) {
        await this.context.close()
      } else {
        await this.browser?.close()
      }
      this.browser = undefined
      this.context = undefined
      this.page = undefined
      this.available = false
      this.pageIsDead = true
      this.lastPageInfo = null
      console.log('[Browser] Closed')
    } catch {
      /* Ignore close errors — browser may already be closed */
    }
  }
}
