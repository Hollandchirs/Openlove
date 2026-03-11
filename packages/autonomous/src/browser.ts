/**
 * Browser Agent
 *
 * Uses Playwright to simulate the AI character "living" on the computer.
 * Opens real browser windows to watch YouTube, listen to Spotify, browse the web.
 *
 * Falls back gracefully if Playwright is not installed — activities still
 * update Discord presence even without a real browser.
 */

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
type Page = Awaited<ReturnType<Browser['newPage']>>

export class BrowserAgent {
  private browser?: Browser
  private page?: Page
  private available = false

  /**
   * Launch the browser. Call once on startup.
   * Returns false if Playwright is unavailable.
   */
  async launch(): Promise<boolean> {
    const pw = await loadPlaywright()
    if (!pw) {
      this.available = false
      return false
    }

    try {
      this.browser = await pw.chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      this.page = await this.browser.newPage()
      this.available = true
      console.log('[Browser] Chromium launched successfully')
      return true
    } catch (err) {
      console.error('[Browser] Failed to launch browser:', err)
      this.available = false
      return false
    }
  }

  isAvailable(): boolean {
    return this.available && !!this.page
  }

  /**
   * Open YouTube and search for / watch a video.
   */
  async watchYouTube(query: string): Promise<{ title: string; url: string } | null> {
    if (!this.page) return null

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

      // Wait for video results to load, then click first one
      await this.page.waitForSelector('ytd-video-renderer', { timeout: 10000 })
      const firstVideo = this.page.locator('ytd-video-renderer a#thumbnail').first()
      await firstVideo.click()

      // Wait for video page to load
      await this.page.waitForLoadState('domcontentloaded')
      const title = await this.page.title()
      const url = this.page.url()

      console.log(`[Browser] Watching YouTube: ${title}`)
      return { title: title.replace(' - YouTube', ''), url }
    } catch (err) {
      console.error('[Browser] YouTube error:', err)
      return null
    }
  }

  /**
   * Open Spotify Web Player and search for a track.
   */
  async listenToSpotify(query: string): Promise<{ title: string } | null> {
    if (!this.page) return null

    try {
      const url = `https://open.spotify.com/search/${encodeURIComponent(query)}`
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })

      const title = await this.page.title()
      console.log(`[Browser] Opened Spotify: ${query}`)
      return { title }
    } catch (err) {
      console.error('[Browser] Spotify error:', err)
      return null
    }
  }

  /**
   * Browse a generic URL.
   */
  async browseWeb(url: string): Promise<{ title: string } | null> {
    if (!this.page) return null

    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const title = await this.page.title()
      console.log(`[Browser] Browsing: ${title}`)
      return { title }
    } catch (err) {
      console.error('[Browser] Browse error:', err)
      return null
    }
  }

  /**
   * Browse a random website from a curated list of activities.
   */
  async browseRandom(): Promise<{ title: string; site: string } | null> {
    const sites = [
      { url: 'https://www.pinterest.com', site: 'Pinterest' },
      { url: 'https://twitter.com/explore', site: 'Twitter' },
      { url: 'https://www.reddit.com/r/popular', site: 'Reddit' },
      { url: 'https://www.instagram.com/explore', site: 'Instagram' },
      { url: 'https://www.tiktok.com', site: 'TikTok' },
      { url: 'https://news.ycombinator.com', site: 'Hacker News' },
    ]

    const pick = sites[Math.floor(Math.random() * sites.length)]
    const result = await this.browseWeb(pick.url)
    if (result) {
      return { title: result.title, site: pick.site }
    }
    return null
  }

  /**
   * Close the browser. Call on shutdown.
   */
  async close(): Promise<void> {
    try {
      await this.browser?.close()
      this.browser = undefined
      this.page = undefined
      this.available = false
      console.log('[Browser] Closed')
    } catch {
      // Ignore close errors
    }
  }
}
