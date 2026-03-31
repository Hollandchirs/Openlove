/**
 * Music Awareness Module
 *
 * Fetches music recommendations from Spotify or Last.fm,
 * simulates "listening" activity, and prepares triggers for
 * proactive messages about what she's been enjoying.
 *
 * No Spotify key? Falls back to curated artist lists from SOUL.md.
 */

export interface MusicConfig {
  spotifyClientId?: string
  spotifyClientSecret?: string
  // Genres/artists parsed from SOUL.md to use as seeds
  seedArtists?: string[]
  seedGenres?: string[]
  /** Character-specific curated tracks (replaces generic fallback list) */
  curatedTracks?: TrackInfo[]
}

export interface TrackInfo {
  track: string
  artist: string
  album?: string
  previewUrl?: string
  emotion?: 'happy' | 'melancholic' | 'energetic' | 'chill' | 'romantic'
}

export class MusicEngine {
  private config: MusicConfig
  private spotifyToken?: string
  private tokenExpiry?: number

  constructor(config: MusicConfig) {
    this.config = config
  }

  /**
   * "Listen" to a song — picks a track that fits her taste and returns
   * info to use in a proactive message.
   */
  async listenToSomething(): Promise<TrackInfo> {
    if (this.config.spotifyClientId && this.config.spotifyClientSecret) {
      const track = await this.getSpotifyRecommendation()
      if (track) return track
    }

    // Fallback: built-in curated tracks based on common companion character tastes
    return this.pickCuratedTrack()
  }

  private async getSpotifyToken(): Promise<string | null> {
    if (this.spotifyToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.spotifyToken
    }

    try {
      const credentials = Buffer.from(
        `${this.config.spotifyClientId}:${this.config.spotifyClientSecret}`
      ).toString('base64')

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })

      const data = await response.json() as { access_token: string; expires_in: number }
      this.spotifyToken = data.access_token
      this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
      return this.spotifyToken
    } catch (err) {
      console.warn('[Music] Spotify token request failed:', (err as Error).message)
      return null
    }
  }

  private async getSpotifyRecommendation(): Promise<TrackInfo | null> {
    const token = await this.getSpotifyToken()
    if (!token) return null

    try {
      const seedArtists = (this.config.seedArtists ?? []).slice(0, 2)
      const seedGenres = (this.config.seedGenres ?? ['pop', 'indie']).slice(0, 3)

      const params = new URLSearchParams({
        limit: '10',
        seed_genres: seedGenres.join(','),
        ...(seedArtists.length > 0 ? { seed_artists: seedArtists.join(',') } : {}),
      })

      const response = await fetch(
        `https://api.spotify.com/v1/recommendations?${params}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )

      const data = await response.json() as {
        tracks: Array<{
          name: string
          artists: Array<{ name: string }>
          album: { name: string }
          preview_url: string | null
        }>
      }

      if (!data.tracks?.length) return null

      // Pick a random track from recommendations
      const track = data.tracks[Math.floor(Math.random() * data.tracks.length)]
      return {
        track: track.name,
        artist: track.artists[0]?.name ?? 'Unknown',
        album: track.album.name,
        previewUrl: track.preview_url ?? undefined,
        emotion: guessEmotion(track.name + ' ' + track.album.name),
      }
    } catch (err) {
      console.warn('[Music] Spotify recommendation failed:', (err as Error).message)
      return null
    }
  }

  private pickCuratedTrack(): TrackInfo {
    // Use character-specific curated tracks if available
    if (this.config.curatedTracks && this.config.curatedTracks.length > 0) {
      const tracks = this.config.curatedTracks
      return tracks[Math.floor(Math.random() * tracks.length)]
    }

    // Fallback: generic curated tracks
    const genericTracks: TrackInfo[] = [
      { track: 'Cruel Summer', artist: 'Taylor Swift', emotion: 'energetic' },
      { track: 'Lover', artist: 'Taylor Swift', emotion: 'romantic' },
      { track: 'Blinding Lights', artist: 'The Weeknd', emotion: 'energetic' },
      { track: 'Save Your Tears', artist: 'The Weeknd', emotion: 'melancholic' },
      { track: 'Golden Hour', artist: 'JVKE', emotion: 'romantic' },
      { track: 'Death Bed', artist: 'Powfu ft. beabadoobee', emotion: 'chill' },
      { track: 'Circles', artist: 'Post Malone', emotion: 'melancholic' },
      { track: 'Heat Waves', artist: 'Glass Animals', emotion: 'chill' },
      { track: 'HUMBLE.', artist: 'Kendrick Lamar', emotion: 'energetic' },
      { track: 'Flowers', artist: 'Miley Cyrus', emotion: 'happy' },
      { track: 'As It Was', artist: 'Harry Styles', emotion: 'melancholic' },
      { track: 'Levitating', artist: 'Dua Lipa', emotion: 'happy' },
      { track: 'Watermelon Sugar', artist: 'Harry Styles', emotion: 'happy' },
      { track: 'Peaches', artist: 'Justin Bieber', emotion: 'chill' },
      { track: '주저하는 연인들을 위해', artist: 'Epitone Project', emotion: 'melancholic' },
      { track: 'Through the Night', artist: 'IU', emotion: 'romantic' },
      { track: 'Eight', artist: 'IU', emotion: 'melancholic' },
      { track: 'ELEVEN', artist: 'IVE', emotion: 'energetic' },
    ]

    // Add custom seed artists to prompt variety
    const customTracks = (this.config.seedArtists ?? []).map(artist => ({
      track: 'a song I found', artist, emotion: 'chill' as const,
    }))

    const allTracks = [...genericTracks, ...customTracks]
    return allTracks[Math.floor(Math.random() * allTracks.length)]
  }
}

function guessEmotion(text: string): TrackInfo['emotion'] {
  const lower = text.toLowerCase()
  if (/(love|heart|kiss|forever|romantic)/i.test(lower)) return 'romantic'
  if (/(sad|cry|tears|alone|miss|gone)/i.test(lower)) return 'melancholic'
  if (/(dance|party|wild|energy|hype)/i.test(lower)) return 'energetic'
  if (/(chill|relax|slow|easy|calm)/i.test(lower)) return 'chill'
  return 'happy'
}
