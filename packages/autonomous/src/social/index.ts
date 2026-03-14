/**
 * Social Media Engine
 *
 * Manages the AI character's social media presence.
 * Supports posting to Twitter/X via:
 *   1. OAuth 2.0 PKCE (Bearer token) — recommended for Free tier
 *   2. OAuth 1.0a (HMAC-SHA1) — for Basic/Pro tier
 *   3. goat-x scraper (username/password) — fallback, may break
 *
 * The AI generates posts based on its activities, thoughts, and personality,
 * then posts them through the configured platform clients.
 */

import { createHmac, randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { uploadImageToTwitter, uploadVideoToTwitter } from './twitter-media.js'

export interface SocialConfig {
  twitter?: TwitterConfig
  /** How often to post (minimum minutes between posts) */
  minPostIntervalMinutes?: number
  /** Whether to auto-post or queue for approval */
  autoPost?: boolean
}

export interface TwitterConfig {
  /** OAuth 2.0 Client ID */
  clientId?: string
  /** OAuth 2.0 Client Secret */
  clientSecret?: string
  /** Path to OAuth 2.0 token file (contains access_token + refresh_token) */
  oauth2TokenFile?: string
  /** OAuth 1.0a API Key (Consumer Key) */
  apiKey?: string
  /** OAuth 1.0a API Secret (Consumer Secret) */
  apiSecret?: string
  /** OAuth 1.0a Access Token */
  accessToken?: string
  /** OAuth 1.0a Access Token Secret */
  accessTokenSecret?: string
  /** Twitter username (without @) — for scraper fallback */
  username?: string
  /** Twitter password — for scraper fallback */
  password?: string
  /** Twitter email — for scraper fallback login verification */
  email?: string
  /** Path to store cookies for session persistence (scraper mode) */
  cookiePath?: string
}

export interface SocialPost {
  platform: 'twitter' | 'instagram' | 'xiaohongshu'
  content: string
  mediaUrls?: string[]
  timestamp: number
  status: 'pending' | 'posted' | 'failed'
  postId?: string
  error?: string
}

/**
 * Social media posting engine.
 *
 * Priority: OAuth 2.0 PKCE > OAuth 1.0a API v2 > goat-x scraper
 *
 * Usage:
 *   1. Configure OAuth 2.0 (recommended): run `node test-twitter-oauth2.mjs` to authorize
 *   2. Or configure OAuth 1.0a keys in .env (Basic/Pro tier only)
 *   3. Or install goat-x for scraper mode: pnpm add goat-x
 *   4. The autonomous scheduler calls post() to publish content
 */
export class SocialEngine {
  private config: SocialConfig
  private lastPostTime: number = 0
  private twitterMode: 'oauth2' | 'api' | 'scraper' | 'none' = 'none'
  private twitterClient: any = null
  private twitterReady: boolean = false
  private postHistory: SocialPost[] = []
  private oauth2AccessToken: string | null = null

  constructor(config: SocialConfig) {
    this.config = config
  }

  /**
   * Initialize platform clients. Call once on startup.
   */
  async initialize(): Promise<void> {
    if (this.config.twitter) {
      await this.initializeTwitter()
    }
  }

  private async initializeTwitter(): Promise<void> {
    const tc = this.config.twitter
    if (!tc) return

    // Priority 1: OAuth 2.0 PKCE (Bearer token — works on Free tier)
    if (tc.clientId && tc.clientSecret && tc.oauth2TokenFile) {
      try {
        const token = await this.loadAndRefreshOAuth2Token(tc)
        if (token) {
          this.oauth2AccessToken = token
          // Verify with /2/users/me
          const resp = await this.oauth2ApiRequest('GET', 'https://api.twitter.com/2/users/me')
          if (resp?.data?.username) {
            this.twitterMode = 'oauth2'
            this.twitterReady = true
            console.log(`[Social/Twitter] OAuth 2.0 ready — logged in as @${resp.data.username}`)
            return
          }
        }
      } catch (err) {
        console.warn('[Social/Twitter] OAuth 2.0 auth failed:', (err as Error).message)
        console.warn('[Social/Twitter] Run `node test-twitter-oauth2.mjs` to re-authorize')
      }
    }

    // Priority 2: OAuth 1.0a API v2 (Basic/Pro tier)
    if (tc.apiKey && tc.apiSecret && tc.accessToken && tc.accessTokenSecret) {
      try {
        const resp = await this.twitterApiRequest(
          'GET',
          'https://api.twitter.com/2/users/me',
          tc
        )
        if (resp.data?.username) {
          this.twitterMode = 'api'
          this.twitterReady = true
          console.log(`[Social/Twitter] API v2 (OAuth 1.0a) ready — logged in as @${resp.data.username}`)
          return
        }
      } catch (err) {
        console.warn('[Social/Twitter] OAuth 1.0a auth failed:', (err as Error).message)
      }
    }

    // Priority 3: goat-x scraper (username/password)
    if (tc.username && tc.password) {
      try {
        const { Scraper } = await import('goat-x')
        this.twitterClient = new Scraper()
        await this.twitterClient.login(tc.username, tc.password, tc.email)

        if (await this.twitterClient.isLoggedIn()) {
          this.twitterMode = 'scraper'
          this.twitterReady = true
          console.log(`[Social/Twitter] Scraper mode — logged in as @${tc.username}`)

          if (tc.cookiePath) {
            try {
              const cookies = await this.twitterClient.getCookies()
              writeFileSync(tc.cookiePath, JSON.stringify(cookies))
            } catch { /* non-critical */ }
          }
          return
        }
        console.warn('[Social/Twitter] Scraper login failed — check credentials')
      } catch (err) {
        const msg = (err as Error).message ?? ''
        if (msg.includes("Cannot find module") || (err as any).code === 'ERR_MODULE_NOT_FOUND') {
          console.log('[Social/Twitter] goat-x not installed — scraper mode unavailable')
        } else {
          console.warn('[Social/Twitter] Scraper init error:', msg)
        }
      }
    }

    if (!this.twitterReady) {
      console.log('[Social/Twitter] No working auth method — Twitter posting disabled')
      console.log('[Social/Twitter] Recommended: run `node test-twitter-oauth2.mjs` for OAuth 2.0 setup')
    }
  }

  /**
   * Load OAuth 2.0 tokens from file and refresh if needed.
   */
  private async loadAndRefreshOAuth2Token(tc: TwitterConfig): Promise<string | null> {
    const tokenFile = tc.oauth2TokenFile!
    if (!existsSync(tokenFile)) {
      console.log('[Social/Twitter] OAuth 2.0 token file not found — run test-twitter-oauth2.mjs first')
      return null
    }

    const saved = JSON.parse(readFileSync(tokenFile, 'utf-8'))
    if (!saved.refresh_token) {
      console.log('[Social/Twitter] No refresh_token in token file')
      return null
    }

    // Check if current token has media.write scope
    const currentScope = saved.scope ?? ''
    if (!currentScope.includes('media.write')) {
      console.warn('[Social/Twitter] ⚠️ Token missing "media.write" scope — image/video uploads will fail!')
      console.warn('[Social/Twitter] Re-run `node test-twitter-oauth2.mjs` to re-authorize with media upload permission')
    }

    // Refresh the token
    const basicAuth = Buffer.from(`${tc.clientId}:${tc.clientSecret}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: saved.refresh_token,
      client_id: tc.clientId!,
    })

    const refreshed = await this.httpsPost(
      'https://api.twitter.com/2/oauth2/token',
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body.toString()
    )

    if (refreshed.access_token) {
      // Save new tokens (immutable — write new file, don't mutate)
      writeFileSync(tokenFile, JSON.stringify(refreshed, null, 2))
      return refreshed.access_token
    }

    console.warn('[Social/Twitter] Token refresh failed:', JSON.stringify(refreshed))
    return null
  }

  /**
   * Check if any platform is ready for posting.
   */
  isReady(): boolean {
    return this.twitterReady
  }

  /**
   * Post content to all configured platforms.
   * Supports optional media (image or video).
   */
  async post(
    content: string,
    options?: { mediaBuffer?: Buffer; mediaType?: 'image' | 'video' }
  ): Promise<SocialPost[]> {
    const minInterval = (this.config.minPostIntervalMinutes ?? 60) * 60 * 1000
    if (Date.now() - this.lastPostTime < minInterval) {
      console.log('[Social] Too soon since last post — skipping')
      return []
    }

    const results: SocialPost[] = []

    if (this.twitterReady) {
      const result = await this.postToTwitter(content, options)
      results.push(result)
    }

    if (results.some(r => r.status === 'posted')) {
      this.lastPostTime = Date.now()
    }

    this.postHistory.push(...results)
    return results
  }

  /**
   * Get the current OAuth 2.0 access token (for media upload).
   */
  getOAuth2Token(): string | null {
    return this.oauth2AccessToken
  }

  private async postToTwitter(
    content: string,
    options?: { mediaBuffer?: Buffer; mediaType?: 'image' | 'video' }
  ): Promise<SocialPost> {
    const post: SocialPost = {
      platform: 'twitter',
      content,
      timestamp: Date.now(),
      status: 'pending',
    }

    try {
      // Upload media first if provided
      let mediaIds: string[] = []
      if (options?.mediaBuffer) {
        const sizeKB = (options.mediaBuffer.length / 1024).toFixed(1)
        console.log(`[Social/Twitter] Uploading ${options.mediaType ?? 'image'} (${sizeKB} KB) via ${this.twitterMode}...`)

        if (this.twitterMode === 'oauth2' && this.oauth2AccessToken) {
          const uploadResult = options.mediaType === 'video'
            ? await uploadVideoToTwitter(options.mediaBuffer, this.oauth2AccessToken)
            : await uploadImageToTwitter(options.mediaBuffer, this.oauth2AccessToken)

          if (uploadResult.success) {
            mediaIds = [uploadResult.mediaId]
            console.log(`[Social/Twitter] Media uploaded: ${uploadResult.mediaId}`)
          } else {
            console.error(`[Social/Twitter] Media upload FAILED: ${uploadResult.error}`)
            console.error('[Social/Twitter] Posting text-only as fallback. If this persists:')
            console.error('[Social/Twitter]   1. Re-run `node test-twitter-oauth2.mjs` to re-authorize with media.write scope')
            console.error('[Social/Twitter]   2. Check your Twitter API tier supports media upload')
          }
        } else {
          console.warn(`[Social/Twitter] Media upload not supported in ${this.twitterMode} mode — posting text-only`)
        }
      }

      // Build tweet body
      const tweetBody: Record<string, any> = { text: content }
      if (mediaIds.length > 0) {
        tweetBody.media = { media_ids: mediaIds }
      }

      if (this.twitterMode === 'oauth2') {
        const resp = await this.oauth2ApiRequest(
          'POST',
          'https://api.twitter.com/2/tweets',
          JSON.stringify(tweetBody)
        )
        if (resp?.data?.id) {
          post.status = 'posted'
          post.postId = resp.data.id
          const mediaTag = mediaIds.length > 0 ? ` [+${options?.mediaType}]` : ''
          console.log(`[Social/Twitter] Posted via OAuth 2.0${mediaTag}: "${content.slice(0, 50)}..." (id: ${resp.data.id})`)
        } else {
          throw new Error(JSON.stringify(resp))
        }
      } else if (this.twitterMode === 'api') {
        const resp = await this.twitterApiRequest(
          'POST',
          'https://api.twitter.com/2/tweets',
          this.config.twitter!,
          JSON.stringify(tweetBody)
        )
        if (resp.data?.id) {
          post.status = 'posted'
          post.postId = resp.data.id
          console.log(`[Social/Twitter] Posted via API v2: "${content.slice(0, 50)}..." (id: ${resp.data.id})`)
        } else {
          throw new Error(JSON.stringify(resp))
        }
      } else if (this.twitterMode === 'scraper') {
        await this.twitterClient.sendTweet(content)
        post.status = 'posted'
        console.log(`[Social/Twitter] Posted via scraper: "${content.slice(0, 50)}..."`)
      }
    } catch (err) {
      post.status = 'failed'
      post.error = err instanceof Error ? err.message : String(err)
      console.error('[Social/Twitter] Post failed:', post.error)
    }

    return post
  }

  /**
   * OAuth 2.0 Bearer token API request.
   */
  private async oauth2ApiRequest(
    method: string,
    url: string,
    body?: string
  ): Promise<any> {
    if (!this.oauth2AccessToken) {
      throw new Error('No OAuth 2.0 access token available')
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.oauth2AccessToken}`,
      'Content-Type': 'application/json',
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`API error ${resp.status}: ${text}`)
    }

    return resp.json()
  }

  /**
   * Twitter API v2 request with OAuth 1.0a signature.
   */
  private async twitterApiRequest(
    method: string,
    url: string,
    creds: TwitterConfig,
    body?: string
  ): Promise<any> {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: creds.apiKey!,
      oauth_nonce: randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: creds.accessToken!,
      oauth_version: '1.0',
    }

    // Build signature base string
    const paramString = Object.keys(oauthParams)
      .sort()
      .map(k => `${encodeRFC3986(k)}=${encodeRFC3986(oauthParams[k])}`)
      .join('&')

    const baseString = [
      method.toUpperCase(),
      encodeRFC3986(url),
      encodeRFC3986(paramString),
    ].join('&')

    const signingKey = `${encodeRFC3986(creds.apiSecret!)}&${encodeRFC3986(creds.accessTokenSecret!)}`
    const signature = createHmac('sha1', signingKey).update(baseString).digest('base64')
    oauthParams.oauth_signature = signature

    // Build Authorization header
    const authHeader = 'OAuth ' + Object.keys(oauthParams)
      .sort()
      .map(k => `${encodeRFC3986(k)}="${encodeRFC3986(oauthParams[k])}"`)
      .join(', ')

    const headers: Record<string, string> = {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`API error ${resp.status}: ${text}`)
    }

    return resp.json()
  }

  /**
   * HTTPS POST helper for token refresh (uses global fetch).
   */
  private async httpsPost(url: string, headers: Record<string, string>, body: string): Promise<any> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    })
    const text = await resp.text()
    try { return JSON.parse(text) } catch { return text }
  }

  /**
   * Get recent post history.
   */
  getPostHistory(limit = 20): SocialPost[] {
    return this.postHistory.slice(-limit)
  }
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent) */
function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}
