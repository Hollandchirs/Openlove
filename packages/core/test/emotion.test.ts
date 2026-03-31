import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EmotionEngine } from '../src/emotion/index.js'
import type { EmotionState } from '../src/emotion/index.js'

describe('EmotionEngine', () => {
  let engine: EmotionEngine

  beforeEach(() => {
    engine = new EmotionEngine()
  })

  describe('constructor', () => {
    it('initializes with default baseline state', () => {
      const state = engine.getState()
      expect(state.joy).toBeCloseTo(0.6, 1)
      expect(state.sadness).toBeCloseTo(0.1, 1)
      expect(state.anger).toBeCloseTo(0.05, 1)
      expect(state.energy).toBeCloseTo(0.6, 1)
      expect(state.love).toBeCloseTo(0.4, 1)
    })

    it('accepts custom baseline configuration', () => {
      const custom = new EmotionEngine({
        baseline: { joy: 0.9, sadness: 0.0 },
        persistence: 0.5,
      })
      const state = custom.getState()
      expect(state.joy).toBeCloseTo(0.9, 1)
      expect(state.sadness).toBeCloseTo(0.0, 1)
    })
  })

  describe('getState', () => {
    it('returns a copy (immutable)', () => {
      const s1 = engine.getState()
      const s2 = engine.getState()
      expect(s1).toEqual(s2)
      expect(s1).not.toBe(s2) // different object references
    })

    it('has all required emotion fields', () => {
      const state = engine.getState()
      const keys: (keyof EmotionState)[] = [
        'joy', 'sadness', 'anger', 'fear', 'surprise',
        'trust', 'anticipation', 'love', 'energy', 'updatedAt',
      ]
      for (const key of keys) {
        expect(state).toHaveProperty(key)
        expect(typeof state[key]).toBe('number')
      }
    })
  })

  describe('getMoodDescription', () => {
    it('returns a string', () => {
      const desc = engine.getMoodDescription()
      expect(typeof desc).toBe('string')
      expect(desc.length).toBeGreaterThan(0)
    })

    it('returns neutral for baseline state', () => {
      const desc = engine.getMoodDescription()
      expect(desc).toMatch(/neutral|calm/)
    })

    it('changes from neutral after an affectionate message', () => {
      engine.updateFromConversation('I love you so much babe', 'I adore you too darling')
      const desc = engine.getMoodDescription()
      expect(desc).not.toMatch(/^feeling neutral/)
      expect(desc).toMatch(/affectionate|love|warm/)
    })

    it('changes from neutral after a happy message', () => {
      engine.updateFromConversation('haha lol awesome amazing!', 'yay so happy and excited!')
      const desc = engine.getMoodDescription()
      expect(desc).not.toMatch(/^feeling neutral/)
      expect(desc).toMatch(/happy|content|overjoyed/)
    })

    it('changes from neutral after an angry message', () => {
      engine.updateFromConversation('I am so angry and furious!', 'I hate this stupid situation!')
      const desc = engine.getMoodDescription()
      expect(desc).not.toMatch(/^feeling neutral/)
      expect(desc).toMatch(/annoyed|frustrated|angry/)
    })
  })

  describe('updateFromConversation', () => {
    it('increases joy from happy conversation', () => {
      const before = engine.getState().joy
      engine.updateFromConversation(
        'I am so happy today! Amazing news!',
        'That is awesome! I am so excited for you!'
      )
      const after = engine.getState().joy
      expect(after).toBeGreaterThan(before)
    })

    it('increases sadness from sad conversation', () => {
      const before = engine.getState().sadness
      engine.updateFromConversation(
        'I feel so sad and lonely tonight...',
        'I am sorry to hear that. I am here for you.'
      )
      const after = engine.getState().sadness
      expect(after).toBeGreaterThan(before)
    })

    it('increases anger from angry conversation', () => {
      const before = engine.getState().anger
      engine.updateFromConversation(
        'I am so angry and frustrated with this stupid situation!',
        'I understand your frustration.'
      )
      const after = engine.getState().anger
      expect(after).toBeGreaterThan(before)
    })

    it('increases love from affectionate conversation', () => {
      const before = engine.getState().love
      engine.updateFromConversation(
        'I love you so much babe',
        'I adore you too darling'
      )
      const after = engine.getState().love
      expect(after).toBeGreaterThan(before)
    })

    it('increases surprise from surprising content', () => {
      const before = engine.getState().surprise
      engine.updateFromConversation(
        'OMG no way! What?! Seriously?!',
        'Wow that is incredible!'
      )
      const after = engine.getState().surprise
      expect(after).toBeGreaterThan(before)
    })

    it('clamps values between 0 and 1', () => {
      // Push joy to the max with many happy messages
      for (let i = 0; i < 50; i++) {
        engine.updateFromConversation('haha lol 😂 awesome amazing!', 'yay so happy!')
      }
      const state = engine.getState()
      expect(state.joy).toBeLessThanOrEqual(1.0)
      expect(state.joy).toBeGreaterThanOrEqual(0.0)
      expect(state.energy).toBeLessThanOrEqual(1.0)
    })

    it('recognizes Chinese emotional keywords', () => {
      const before = engine.getState().love
      engine.updateFromConversation('我好爱你 宝贝', '亲爱的 我也想你')
      const after = engine.getState().love
      expect(after).toBeGreaterThan(before)
    })

    it('updates the timestamp', () => {
      const before = engine.getState().updatedAt
      engine.updateFromConversation('hello', 'hi')
      const after = engine.getState().updatedAt
      expect(after).toBeGreaterThanOrEqual(before)
    })
  })

  describe('time-based decay', () => {
    it('decays emotions toward baseline over time', () => {
      // Push joy high
      engine.updateFromConversation('haha amazing awesome!', 'yay so happy!')
      const elevated = engine.getState().joy

      // Simulate time passage by manipulating internal state
      const state = (engine as any).state as EmotionState
      state.updatedAt = Date.now() - 3_600_000 * 5 // 5 hours ago

      const decayed = engine.getState().joy
      expect(decayed).toBeLessThan(elevated)
      // Should be closer to baseline (0.6) than the elevated value
      expect(Math.abs(decayed - 0.6)).toBeLessThan(Math.abs(elevated - 0.6))
    })
  })
})
