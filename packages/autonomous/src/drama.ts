/**
 * Drama/Content Tracking Module
 *
 * Simulates watching dramas, anime, or movies.
 * Uses TMDB API for real show data (episode descriptions, ratings).
 * When she "finishes" an episode, triggers a proactive message.
 *
 * Watch history is persisted to SQLite so progress survives restarts.
 */

import type Database from 'better-sqlite3'

export interface DramaConfig {
  tmdbApiKey?: string
  // Show preferences extracted from SOUL.md
  preferredGenres?: string[]
  preferredLanguages?: string[]
  /** Character-specific curated shows (replaces generic fallback list) */
  curatedShows?: EpisodeInfo[]
  // SQLite database for persistence (optional — falls back to in-memory)
  db?: Database.Database
}

export interface ShowProgress {
  showId: number
  showName: string
  currentSeason: number
  currentEpisode: number
  totalEpisodes?: number
  lastWatched: number
}

export interface EpisodeInfo {
  showName: string
  season: number
  episode: number
  episodeTitle?: string
  summary?: string
  airDate?: string
}

export class DramaEngine {
  private config: DramaConfig
  private watchHistory: Map<number, ShowProgress> = new Map()
  private db?: Database.Database

  constructor(config: DramaConfig) {
    this.config = config
    this.db = config.db

    if (this.db) {
      this.initSchema()
      this.loadFromDb()
    }
  }

  private initSchema(): void {
    this.db?.exec(`
      CREATE TABLE IF NOT EXISTS drama_progress (
        show_id       INTEGER PRIMARY KEY,
        show_name     TEXT NOT NULL,
        season        INTEGER NOT NULL,
        episode       INTEGER NOT NULL,
        total_episodes INTEGER,
        last_watched  INTEGER NOT NULL
      );
    `)
  }

  private loadFromDb(): void {
    if (!this.db) return
    const rows = this.db.prepare(`SELECT * FROM drama_progress`).all() as Array<{
      show_id: number; show_name: string; season: number;
      episode: number; total_episodes: number | null; last_watched: number
    }>
    for (const row of rows) {
      this.watchHistory.set(row.show_id, {
        showId: row.show_id,
        showName: row.show_name,
        currentSeason: row.season,
        currentEpisode: row.episode,
        totalEpisodes: row.total_episodes ?? undefined,
        lastWatched: row.last_watched,
      })
    }
    if (rows.length > 0) {
      console.log(`[Drama] Loaded ${rows.length} shows from database`)
    }
  }

  private persistProgress(progress: ShowProgress): void {
    if (!this.db) return
    this.db.prepare(`
      INSERT OR REPLACE INTO drama_progress (show_id, show_name, season, episode, total_episodes, last_watched)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      progress.showId, progress.showName, progress.currentSeason,
      progress.currentEpisode, progress.totalEpisodes ?? null, progress.lastWatched
    )
  }

  /**
   * Simulate watching an episode and return info about it.
   * Called by the scheduler during "drama time" slots.
   */
  async watchNextEpisode(): Promise<EpisodeInfo> {
    // Try to continue an in-progress show
    const inProgress = [...this.watchHistory.values()]
      .sort((a, b) => b.lastWatched - a.lastWatched)[0]

    if (inProgress) {
      const nextEpisode = inProgress.currentEpisode + 1
      const info = await this.getEpisodeInfo(
        inProgress.showId,
        inProgress.currentSeason,
        nextEpisode
      )

      if (info) {
        inProgress.currentEpisode = nextEpisode
        inProgress.lastWatched = Date.now()
        this.persistProgress(inProgress)
        return info
      }
    }

    // Start a new show
    return this.startNewShow()
  }

  private async getEpisodeInfo(
    showId: number,
    season: number,
    episode: number
  ): Promise<EpisodeInfo | null> {
    if (!this.config.tmdbApiKey) return null

    try {
      const response = await fetch(
        `https://api.themoviedb.org/3/tv/${showId}/season/${season}/episode/${episode}?api_key=${this.config.tmdbApiKey}`
      )

      if (!response.ok) return null

      const data = await response.json() as {
        name: string
        overview: string
        air_date: string
      }

      const showResp = await fetch(
        `https://api.themoviedb.org/3/tv/${showId}?api_key=${this.config.tmdbApiKey}`
      )
      const showData = await showResp.json() as { name: string }

      return {
        showName: showData.name,
        season,
        episode,
        episodeTitle: data.name,
        summary: data.overview?.slice(0, 200),
        airDate: data.air_date,
      }
    } catch (err) {
      console.warn('[Drama] Failed to fetch episode info:', (err as Error).message)
      return null
    }
  }

  private async startNewShow(): Promise<EpisodeInfo> {
    // Use character-specific curated shows if available
    const characterShows = this.config.curatedShows
    const genericShows: EpisodeInfo[] = [
      { showName: 'Crash Landing on You', season: 1, episode: 1, episodeTitle: 'Episode 1', summary: 'A South Korean heiress accidentally paraglides into North Korea and meets an army officer who tries to help her.' },
      { showName: 'My Demon', season: 1, episode: 1, episodeTitle: 'Episode 1', summary: 'A devil who lost his powers and a ruthless heiress are bound by a mysterious mark.' },
      { showName: 'Queen of Tears', season: 1, episode: 1, episodeTitle: 'Episode 1', summary: 'A powerful department store heiress and her husband face a marriage crisis and unexpected circumstances.' },
      { showName: 'Lovely Runner', season: 1, episode: 1, episodeTitle: 'Episode 1', summary: 'A fan travels back in time to save her idol from death and discovers time is complicated.' },
      { showName: 'Castlevania: Nocturne', season: 1, episode: 1, episodeTitle: 'Episode 1', summary: 'The son of a vampire hunter fights against a powerful villain in 18th-century France.' },
      { showName: 'Arcane', season: 2, episode: 1, episodeTitle: 'The Monster You Made', summary: 'The sisters are on a collision course that threatens to tear two cities apart.' },
      { showName: 'Only Murders in the Building', season: 3, episode: 1, episodeTitle: 'Showstopper', summary: 'An unexpected death during a Broadway musical\'s opening night kicks off a new mystery.' },
    ]
    const popularShows = (characterShows && characterShows.length > 0)
      ? characterShows
      : genericShows

    const show = popularShows[Math.floor(Math.random() * popularShows.length)]

    // Track this show with a stable ID based on name hash
    const showId = hashString(show.showName)
    const progress: ShowProgress = {
      showId,
      showName: show.showName,
      currentSeason: show.season,
      currentEpisode: show.episode,
      lastWatched: Date.now(),
    }
    this.watchHistory.set(showId, progress)
    this.persistProgress(progress)

    return show
  }

  loadProgress(progress: ShowProgress[]): void {
    for (const p of progress) {
      this.watchHistory.set(p.showId, p)
      this.persistProgress(p)
    }
  }

  getProgress(): ShowProgress[] {
    return [...this.watchHistory.values()]
  }
}

/** Simple string hash for generating stable show IDs */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}
