import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SocialContentGenerator } from '../src/social/content-generator.js'
import type { SocialContentType } from '../src/social/content-generator.js'

// Mock dependencies
function createMockEngine() {
  return {
    getMemory: () => ({
      getContext: vi.fn().mockResolvedValue({
        recentMessages: [
          { role: 'user', content: 'I had a great day!' },
          { role: 'assistant', content: 'That makes me so happy to hear!' },
        ],
        relevantEpisodes: [
          { description: 'Had dinner together' },
        ],
      }),
    }),
    llm: {
      chat: vi.fn().mockResolvedValue('This is a generated tweet caption'),
    },
  } as any
}

function createMockMedia() {
  return {
    generateImage: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    generateVideo: vi.fn().mockResolvedValue(Buffer.from('fake-video-data')),
  } as any
}

function createMockBlueprint() {
  return {
    name: 'TestChar',
    soul: 'A warm, genuine person who loves deeply.',
    referenceImagePath: '/tmp/ref.jpg',
  } as any
}

describe('SocialContentGenerator', () => {
  let generator: SocialContentGenerator
  let mockEngine: ReturnType<typeof createMockEngine>
  let mockMedia: ReturnType<typeof createMockMedia>
  let mockBlueprint: ReturnType<typeof createMockBlueprint>

  beforeEach(() => {
    mockEngine = createMockEngine()
    mockMedia = createMockMedia()
    mockBlueprint = createMockBlueprint()
    generator = new SocialContentGenerator(mockEngine, mockMedia, mockBlueprint)
  })

  describe('pickContentType', () => {
    it('returns a valid content type', () => {
      const validTypes: SocialContentType[] = ['text_reflection', 'selfie_post', 'video_post']
      const result = generator.pickContentType()
      expect(validTypes).toContain(result)
    })

    it('returns all types over many picks (statistical)', () => {
      const counts: Record<string, number> = { text_reflection: 0, selfie_post: 0, video_post: 0 }
      for (let i = 0; i < 1000; i++) {
        counts[generator.pickContentType()]++
      }
      // All types should appear (with high probability)
      expect(counts.text_reflection).toBeGreaterThan(0)
      expect(counts.selfie_post).toBeGreaterThan(0)
      expect(counts.video_post).toBeGreaterThan(0)
    })

    it('selfie_post is most common (55% weight)', () => {
      const counts: Record<string, number> = { text_reflection: 0, selfie_post: 0, video_post: 0 }
      for (let i = 0; i < 2000; i++) {
        counts[generator.pickContentType()]++
      }
      // selfie_post should be most common (55% weight)
      expect(counts.selfie_post).toBeGreaterThan(counts.text_reflection)
      expect(counts.selfie_post).toBeGreaterThan(counts.video_post)
    })

    it('text_reflection is least common (20% weight)', () => {
      const counts: Record<string, number> = { text_reflection: 0, selfie_post: 0, video_post: 0 }
      for (let i = 0; i < 2000; i++) {
        counts[generator.pickContentType()]++
      }
      expect(counts.text_reflection).toBeLessThan(counts.selfie_post)
      expect(counts.text_reflection).toBeLessThan(counts.video_post)
    })
  })

  describe('generate', () => {
    it('generates text reflection content', async () => {
      // Force text_reflection
      vi.spyOn(generator, 'pickContentType').mockReturnValue('text_reflection')

      const content = await generator.generate()
      expect(content).not.toBeNull()
      expect(content!.type).toBe('text_reflection')
      expect(content!.caption).toBeTruthy()
      expect(content!.mediaBuffer).toBeUndefined()
    })

    it('generates selfie post with image', async () => {
      vi.spyOn(generator, 'pickContentType').mockReturnValue('selfie_post')

      const content = await generator.generate()
      expect(content).not.toBeNull()
      expect(content!.type).toBe('selfie_post')
      expect(content!.caption).toBeTruthy()
      expect(content!.mediaBuffer).toBeDefined()
      expect(content!.mediaType).toBe('image')
    })

    it('generates video post with video', async () => {
      vi.spyOn(generator, 'pickContentType').mockReturnValue('video_post')

      const content = await generator.generate()
      expect(content).not.toBeNull()
      expect(content!.type).toBe('video_post')
      expect(content!.caption).toBeTruthy()
      expect(content!.mediaBuffer).toBeDefined()
      expect(content!.mediaType).toBe('video')
    })

    it('falls back to text if image generation fails', async () => {
      vi.spyOn(generator, 'pickContentType').mockReturnValue('selfie_post')
      mockMedia.generateImage.mockResolvedValue(null) // image fails

      const content = await generator.generate()
      expect(content).not.toBeNull()
      expect(content!.type).toBe('text_reflection')
      expect(content!.mediaBuffer).toBeUndefined()
    })

    it('falls back to text if video generation fails', async () => {
      vi.spyOn(generator, 'pickContentType').mockReturnValue('video_post')
      mockMedia.generateVideo.mockResolvedValue(null) // video fails

      const content = await generator.generate()
      expect(content).not.toBeNull()
      expect(content!.type).toBe('text_reflection')
    })

    it('returns null if everything fails', async () => {
      vi.spyOn(generator, 'pickContentType').mockReturnValue('text_reflection')
      mockEngine.llm.chat.mockRejectedValue(new Error('LLM down'))

      const content = await generator.generate()
      expect(content).toBeNull()
    })
  })
})
