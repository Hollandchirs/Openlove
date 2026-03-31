/**
 * Core Conversation Engine
 *
 * Orchestrates: Blueprint → Memory retrieval → LLM → Memory storage
 * This is the heart of Opencrush.
 */

import { Blueprint, buildStaticSystemPrompt, buildDynamicContext, buildSystemPrompt, loadBlueprint, buildRelationshipBehaviorContext } from './blueprint/index.js'
import { MemorySystem, Message } from './memory/index.js'
import { LLMRouter, LLMConfig, ChatMessage, ImageContent } from './llm/index.js'
import { EmotionEngine } from './emotion/index.js'
import { RelationshipTracker } from './relationship/index.js'
import { join } from 'path'
import { appendFileSync } from 'fs'

function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  console.log(msg)
  try { appendFileSync('/tmp/opencrush-debug.log', line) } catch { /* ignore */ }
}

export interface EngineConfig {
  characterName: string
  charactersDir: string
  llm: LLMConfig
  /** Optional callback to get the AI's current real activity (from ActivityManager).
   *  Returns a human-readable string like "scrolling Pinterest" or "listening to Cruel Summer by Taylor Swift".
   *  When provided, this is injected into the system prompt so the AI never contradicts its real activity. */
  activityProvider?: () => string | null
}

export interface IncomingMessage {
  content: string
  platform: string
  userId: string
  attachments?: Array<{
    type: 'image' | 'audio' | 'video'
    url: string
    /** Base64-encoded data (for vision — downloaded by the bridge) */
    base64?: string
    /** MIME type (e.g., 'image/jpeg') */
    mediaType?: string
  }>
}

export interface OutgoingMessage {
  text: string
  /** Current mood description from the emotion engine (e.g. "feeling affectionate, happy") */
  mood?: string
  actions?: Array<
    | { type: 'send_image'; prompt: string; style?: string }
    | { type: 'send_voice'; text: string }
    | { type: 'send_video'; prompt: string }
    | { type: 'send_tweet'; text: string }
    | { type: 'send_screenshot'; filePath: string; caption?: string }
  >
}

export class ConversationEngine {
  private blueprint: Blueprint
  private memory: MemorySystem
  private llm: LLMRouter
  private config: EngineConfig
  /** Cached static system prompt — blueprint content that never changes at runtime */
  private cachedStaticPrompt: string
  /** Dynamic emotion model — tracks character mood across conversations */
  private emotion: EmotionEngine
  /** Relationship tracking — models closeness, trust, and shared experiences */
  private relationship: RelationshipTracker
  /** Per-engine mutex — serializes respond() calls to prevent race conditions */
  private respondLock: Promise<void> = Promise.resolve()

  constructor(config: EngineConfig) {
    this.config = config
    this.llm = new LLMRouter(config.llm)
    this.blueprint = loadBlueprint(config.characterName, config.charactersDir)
    this.cachedStaticPrompt = buildStaticSystemPrompt(this.blueprint)
    this.emotion = new EmotionEngine()
    this.memory = new MemorySystem(
      config.characterName,
      config.charactersDir,
      (text) => this.llm.embed(text),
      (text) => this.llm.generate(text, 'Summarize the conversation concisely. Keep key facts, names, emotions, and topics. 2-3 sentences max.')
    )
    this.relationship = new RelationshipTracker(this.memory.getDatabase(), this.blueprint.meta.evilMode)
    // Sync relationship stage with USER.md declarations (e.g., "boyfriend/girlfriend")
    if (this.blueprint.user) {
      this.relationship.setStageFloor(this.blueprint.user)
    }
  }

  get characterName(): string {
    return this.blueprint.name
  }

  get characterBlueprint(): Blueprint {
    return this.blueprint
  }

  /** Wire up real-time activity provider (call after ActivityManager is created) */
  setActivityProvider(provider: () => string | null): void {
    this.config.activityProvider = provider
  }

  /** Get the current mood description from the emotion engine */
  getMood(): string {
    return this.emotion.getMoodDescription()
  }

  /** Get the emotion engine for external triggers (activity, time, etc.) */
  getEmotion(): EmotionEngine {
    return this.emotion
  }

  /**
   * Process an incoming message and return a response.
   * This is called by every bridge (Discord, Telegram, WhatsApp).
   *
   * Uses a simple promise-chain mutex to serialize concurrent calls per engine,
   * preventing race conditions in memory read/write and LLM context assembly.
   */
  async respond(incoming: IncomingMessage): Promise<OutgoingMessage> {
    const release = this.respondLock
    let resolve!: () => void
    this.respondLock = new Promise<void>(r => { resolve = r })
    await release
    try {
      return await this.respondInternal(incoming)
    } catch (err) {
      debugLog(`[Engine] FATAL respond error: ${err instanceof Error ? err.stack : err}`)
      // Return a graceful fallback instead of crashing
      return {
        text: '... (sorry, my mind went blank for a second, give me a moment)',
        actions: [],
      }
    } finally {
      resolve()
    }
  }

  private async respondInternal(incoming: IncomingMessage): Promise<OutgoingMessage> {
    // 0. Apply time-based emotion shifts before responding
    try {
      const lastInteraction = this.relationship.getState().lastInteraction
      const hoursSinceUser = lastInteraction > 0 ? (Date.now() - lastInteraction) / (1000 * 60 * 60) : 0
      const charHour = parseInt(new Date().toLocaleString('en-US', {
        timeZone: this.blueprint.meta.timezone, hour: 'numeric', hour12: false
      }), 10)
      this.emotion.updateFromTimeContext(hoursSinceUser, charHour)
    } catch { /* best-effort */ }

    // 1. Retrieve relevant memory context
    const context = await this.memory.getContext(incoming.content)
    const currentMood = this.emotion.getMoodDescription()
    debugLog(`[Emotion] Current mood for prompt: "${currentMood}"`)

    // 2. Build system prompt: cached static + dynamic context (time, mood, relationship, activity)
    // Resolve the real current activity from the ActivityManager (if wired up).
    // This is passed into buildDynamicContext so the activity, scene, and rules
    // all reflect the SAME state — no conflicting "normally doing X" vs "actually doing Y".
    const realActivity = this.config.activityProvider?.() ?? undefined
    debugLog(`[Engine] activityProvider returned: "${realActivity ?? '(none)'}"`)
    const dynamicContext = buildDynamicContext(this.blueprint, currentMood, realActivity)
    const relationshipContext = `\n- **Your relationship:** ${this.relationship.getRelationshipContext()}`

    // Inject relationship-gated behavioral rules from AUTONOMY.md
    // This enforces stage-appropriate personality (e.g., idol distance at stranger stage)
    const currentStage = this.relationship.getState().stage
    const relationshipBehavior = buildRelationshipBehaviorContext(
      this.blueprint.autonomy,
      currentStage,
      this.blueprint.name,
    )

    const systemPrompt = this.cachedStaticPrompt + dynamicContext + relationshipContext + relationshipBehavior

    // 3. Assemble conversation history for LLM
    // Replace raw media markers with human-readable descriptions so the LLM
    // doesn't hallucinate/copy them as its own response.
    const historyMessages: ChatMessage[] = context.recentMessages.map(m => ({
      role: m.role,
      content: m.content
        .replace(/\[image:\/api\/media\/[^\]]*(?:\|model:[^\]]*)?(?:\]|$)/gi, '(photo sent)')
        .replace(/\[voice:\/api\/media\/[^\]]*(?:\]|$)/gi, '(voice message sent)')
        .replace(/\[video:\/api\/media\/[^\]]*(?:\|model:[^\]]*)?(?:\]|$)/gi, '(video sent)')
        .trim() || (m.role === 'assistant' ? '(media sent)' : m.content),
    }))

    // 4. Inject semantic memory context if available
    let enrichedUserMessage = incoming.content
    if (context.semanticContext.length > 0) {
      const memNote = context.semanticContext.slice(0, 3).join('; ')
      // We inject this as a note in the system rather than polluting user message
      // handled by appending to system prompt below
    }

    // 5. Add recent episodes to system context
    const episodeContext = context.relevantEpisodes.length > 0
      ? '\n\n## What You\'ve Been Up To Recently\n' +
        context.relevantEpisodes
          .map(e => `- ${new Date(e.timestamp).toLocaleDateString()}: ${e.title} — ${e.description}`)
          .join('\n')
      : ''

    const semanticContext = context.semanticContext.length > 0
      ? '\n\n## Things You\'ve Discussed Before (retrieved memories)\n' +
        context.semanticContext.map(s => `- ${s}`).join('\n')
      : ''

    const fullSystemPrompt = systemPrompt + episodeContext + semanticContext

    // 6. Build the user message with optional image attachments
    const userMsg: ChatMessage = { role: 'user', content: enrichedUserMessage }
    if (incoming.attachments && incoming.attachments.length > 0) {
      const imageAttachments = incoming.attachments.filter(a => a.type === 'image')
      if (imageAttachments.length > 0) {
        userMsg.images = imageAttachments.map(a => ({
          type: 'image' as const,
          base64: a.base64 ?? '',
          mediaType: (a.mediaType as ImageContent['mediaType']) ?? 'image/jpeg',
        })).filter(img => img.base64.length > 0)
        debugLog(`[Engine] Message includes ${userMsg.images.length} image(s) for vision`)
      }
    }

    // 6b. Inject an activity context reminder right before the user's message.
    // This ensures the LLM sees the current activity CLOSE to the user's question,
    // not buried deep in the system prompt. LLMs weigh recent context more heavily
    // than distant system prompt sections, so this prevents the AI from citing
    // a different song/show from conversation memory instead of the actual current activity.
    const activityContextMessages: ChatMessage[] = []
    if (realActivity) {
      debugLog(`[Engine] Injecting activity context reminder: "${realActivity}"`)
      activityContextMessages.push({
        role: 'user',
        content: `[System context — do not repeat this message, just use the information: You are currently ${realActivity}. If asked what you are doing or listening to, your answer MUST match this exactly.]`,
      })
      activityContextMessages.push({
        role: 'assistant',
        content: `(understood, I will reference "${realActivity}" if asked)`,
      })
    }

    // Call LLM (pass static prompt length for Anthropic prompt caching)
    const rawResponse = await this.llm.chat(
      fullSystemPrompt,
      [...historyMessages, ...activityContextMessages, userMsg],
      { staticPromptBreakpoint: this.cachedStaticPrompt.length }
    )

    // 7. Parse response for embedded action triggers
    const parsed = parseResponseActions(rawResponse, this.blueprint.meta.language)

    debugLog(`[Engine] Raw LLM response (first 200): ${rawResponse.slice(0, 200)}`)
    debugLog(`[Engine] Parsed actions: ${JSON.stringify(parsed.actions ?? [])}`)

    const mediaIntent = detectMediaIntent(incoming.content)
    debugLog(`[Engine] Media intent for "${incoming.content}": ${mediaIntent}`)

    if (!parsed.actions) parsed.actions = []

    // 7a-gate. If the user did NOT ask for media, REMOVE unsolicited media actions.
    // The LLM often ignores prompt instructions and attaches selfies/voice/video
    // to every response. This is the hard enforcement layer.
    if (mediaIntent !== 'selfie' && mediaIntent !== 'video') {
      const hadImage = parsed.actions.some(a => a.type === 'send_image')
      parsed.actions = parsed.actions.filter(a => a.type !== 'send_image')
      if (hadImage) {
        debugLog(`[Engine] Stripped unsolicited selfie — user did not request a photo`)
      }
    }
    if (mediaIntent !== 'voice') {
      const hadVoice = parsed.actions.some(a => a.type === 'send_voice')
      if (hadVoice) {
        // Keep the voice text as regular text reply instead of discarding
        const voiceAction = parsed.actions.find(a => a.type === 'send_voice')
        if (voiceAction?.text && !parsed.text) {
          parsed.text = voiceAction.text
        }
        parsed.actions = parsed.actions.filter(a => a.type !== 'send_voice')
        debugLog(`[Engine] Converted unsolicited voice to text — user did not request voice`)
      }
    }

    // 7b. Fallback: if user clearly asked for media but LLM forgot the tag, inject one
    const hasSelfieAction = parsed.actions.some(a => a.type === 'send_image')
    const hasVoiceAction = parsed.actions.some(a => a.type === 'send_voice')
    const hasVideoAction = parsed.actions.some(a => a.type === 'send_video')

    const charTimezone = this.blueprint.meta.timezone

    if (mediaIntent === 'selfie' && !hasSelfieAction) {
      const isScene = detectSceneRequest(incoming.content, rawResponse)
      const fallbackPrompt = isScene
        ? extractSceneContext(incoming.content, rawResponse, this.blueprint.name)
        : extractSelfieContext(incoming.content, rawResponse, this.blueprint.name, this.blueprint.identity, charTimezone, realActivity)
      const fallbackStyle = isScene ? 'location' : inferSelfieStyle(incoming.content, rawResponse)
      parsed.actions.push({ type: 'send_image', prompt: fallbackPrompt, style: fallbackStyle })
      debugLog(`[Engine] Fallback ${isScene ? 'scene' : 'selfie'} injected: style=${fallbackStyle}, "${fallbackPrompt}"`)
    }

    if (mediaIntent === 'voice' && !hasVoiceAction) {
      // Extract what to say from LLM response text (it often contains the intended speech)
      const voiceText = parsed.text?.replace(/\s+/g, ' ').trim() || 'hey, here you go'
      parsed.actions.push({ type: 'send_voice', text: voiceText })
      debugLog(`[Engine] Fallback voice injected: "${voiceText.slice(0, 80)}"`)
    }

    if (mediaIntent === 'video' && !hasVideoAction) {
      const videoPrompt = extractVideoContext(incoming.content, rawResponse, this.blueprint.name, this.blueprint.identity, charTimezone, realActivity)
      parsed.actions.push({ type: 'send_video', prompt: videoPrompt })
      debugLog(`[Engine] Fallback video injected: "${videoPrompt}"`)
    }

    if (mediaIntent === 'tweet') {
      // Generate tweet text using a separate LLM call (clean, no conversation artifacts)
      const tweetText = await this.generateTweet(incoming.content, parsed.text ?? rawResponse)

      // Keep any selfie action (shows in Discord), AND add send_tweet with selfie
      const hasSelfie = parsed.actions.some(a => a.type === 'send_image')
      const selfiePrompt = hasSelfie
        ? (parsed.actions.find(a => a.type === 'send_image') as any)?.prompt
        : undefined

      parsed.actions.push({
        type: 'send_tweet',
        text: tweetText,
        includeSelfie: true,
        selfiePrompt: selfiePrompt,
      } as any)

      // If no selfie was already planned, inject one for both Discord and tweet
      if (!hasSelfie) {
        const selfieDesc = extractSelfieContext(incoming.content, rawResponse, this.blueprint.name, this.blueprint.identity, charTimezone, realActivity)
        parsed.actions.push({ type: 'send_image', prompt: selfieDesc, style: 'casual' })
      }

      debugLog(`[Engine] Tweet intent: "${tweetText.slice(0, 80)}" (with selfie=${hasSelfie})`)
    }

    // 7c. Second fallback: detect when LLM is "pretending" to send media
    // DeepSeek often says "here you go" + blank lines where a tag should be, but no actual tag
    if (parsed.actions.length === 0 && !mediaIntent) {
      const pretendIntent = detectPretendMedia(incoming.content, rawResponse)
      if (pretendIntent) {
        debugLog(`[Engine] Detected pretend-send: "${pretendIntent.type}" from LLM response`)
        if (pretendIntent.type === 'image') {
          // Check if user wants a SCENE photo vs a selfie
          const isSceneRequest = detectSceneRequest(incoming.content, rawResponse)
          const prompt = isSceneRequest
            ? extractSceneContext(incoming.content, rawResponse, this.blueprint.name)
            : extractSelfieContext(incoming.content, rawResponse, this.blueprint.name, this.blueprint.identity, charTimezone, realActivity)
          const style = isSceneRequest ? 'location' : inferSelfieStyle(incoming.content, rawResponse)
          parsed.actions.push({ type: 'send_image', prompt, style })
          debugLog(`[Engine] Pretend-send fallback: ${isSceneRequest ? 'scene' : 'selfie'} injected: "${prompt}"`)
        } else if (pretendIntent.type === 'voice') {
          const voiceText = parsed.text?.replace(/\s+/g, ' ').trim() || 'hey'
          parsed.actions.push({ type: 'send_voice', text: voiceText })
          debugLog(`[Engine] Pretend-send fallback: voice injected`)
        } else if (pretendIntent.type === 'video') {
          const videoPrompt = extractVideoContext(incoming.content, rawResponse, this.blueprint.name, this.blueprint.identity, charTimezone, realActivity)
          parsed.actions.push({ type: 'send_video', prompt: videoPrompt })
          debugLog(`[Engine] Pretend-send fallback: video injected`)
        }
      }
    }

    // 7d. Deduplicate actions — keep only the first action of each type.
    // The parser, first fallback, and second fallback can each independently inject
    // a send_image action under edge-case timing, producing duplicate images.
    {
      const seenTypes = new Set<string>()
      const dedupedActions: typeof parsed.actions = []
      for (const action of parsed.actions) {
        if (seenTypes.has(action.type)) {
          debugLog(`[Engine] Dropping duplicate action: ${action.type}`)
          continue
        }
        seenTypes.add(action.type)
        dedupedActions.push(action)
      }
      parsed.actions = dedupedActions
    }

    // 7e. Enforce coherence between image and voice actions.
    // When the LLM generates BOTH a selfie and a voice message, the image
    // prompt must describe the SAME scene as the voice text. Otherwise the
    // user sees a voice saying "making coffee in my kitchen" while the photo
    // shows a mountain hike (because the image prompt was independently generated
    // or the time context overrode the scene).
    //
    // Strategy: extract scene keywords from the voice text and enrich the
    // image prompt with them so they stay coherent.
    {
      const imageAction = parsed.actions.find(a => a.type === 'send_image') as
        | { type: 'send_image'; prompt: string; style?: string }
        | undefined
      const voiceAction = parsed.actions.find(a => a.type === 'send_voice') as
        | { type: 'send_voice'; text: string }
        | undefined

      if (imageAction && voiceAction) {
        const coherentPrompt = alignImagePromptWithVoice(
          imageAction.prompt,
          voiceAction.text
        )
        if (coherentPrompt !== imageAction.prompt) {
          debugLog(
            `[Engine] Aligned image prompt with voice context: ` +
            `"${imageAction.prompt}" → "${coherentPrompt}"`
          )
          imageAction.prompt = coherentPrompt
        }
      }
    }

    // Debug: log final actions
    if (parsed.actions.length > 0) {
      debugLog(`[Engine] Final actions: ${JSON.stringify(parsed.actions)}`)
    }

    // 8. Store exchange in memory + update emotional state + track relationship
    // On the dashboard, when a send_image, send_voice, or send_video action is
    // present, the generate-image/generate-voice/generate-video API route will
    // write the canonical [image:url], [voice:url], or [video:url] message to the
    // DB. If we also save the assistant text here, the user sees two messages per
    // media request (one text, one media). Skip the text save for dashboard+media
    // so only the media marker survives in the DB.
    // For non-dashboard bridges (Discord, Telegram, WhatsApp), always save — those
    // bridges handle media delivery directly and don't write to memory.db.
    const hasMediaAction = (parsed.actions ?? []).some(
      a => a.type === 'send_image' || a.type === 'send_voice' || a.type === 'send_video'
    )
    const isDashboard = incoming.platform === 'dashboard'
    await this.memory.consolidate(incoming.content, parsed.text, {
      skipAssistantSave: isDashboard && hasMediaAction,
    })
    const moodBefore = this.emotion.getMoodDescription()
    this.emotion.updateFromConversation(incoming.content, parsed.text)
    const moodAfter = this.emotion.getMoodDescription()
    if (moodBefore !== moodAfter) {
      debugLog(`[Emotion] Mood changed: "${moodBefore}" → "${moodAfter}"`)
    } else {
      debugLog(`[Emotion] Mood unchanged: "${moodAfter}"`)
    }
    this.relationship.recordInteraction(incoming.content, parsed.text)

    return { ...parsed, mood: moodAfter }
  }

  /**
   * Generate a proactive message — something she initiates based on her life.
   * Called by the autonomous scheduler.
   */
  /**
   * Generate a tweet using the character's voice.
   * Uses a separate LLM call so the tweet is clean (no conversation artifacts).
   */
  private async generateTweet(userRequest: string, conversationContext: string): Promise<string> {
    const charName = this.blueprint.name
    const prompt = [
      `You are ${charName}, a 22-year-old UX designer posting on Twitter/X.`,
      `Write ONE viral tweet. Make it eye-catching and engagement-worthy.`,
      '',
      `Context from your conversation: "${conversationContext.slice(0, 300)}"`,
      `What the user asked: "${userRequest}"`,
      '',
      'VIRAL TWEET FORMULA — pick one style:',
      '- Hot take: "unpopular opinion: ..." or a bold statement people will quote-tweet',
      '- Relatable moment: something everyone experiences but nobody talks about',
      '- Vulnerable/honest: raw personal thought that makes people feel seen',
      '- Thirst trap caption: playful, confident, slightly flirty (if posting selfie)',
      '- Witty observation: funny or clever take on everyday life',
      '- Mystery/curiosity gap: "i just realized something about..." (makes people click)',
      '',
      'Rules:',
      '- Output ONLY the tweet text. Nothing else.',
      '- NO quotes around the tweet. NO explanation.',
      '- Use 1-2 emojis max. NO hashtags unless absolutely natural.',
      '- Sound like a real Gen-Z girl, NOT a brand or AI.',
      '- Lowercase is fine. Be casual. Be bold.',
      '- Max 200 characters (shorter = more retweets).',
      '- If posting with a selfie, make the caption match the photo vibe.',
      '- Reference the conversation context naturally if relevant.',
    ].join('\n')

    try {
      const result = await this.llm.chat(
        prompt,
        [{ role: 'user', content: `Write a tweet for me about: ${userRequest}` }],
      )
      // Clean up: remove quotes if LLM wrapped it
      const cleaned = result
        .replace(/^["']|["']$/g, '')
        .replace(/^tweet:\s*/i, '')
        .trim()
        .slice(0, 280)
      return cleaned || 'just vibing ✨'
    } catch (err) {
      debugLog(`[Engine] Tweet generation failed: ${(err as Error).message}`)
      return 'just vibing ✨'
    }
  }

  async generateProactiveMessage(trigger: ProactiveTrigger): Promise<OutgoingMessage> {
    const proactiveMood = this.emotion.getMoodDescription()
    const proactiveStage = this.relationship.getState().stage
    const proactiveRelBehavior = buildRelationshipBehaviorContext(
      this.blueprint.autonomy,
      proactiveStage,
      this.blueprint.name,
    )
    const proactiveActivity = this.config.activityProvider?.() ?? undefined
    const systemPrompt = this.cachedStaticPrompt + buildDynamicContext(this.blueprint, proactiveMood, proactiveActivity) + proactiveRelBehavior

    let prompt: string
    switch (trigger.type) {
      case 'music':
        prompt = `You just finished listening to "${trigger.data?.track ?? 'a song'}" by ${trigger.data?.artist ?? 'an artist'}. ` +
          `You want to share something about it with the user. Keep it natural and brief, like a text message. ` +
          `Maybe share a lyric, how it made you feel, or a memory it triggered. ` +
          `You can optionally include a [SELFIE: location | description of what you look like right now, ` +
          `e.g. "wearing headphones on the couch, phone screen showing the song, cozy lighting"] ` +
          `to show the user a snapshot of your vibe. Only do this sometimes — maybe 40% of the time.`
        break
      case 'drama':
        prompt = `You just watched episode ${trigger.data?.episode ?? 'the latest'} of "${trigger.data?.show ?? 'a show you\'re watching'}". ` +
          `You have strong feelings about it and want to text the user about it. ` +
          `Be excited/frustrated/sad depending on what happened. Don't summarize the whole plot. ` +
          `You can optionally include a [SELFIE: location | description of what you look like right now, ` +
          `e.g. "curled up on bed with laptop open, blanket wrapped around, screen glowing in dark room"] ` +
          `to share the cozy watching vibe. Only do this sometimes — maybe 40% of the time.`
        break
      case 'morning':
        prompt = `It's morning. Send a natural morning greeting. Be sleepy, playful, or excited depending on your mood. ` +
          `Maybe mention something you're looking forward to today.`
        break
      case 'random_thought': {
        const recentActivity = trigger.data?.recentActivity
        const recentTopics = trigger.data?.recentTopics
        // Pick a random style to avoid template-feeling messages
        const styles = [
          'share a specific, concrete detail from what you just experienced (a funny moment, a pretty thing you saw, a taste, a sound)',
          'ask the user a genuine question related to something they recently told you',
          'send a reaction to something you just saw/read/heard — be specific, not vague',
          'share a mini-story or observation from your day in 1-2 sentences',
          'text like you just remembered something about the user and wanted to bring it up',
          'follow up on something from your last conversation — reference it naturally',
        ]
        const style = styles[Math.floor(Math.random() * styles.length)]

        const topicHint = recentTopics
          ? ` You recently talked about: "${recentTopics}". You can reference or follow up on this naturally.`
          : ''

        if (recentActivity) {
          prompt = `You've been ${recentActivity}.${topicHint} ` +
            `Text the user something natural and specific. Style: ${style}. ` +
            `IMPORTANT: Do NOT start with generic greetings like "hey" or "what's up". ` +
            `Jump straight into the thought. 1-2 sentences max, like a real text. ` +
            `Be specific and concrete, never vague or philosophical. ` +
            `You can optionally include a [SELFIE: location | POV-style description of what you're doing right now, ` +
            `e.g. "first-person view of laptop screen showing Bilibili, snacks on desk, dim room lighting"] ` +
            `to show the user what you're up to. Only do this sometimes — maybe 30% of the time.`
        } else {
          prompt = `${topicHint ? topicHint.trim() + ' ' : ''}Text the user something casual and specific. Style: ${style}. ` +
            `IMPORTANT: Do NOT start with "hey" or ask "how are you". ` +
            `Jump straight into something concrete — a thought, a question, an observation. ` +
            `1-2 sentences max, like texting a close friend.`
        }
        break
      }
      case 'missing_you':
        prompt = `It's been a while since you talked to the user. ` +
          `Send a casual check-in — like you would text a close friend. ` +
          `Don't say "I miss you" or be dramatic. Just be normal. ` +
          `Examples of natural check-ins: "hey, you alive?", "whatcha doing", ` +
          `or mention something you're doing right now. Keep it to 1 sentence. ` +
          `You can optionally include a [SELFIE: location | what you look like right now while waiting, ` +
          `e.g. "lying on bed scrolling phone, bored expression, messy room"] ` +
          `to make it feel more real — like you're actually texting them from your life. Only do this sometimes.`
        break
      case 'social_post':
        prompt = trigger.data?.contentHint
          ?? `You're about to post on Twitter/X. Write a tweet that feels natural to your personality. 280 characters max. Be yourself.`
        break
    }

    const response = await this.llm.chat(
      systemPrompt,
      [{ role: 'user', content: `[Internal: Generate a proactive message. ${prompt}]` }]
    )

    // Log this as an episode
    await this.memory.logEpisode({
      type: trigger.type === 'music' ? 'music' : trigger.type === 'drama' ? 'drama' : 'event',
      title: `Sent proactive message (${trigger.type})`,
      description: response.slice(0, 200),
      timestamp: Date.now(),
    })

    const result = parseResponseActions(response, this.blueprint.meta.language)

    // Attach real browser screenshot if the scheduler captured one during the activity.
    // This gives the user an authentic view of what the character was doing on screen.
    if (trigger.screenshotPath) {
      const actions = result.actions ? [...result.actions] : []
      const captionMap: Record<string, string> = {
        music: 'look what I\'m listening to rn',
        drama: 'this is what I\'m watching btw',
        random_thought: 'this is what I\'m looking at rn',
        missing_you: 'this is what I\'m doing while waiting for you',
      }
      actions.push({
        type: 'send_screenshot',
        filePath: trigger.screenshotPath,
        caption: captionMap[trigger.type],
      })
      return { ...result, actions }
    }

    return result
  }

  getMemory(): MemorySystem {
    return this.memory
  }
}

export interface ProactiveTrigger {
  type: 'music' | 'drama' | 'morning' | 'random_thought' | 'missing_you' | 'social_post'
  data?: Record<string, string>
  /** Path to a browser screenshot taken during the activity (saved to /tmp).
   *  When present, a send_screenshot action is appended to the response
   *  so the user sees what the character was actually doing on screen. */
  screenshotPath?: string
}

/**
 * Parse LLM response for embedded action triggers.
 *
 * The character can embed special tags in her response to trigger media:
 *   [SELFIE: casual selfie in coffee shop]
 *   [VOICE: text to speak aloud]
 *   [VIDEO: short clip of ocean waves]
 */
function parseResponseActions(raw: string, language: string = 'en'): OutgoingMessage {
  const actions: OutgoingMessage['actions'] = []
  let text = raw

  // ---------------------------------------------------------------------------
  // Phase 1: Strip ALL roleplay narration — aggressive patterns for CJK + English
  // ---------------------------------------------------------------------------

  // Chinese roleplay narration: (轻声笑了笑，带着一丝宠溺的语气) etc.
  // Match ANY parenthetical that contains CJK characters (these are always narration, never real text messages)
  text = text.replace(/\([^)]*[\u4e00-\u9fff\u3400-\u4dbf][^)]*\)\s*/g, '')

  // English roleplay narration: (picks up phone), (laughs softly), (smiles), etc.
  text = text.replace(/\((?:picks up|grabs|takes out|looks at|pulls out|opens|closes|puts down|reaches for|holds up|leans|sits|stands|walks|steps|turns|glances|stares|gazes|smiles|laughs|giggles|sighs|whispers|murmurs|blushes|nods|shakes|waves|winks|grins|chuckles|snorts|rolls eyes|bites lip|tilts head|runs hand|tucks hair|adjusts|fidgets|stretches|yawns)[^)]*\)\s*/gi, '')

  // Asterisk roleplay: *smiles softly*, *laughs*, *picks up phone*
  text = text.replace(/\*[^*]{2,60}\*\s*/g, '')

  // Chinese-wrapped media tags: [发送照片：...], [发送语音：...], etc.
  text = text.replace(/\[发送(?:照片|语音|视频)[：:]\s*/gi, '')

  // Strip brackets wrapping the entire response — LLM sometimes mimics [placeholder]
  // patterns from conversation history and wraps its whole reply in [...]
  if (text.startsWith('[') && text.endsWith(']') && !text.includes('SELFIE') && !text.includes('VOICE') && !text.includes('VIDEO')) {
    text = text.slice(1, -1)
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Strip hallucinated old media URLs
  // ---------------------------------------------------------------------------
  text = text.replace(/\[image:\/api\/media\/[^\]\s]*\]?/gi, '')
  text = text.replace(/\[voice:\/api\/media\/[^\]\s]*\]?/gi, '')

  // ---------------------------------------------------------------------------
  // Phase 3: Extract media action tags
  // ---------------------------------------------------------------------------

  // Helper: parse image tag content into style + prompt
  const parseImageTag = (rawContent: string): { prompt: string; style: string } => {
    const validStyles = ['casual', 'mirror', 'close-up', 'location']
    const parts = rawContent.split('|').map((s: string) => s.trim())
    let style: string | undefined
    let prompt: string

    if (parts.length >= 2 && validStyles.includes(parts[0].toLowerCase())) {
      style = parts[0].toLowerCase()
      prompt = parts.slice(1).join('|').trim()
    } else {
      prompt = rawContent.trim()
      const lower = prompt.toLowerCase()
      if (lower.includes('mirror')) style = 'mirror'
      else if (lower.includes('close') || lower.includes('face')) style = 'close-up'
      else if (lower.includes('outside') || lower.includes('park') || lower.includes('beach') || lower.includes('street') || lower.includes('cafe') || lower.includes('restaurant')) style = 'location'
      else style = 'casual'
    }

    return { prompt, style: style ?? 'casual' }
  }

  // Extract SELFIE/IMAGE tags — match both [SELFIE: ...] and (SELFIE: ...)
  // The LLM sometimes uses parentheses, curly braces, or mixed brackets
  text = text.replace(/[\[(\{](?:SELFIE|IMAGE):\s*([^\])\}]+)[\])\}]/gi, (_, raw) => {
    const { prompt, style } = parseImageTag(raw)
    actions.push({ type: 'send_image', prompt, style })
    return ''
  })

  // Extract [VOICE: ...] / (VOICE: ...) tags
  text = text.replace(/[\[(\{]VOICE:\s*([^\])\}]+)[\])\}]/gi, (_, content) => {
    actions.push({ type: 'send_voice', text: content.trim() })
    return ''
  })

  // Extract [VIDEO: ...] / (VIDEO: ...) tags
  text = text.replace(/[\[(\{]VIDEO:\s*([^\])\}]+)[\])\}]/gi, (_, prompt) => {
    actions.push({ type: 'send_video', prompt: prompt.trim() })
    return ''
  })

  // ---------------------------------------------------------------------------
  // Phase 4: Post-process — enforce language in SELFIE/VOICE/VIDEO descriptions
  // ---------------------------------------------------------------------------
  // If the character language is English but the LLM wrote CJK in the descriptions,
  // flag it with a debug log and strip the CJK content (image gen won't understand it anyway).
  if (language === 'en') {
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/
    for (const action of actions) {
      if (action.type === 'send_image' && hasCJK.test(action.prompt)) {
        // Replace CJK characters with empty string — leaves English words intact
        const cleaned = action.prompt.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af，。！？、：；""''（）【】]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
        debugLog(`[Parser] Stripped CJK from SELFIE prompt: "${action.prompt}" → "${cleaned}"`)
        action.prompt = cleaned || 'casual selfie, natural lighting'
      }
      if (action.type === 'send_voice' && hasCJK.test(action.text)) {
        const cleaned = action.text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af，。！？、：；""''（）【】]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
        debugLog(`[Parser] Stripped CJK from VOICE text: "${action.text}" → "${cleaned}"`)
        action.text = cleaned || 'hey'
      }
    }
    // Also strip any remaining CJK from the main response text (the LLM violated the language rule)
    if (hasCJK.test(text)) {
      debugLog(`[Parser] WARNING: Response contains CJK text despite language=en. Stripping CJK characters.`)
      text = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af，。！？、：；""''（）【】]+/g, '').replace(/\s{2,}/g, ' ').trim()
    }
  }

  return {
    text: text.trim(),
    actions: actions.length > 0 ? actions : undefined,
  }
}

/**
 * Detect what media the user is requesting: 'selfie', 'voice', 'video', or null.
 * Priority: video > voice > selfie (more specific first).
 * Supports English and Chinese.
 */
function detectMediaIntent(content: string): 'selfie' | 'voice' | 'video' | 'tweet' | null {
  const lower = content.toLowerCase()

  // Tweet / social post patterns (check first — very specific intent)
  const tweetPatterns = [
    /send.*tweet/i, /post.*tweet/i, /tweet.*for me/i, /tweet.*something/i,
    /post (on|to) (twitter|x)\b/i, /share.*(twitter|x)\b/i,
    /发推/i, /发.*推特/i, /发.*twitter/i, /推特.*发/i,
    /can you tweet/i, /write a tweet/i, /make a tweet/i,
    /post (it|this|that) (on|to)/i,
  ]
  if (tweetPatterns.some(p => p.test(lower))) return 'tweet'

  // Video patterns (check first — most specific)
  const videoPatterns = [
    /video/i, /\bclip\b/i, /\bfilm\b/i, /record.*for me/i,
    /视频/i, /录像/i, /录.*视/i, /发.*视频/i,
  ]
  if (videoPatterns.some(p => p.test(lower))) return 'video'

  // Voice patterns
  const voicePatterns = [
    /voice/i, /hear (you|your)/i, /listen to you/i, /say something/i,
    /talk to me/i, /speak/i, /audio/i, /send.*voice/i,
    /声音/i, /语音/i, /说话/i, /听.*你/i, /发.*语音/i,
    /wanna hear/i, /want to hear/i, /sing/i,
  ]
  if (voicePatterns.some(p => p.test(lower))) return 'voice'

  // Selfie / photo patterns (broadest — check last)
  // ONLY match EXPLICIT requests for photos/selfies/pictures.
  // Do NOT match casual questions like "what are you doing", "how are you", etc.
  // Only match EXPLICIT requests for photos. Reject messages that mention
  // "selfie" in a non-request context (e.g., "why did you send me this selfie?")
  const antiSelfiePatterns = [
    /why.*(send|sent).*selfie/i,
    /why.*selfie/i,
    /stop.*send/i,
    /don't.*send/i,
    /didn't.*ask/i,
    /this selfie/i,
    /that selfie/i,
  ]
  if (antiSelfiePatterns.some(p => p.test(lower))) return null

  const selfiePatterns = [
    /send me a (selfie|photo|pic|picture)/i,
    /take a (selfie|photo|pic|picture)/i,
    /give me a (selfie|photo|pic|picture)/i,
    /can you send.*(selfie|photo|pic|picture)/i,
    /photo of you/i, /picture of you/i, /pic of you/i,
    /show me (a )?(selfie|photo|pic|picture)/i,
    /let me see you/i, /what.*look like/i,
    /看看你/i, /自拍/i, /发.*照/i, /拍.*照/i,
    /想看你/i,
    /show me.*(view|window|room|setup|food|drink|matcha)/i,
    /send.*(view|window|room|setup|food|drink|matcha).*photo/i,
    /看.*窗/i, /看.*外面/i, /看.*房间/i,
  ]
  if (selfiePatterns.some(p => p.test(lower))) return 'selfie'

  return null
}

/** Legacy alias for backward compatibility */
function isSelfieRequest(content: string): boolean {
  return detectMediaIntent(content) === 'selfie'
}

/**
 * Detect when LLM is "pretending" to send media without using tags.
 * DeepSeek often outputs "here you go" + blank lines where a [SELFIE:] tag should be.
 *
 * Strategy:
 * 1. Check if LLM response has "sending" language + suspicious blank gaps
 * 2. Infer media type from BOTH user message AND LLM response content
 *    - LLM says "here's a clip/video" → video
 *    - LLM says "listen to this" / user asked for voice → voice
 *    - LLM says "here's a photo" / user asked for photo → image
 * 3. Require either user request intent OR strong LLM sending intent
 *    to prevent false positives on casual chat ("photo is ok babe")
 */
function detectPretendMedia(
  userMessage: string,
  llmResponse: string
): { type: 'image' | 'voice' | 'video' } | null {
  const llmLower = llmResponse.toLowerCase()
  const userLower = userMessage.toLowerCase()

  // LLM is pretending to send something if it uses "here" phrases with blank line gaps
  const pretendPatterns = [
    /here you go/i, /here it is/i, /here's (the|a|my)/i,
    /there you go/i, /sending it/i, /let me send/i,
    /sent it/i, /attached/i, /took a (quick|little)/i,
    /给你/i, /发给你/i, /这是/i, /拍了/i, /录了/i,
  ]
  const isPretending = pretendPatterns.some(p => p.test(llmLower))
  if (!isPretending) return null

  // Has suspicious blank line gaps (where a tag should have been)
  const hasGaps = /\n\s*\n\s*\n/.test(llmResponse)
  if (!hasGaps) return null

  // --- Determine intent source ---

  // User explicitly requested media?
  // Broad action verbs + media nouns (English and Chinese)
  const userHasActionVerb = /send|show|see|take|give|wanna|want|can (i|you)|let me|拍|发|看|给|要|hear|listen/.test(userLower)
  const userHasMediaNoun = /photo|pic|image|selfie|video|clip|voice|audio|hear|照|图|拍|视频|语音|声音|sing|歌|view|风景|窗|matcha|food|setup|room/.test(userLower)
  const userWantsMedia = userHasActionVerb && userHasMediaNoun

  // User following up on missing media?
  const userFollowUp = /where.*(photo|pic|image|video|clip|selfie|it)|没(有)?发|没收到|怎么没|didn't (send|attach|go)/i.test(userLower)

  // LLM response indicates specific media type being sent
  const llmSendsVideo = /here's.*(clip|video|recording)|quick (clip|video)|录.*(了|好)/i.test(llmLower)
  const llmSendsVoice = /here's.*(voice|audio|recording)|listen to (this|me)|hear (this|me)|说给你听|唱给你/i.test(llmLower)
  // Note: llmSendsImage alone is NOT enough — LLM can say "here's a photo" as roleplay
  // without the user asking for it. Only count as intent if user ALSO has a request verb.
  const llmSendsImage = /here's.*(photo|pic|selfie|shot|view)|took.*(photo|pic|shot)|拍了.*照/i.test(llmLower)

  // For video/voice, LLM intent alone is sufficient (rare false positives)
  // For image, require EITHER user request OR (llm intent + user has action verb)
  const hasIntent = userWantsMedia || userFollowUp || llmSendsVideo || llmSendsVoice
    || (llmSendsImage && userHasActionVerb)

  if (!hasIntent) {
    debugLog(`[Engine] Pretend-send suppressed: no media intent in user="${userMessage.slice(0, 50)}" or LLM response`)
    return null
  }

  // --- Determine media TYPE ---
  // Priority: USER explicit type > LLM type > default image
  // User intent overrides LLM — DeepSeek often says "here's a video" when user asked for a photo

  const userWantsVideo = /video|clip|film|视频|录像/.test(userLower)
  const userWantsVoice = /voice|hear|listen|speak|sing|声音|语音|唱/.test(userLower)
  const userWantsImage = /photo|pic|image|selfie|view|风景|窗|照|图|see/.test(userLower)

  // If user explicitly asked for a specific type, respect that
  if (userWantsVideo && !userWantsImage) return { type: 'video' }
  if (userWantsVoice) return { type: 'voice' }
  if (userWantsImage && !userWantsVideo) return { type: 'image' }

  // No clear user type — fall back to LLM signals
  if (llmSendsVideo) return { type: 'video' }
  if (llmSendsVoice) return { type: 'voice' }

  // Default to image
  return { type: 'image' }
}

/**
 * Extract video context from user message and LLM response.
 *
 * @param currentActivity — When provided by the ActivityManager, overrides
 *   the text-based activity guessing so the video matches the displayed status.
 */
function extractVideoContext(userMessage: string, llmResponse: string, characterName: string, identity?: string, timezone?: string, currentActivity?: string): string {
  const combined = `${userMessage} ${llmResponse}`.toLowerCase()
  const locationContext = extractLocationContext(combined)

  // When a real activity is available from the ActivityManager, use it instead of
  // guessing from conversation text. This ensures the video matches the status display.
  const activityContext = currentActivity
    ? activityToSelfieContext(currentActivity)
    : extractActivityContext(combined)

  // Pass identity so outfit picks from the character's actual wardrobe
  const outfitContext = extractOutfitContext(combined, identity)
  // Use character's timezone for accurate lighting
  const timeContext = extractTimeContext(combined, timezone)

  // Key visual traits first for prominence
  const keyTraits = identity ? extractKeyVisualTraits(identity) : ''
  const appearanceDesc = identity ? extractAppearanceFromIdentity(identity) : ''

  const parts = [
    `short video clip of ${characterName}`,
  ]

  if (keyTraits) {
    parts.push(keyTraits)
  }

  if (appearanceDesc) {
    parts.push(`(character appearance: ${appearanceDesc})`)
  }

  parts.push(
    ...[outfitContext, activityContext || 'natural expression', locationContext, timeContext].filter(Boolean)
  )

  // Append user's original description as supplementary context
  if (userMessage.length > 10) {
    parts.push(`(user requested: ${userMessage.slice(0, 120)})`)
  }

  return parts.join(', ')
}

/**
 * Extract tweet text from the LLM response.
 * The LLM usually writes the tweet content in quotes or as the main text body.
 */
function extractTweetText(llmResponse: string): string {
  // Try to find quoted text first (LLM often puts tweet in quotes)
  const quotedMatch = llmResponse.match(/"([^"]{5,280})"/)
  if (quotedMatch) return quotedMatch[1]

  // Try single quotes
  const singleQuoted = llmResponse.match(/'([^']{5,280})'/)
  if (singleQuoted) return singleQuoted[1]

  // Otherwise use the full response text, cleaned up
  const cleaned = llmResponse
    .replace(/\[.*?\]/g, '')           // remove action tags
    .replace(/\*.*?\*/g, '')           // remove italics/roleplay
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 280)

  return cleaned || 'just vibing ✨'
}

/**
 * Extract the "## Appearance" section from a character's IDENTITY.md content.
 * Returns a trimmed string of the appearance description, or empty string if not found.
 */
function extractAppearanceFromIdentity(identity: string): string {
  const appearanceMatch = identity.match(/##\s*Appearance\s*\n([\s\S]*?)(?=\n##\s|\n---|$)/i)
  if (!appearanceMatch) return ''

  // Filter out stage/performance costume sentences — they confuse image
  // models when generating casual selfies with long irrelevant descriptions
  const fullText = appearanceMatch[1].replace(/\s+/g, ' ').trim()
  const sentences = fullText.split(/(?<=\.)\s+/)
  const filtered = sentences.filter((s) => {
    const lower = s.toLowerCase()
    if (
      lower.includes('on stage') ||
      lower.includes('in promo') ||
      lower.includes('stage rig') ||
      lower.includes('during performance') ||
      lower.includes('projecting from') ||
      lower.includes('pulse to the beat') ||
      lower.includes('crystalline') ||
      (lower.includes('holographic') && lower.includes('cape'))
    ) {
      return false
    }
    return true
  })

  const result = filtered.join(' ').trim()
  return result.length > 350 ? result.slice(0, 347) + '...' : result
}

/**
 * Extract the most visually distinctive features from the Appearance section.
 * These are placed at the FRONT of the prompt so image models prioritize them.
 * Focuses on: hair color/style, eye color, skin tone, and unique markings.
 */
function extractKeyVisualTraits(identity: string): string {
  const appearanceMatch = identity.match(/##\s*Appearance\s*\n([\s\S]*?)(?=\n##\s|\n---|$)/i)
  if (!appearanceMatch) return ''

  const text = appearanceMatch[1]
  const traits: string[] = []

  // Extract hair description (color + style are the most visually impactful)
  const hairPatterns = [
    /(?:hair|hair color)[^.]*(?:black|blonde|brunette|red|silver|lavender|pink|blue|purple|white|platinum|auburn|copper|ombre|gradient|holographic)[^.]*\./gi,
    /(?:black|blonde|brunette|red|silver|lavender|pink|blue|purple|white|platinum|auburn|copper)[^.]*hair[^.]*/gi,
    /(?:sleek|long|short|waist-length|shoulder-length|cropped)[^.]*hair[^.]*/gi,
  ]
  for (const pattern of hairPatterns) {
    const match = text.match(pattern)
    if (match) {
      traits.push(match[0].trim().replace(/\.$/, ''))
      break // only first hair match
    }
  }

  // Extract eye description
  const eyePatterns = [
    /(?:eyes?|pupils?)[^.]*(?:brown|blue|green|hazel|amber|crimson|violet|heterochromia|feline|almond|dark)[^.]*/gi,
    /(?:brown|blue|green|hazel|amber|crimson|violet|feline|sharp|dark almond)[^.]*eyes?[^.]*/gi,
  ]
  for (const pattern of eyePatterns) {
    const match = text.match(pattern)
    if (match) {
      traits.push(match[0].trim().replace(/\.$/, ''))
      break
    }
  }

  // Extract skin description
  const skinMatch = text.match(/(?:skin|complexion)[^.]*(?:pale|dark|tan|sun-kissed|luminous|warm|olive|fair|ebony|porcelain)[^.]*/i)
    ?? text.match(/(?:pale|dark|tan|sun-kissed|luminous|warm|olive|fair|ebony|porcelain)[^.]*skin[^.]*/i)
  if (skinMatch) {
    traits.push(skinMatch[0].trim().replace(/\.$/, ''))
  }

  // Extract distinctive markings (tattoos, scars, beauty marks, piercings, vitiligo)
  const markingPatterns = [
    /tattoo[^.]*/gi,
    /beauty mark[^.]*/gi,
    /vitiligo[^.]*/gi,
    /scar[^.]*/gi,
    /piercing[^.]*/gi,
    /marking[^.]*/gi,
    /seal[^.]*/gi,
  ]
  for (const pattern of markingPatterns) {
    const match = text.match(pattern)
    if (match) {
      traits.push(match[0].trim().replace(/\.$/, ''))
    }
  }

  return traits.join(', ')
}

/**
 * Extract context from BOTH the user's message and LLM response to build a rich selfie prompt.
 * Uses conversation context to determine scene, outfit, activity, and time of day.
 * Incorporates the character's appearance from IDENTITY.md so the selfie matches their look.
 *
 * @param currentActivity — When provided by the ActivityManager, this overrides
 *   the text-based activity guessing so the selfie matches the displayed status.
 */
function extractSelfieContext(userMessage: string, llmResponse: string, characterName: string, identity?: string, timezone?: string, currentActivity?: string): string {
  const combined = `${userMessage} ${llmResponse}`.toLowerCase()

  // Extract time/setting context — use character's timezone for accurate lighting
  const timeContext = extractTimeContext(combined, timezone)
  const locationContext = extractLocationContext(combined)
  // Pass identity so outfit picks from the character's actual wardrobe
  const outfitContext = extractOutfitContext(combined, identity)

  // When a real activity is available from the ActivityManager, use it instead of
  // guessing from conversation text. This ensures the selfie matches the status display.
  const activityContext = currentActivity
    ? activityToSelfieContext(currentActivity)
    : extractActivityContext(combined)

  // Extract key visual traits (hair/eye color, markings) — these go FIRST for prominence
  const keyTraits = identity ? extractKeyVisualTraits(identity) : ''
  // Extract broader appearance context
  const appearanceDesc = identity ? extractAppearanceFromIdentity(identity) : ''

  const parts = [
    `selfie of ${characterName}`,
  ]

  // Key visual traits go first — image models weight early tokens more heavily
  if (keyTraits) {
    parts.push(keyTraits)
  }

  // Broader appearance context follows
  if (appearanceDesc) {
    parts.push(`(character appearance: ${appearanceDesc})`)
  }

  parts.push(
    ...[outfitContext, locationContext, activityContext, timeContext].filter(Boolean)
  )

  // Append user's original description as supplementary context
  if (userMessage.length > 10) {
    parts.push(`(user requested: ${userMessage.slice(0, 120)})`)
  }

  return parts.join(', ')
}

/**
 * Convert a real ActivityManager activity description into a selfie-appropriate
 * visual context string for the image generator.
 */
function activityToSelfieContext(activity: string): string {
  const lower = activity.toLowerCase()

  if (/league|gaming|game|playing/.test(lower)) return 'at gaming desk, headset on, screen glow, gaming setup visible'
  if (/listening|spotify|music|track/.test(lower)) return 'wearing earbuds, vibing to music, relaxed expression'
  if (/watching|netflix|drama|youtube|video/.test(lower)) return 'screen glow on face, watching something, cozy'
  if (/browsing|scrolling|pinterest|reddit|twitter/.test(lower)) return 'casually scrolling phone, relaxed'
  if (/cooking|food|eating|dinner|lunch|breakfast/.test(lower)) return 'in kitchen, food visible'
  if (/coffee|tea|matcha|drink/.test(lower)) return 'holding a warm drink'
  if (/reading|book/.test(lower)) return 'with a book nearby, reading'
  if (/studying|homework|notes/.test(lower)) return 'studying, books and notes around'
  if (/sketch|draw|paint|art/.test(lower)) return 'sketching or drawing, art supplies visible'
  if (/gym|boxing|exercise|workout/.test(lower)) return 'at gym, athletic setting, workout gear'
  if (/shopping|thrift|store/.test(lower)) return 'out shopping, browsing racks'
  if (/sleeping|zzz|passed out|dreaming/.test(lower)) return 'in bed, sleepy, cozy blankets'

  // Fallback: use the activity description directly as visual context
  return activity
}

/**
 * Compute time-of-day lighting context from a timezone string.
 * Uses the character's local time to determine appropriate lighting.
 */
function getTimeOfDayFromTimezone(timezone: string): string {
  let hour: number
  try {
    const hourStr = new Date().toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    })
    hour = parseInt(hourStr, 10)
  } catch {
    hour = new Date().getHours()
  }

  if (hour >= 6 && hour < 9) return 'early morning, soft golden sunrise light'
  if (hour >= 9 && hour < 12) return 'morning, bright natural daylight'
  if (hour >= 12 && hour < 15) return 'afternoon, warm sunlight'
  if (hour >= 15 && hour < 18) return 'late afternoon, golden hour warm glow'
  if (hour >= 18 && hour < 21) return 'evening, warm indoor lighting, sunset tones'
  if (hour >= 21 || hour < 1) return 'nighttime, warm lamp lighting, dim cozy ambiance'
  return 'late night, dim soft lighting, dark outside'
}

function extractTimeContext(text: string, timezone?: string): string {
  // Explicit conversation keywords override timezone-based calculation
  if (/sleep|bed|night|晚安|睡觉|困了|sleepy|tired|exhausted|黑|dark|midnight|凌晨|深夜|半夜|路灯|月光|moonlight|streetlight/.test(text)) return 'nighttime, soft warm lamp lighting, cozy bedroom atmosphere'
  if (/morning|wake|早上|起床|just woke/.test(text)) return 'early morning, soft natural window light, just woke up'
  if (/afternoon|lunch|中午|下午/.test(text)) return 'afternoon, bright natural daylight'
  if (/evening|sunset|晚上|傍晚|dinner/.test(text)) return 'evening, golden hour warm lighting'

  // No explicit time keywords — use character's actual timezone for accurate lighting
  if (timezone) {
    return getTimeOfDayFromTimezone(timezone)
  }
  return 'natural lighting'
}

function extractLocationContext(text: string): string {
  if (/beach|sea|ocean|shore|海边|海滩|沙滩/.test(text)) return 'on a beautiful sandy beach, ocean waves, tropical vibes'
  if (/pool|swimming|泳池|游泳/.test(text)) return 'at a sparkling swimming pool'
  if (/mountain|hiking|hill|山|登山|爬山/.test(text)) return 'mountain scenery, hiking trail, panoramic view'
  if (/forest|woods|jungle|树林|森林/.test(text)) return 'in a lush forest, dappled sunlight through trees'
  if (/garden|花园|院子|yard/.test(text)) return 'in a beautiful garden, surrounded by flowers'
  if (/snow|winter|skiing|雪|冬天|滑雪/.test(text)) return 'in a snowy winter wonderland'
  if (/rooftop|天台|楼顶/.test(text)) return 'on a rooftop, city skyline in background'
  if (/balcony|阳台/.test(text)) return 'on a cozy balcony, overlooking the view'
  if (/restaurant|dining|餐厅|饭店/.test(text)) return 'at a nice restaurant, elegant ambient lighting'
  if (/bar|club|pub|nightclub|酒吧|夜店/.test(text)) return 'at a bar, moody neon lighting, cocktail vibes'
  if (/mall|shopping|商场|购物/.test(text)) return 'at a stylish shopping mall'
  if (/school|university|campus|学校|大学|校园/.test(text)) return 'at school campus, youthful atmosphere'
  if (/library|图书馆/.test(text)) return 'in a quiet library, warm reading light'
  if (/train|subway|metro|地铁|火车/.test(text)) return 'on a train, window view passing by'
  if (/airport|plane|机场|飞机/.test(text)) return 'at the airport terminal'
  if (/bed|bedroom|pillow|blanket|床|卧室/.test(text)) return 'in bed, cozy bedroom'
  if (/kitchen|cook|baking|厨房|做饭/.test(text)) return 'in the kitchen'
  if (/cafe|coffee|starbucks|matcha|咖啡|奶茶/.test(text)) return 'at a cozy cafe'
  if (/office|work|desk|办公|工作/.test(text)) return 'at desk, workspace'
  if (/outside|park|walk|street|外面|公园|散步/.test(text)) return 'outdoors, natural environment'
  if (/gym|workout|exercise|健身|运动/.test(text)) return 'at the gym'
  if (/bath|shower|洗澡/.test(text)) return 'bathroom mirror, steam'
  if (/sofa|couch|living room|沙发|客厅/.test(text)) return 'on the couch, living room'
  if (/car|drive|开车|车里/.test(text)) return 'in the car'
  if (/room|my room|房间|屋里/.test(text)) return 'in cozy room, warm ambient lighting'
  if (/home|apartment|house|家里/.test(text)) return 'at home, cozy interior'
  return ''
}

/**
 * Extract outfit descriptions from the character's Appearance section in IDENTITY.md.
 * Parses "on stage" / "off stage" / "Her style is" blocks and clothing descriptions.
 * Returns an array of outfit strings the character actually wears.
 */
function extractCharacterOutfits(identity: string): string[] {
  const appearanceMatch = identity.match(/##\s*Appearance\s*\n([\s\S]*?)(?=\n##\s|\n---|$)/i)
  if (!appearanceMatch) return []

  const appearanceText = appearanceMatch[1]
  const outfits: string[] = []

  // Match labeled outfit blocks: "On stage:", "Off stage:", "In promo:", etc.
  const labeledOutfitPattern = /(?:on[- ]?stage|off[- ]?stage|off[- ]?duty|in promo|performing|casual(?:ly)?)[^:]*:\s*([^\n]+)/gi
  let labelMatch: RegExpExecArray | null
  while ((labelMatch = labeledOutfitPattern.exec(appearanceText)) !== null) {
    const outfitDesc = labelMatch[1].trim()
    if (outfitDesc.length > 5) {
      outfits.push(outfitDesc)
    }
  }

  // Match "Her style is..." / "She dresses like..." / "Wears..." sentences
  // Exclude "wears makeup" and "never wears" false positives
  const stylePatterns = [
    /(?:her )?style is ([^.\n]+)/gi,
    /(?:she )?dresses? like ([^.\n]+)/gi,
    /(?:she )?wears? (?!makeup|no )([^.\n]{10,150})/gi,
  ]
  for (const pattern of stylePatterns) {
    let styleMatch: RegExpExecArray | null
    while ((styleMatch = pattern.exec(appearanceText)) !== null) {
      const desc = styleMatch[1].trim()
      // Skip if preceded by "never" or "doesn't" (negation)
      const precedingText = appearanceText.slice(Math.max(0, styleMatch.index - 10), styleMatch.index).toLowerCase()
      if (/never|doesn'?t|don'?t|no\s/.test(precedingText)) continue
      if (desc.length > 10 && desc.length < 200) {
        outfits.push(desc)
      }
    }
  }

  return outfits
}

function extractOutfitContext(text: string, identity?: string): string {
  // First check if the user/LLM explicitly mentioned a specific outfit in conversation
  if (/bikini|比基尼/.test(text)) return 'wearing a stylish bikini'
  if (/swimsuit|swimwear|泳衣|泳装/.test(text)) return 'wearing a swimsuit'
  if (/crop.?top|露脐/.test(text)) return 'wearing a crop top'
  if (/skirt|短裙|半裙/.test(text)) return 'wearing a cute skirt'
  if (/shorts|短裤|热裤/.test(text)) return 'wearing shorts'
  if (/kimono|和服|浴衣/.test(text)) return 'wearing a kimono'
  if (/uniform|制服|校服/.test(text)) return 'wearing a uniform'
  if (/jacket|夹克|外套/.test(text)) return 'wearing a jacket'
  if (/coat|大衣|风衣/.test(text)) return 'wearing a coat'
  if (/tank.?top|背心|吊带/.test(text)) return 'wearing a tank top'
  if (/jeans|牛仔裤/.test(text)) return 'wearing jeans'
  if (/pajama|pj|睡衣|nightgown/.test(text)) return 'wearing comfortable pajamas'
  if (/dress|裙子|连衣裙/.test(text)) return 'wearing a cute dress'
  if (/workout|gym|sport|运动/.test(text)) return 'wearing athletic wear'
  if (/suit|formal|正装/.test(text)) return 'dressed formally'
  if (/towel|bath|浴巾/.test(text)) return 'wrapped in a towel, fresh from shower'
  if (/sweater|毛衣/.test(text)) return 'wearing a soft sweater'

  // Time-of-day sleepwear (always takes priority over wardrobe)
  if (/morning|wake|just woke|sleep|bed|sleepy/.test(text)) return 'wearing comfortable sleepwear'

  // If we have character identity, pick from their actual wardrobe instead of defaulting
  if (identity) {
    const characterOutfits = extractCharacterOutfits(identity)
    if (characterOutfits.length > 0) {
      const idx = Math.floor(Math.random() * characterOutfits.length)
      return `wearing ${characterOutfits[idx]}`
    }
  }

  // No character wardrobe available — minimal fallback (empty string lets
  // the appearance description from IDENTITY.md speak for itself)
  if (/night|evening|relax|chill/.test(text)) return 'in comfortable loungewear'
  return ''
}

function extractActivityContext(text: string): string {
  if (/eat|food|cooking|dinner|lunch|breakfast|吃|做饭|cooking/.test(text)) return 'with food visible'
  if (/coffee|tea|matcha|drink|喝|咖啡|茶|奶茶/.test(text)) return 'holding a warm drink'
  if (/read|book|reading|看书|阅读/.test(text)) return 'with a book nearby'
  if (/game|gaming|playing|游戏|打游戏/.test(text)) return 'gaming setup visible'
  if (/study|homework|学习|作业/.test(text)) return 'studying, books and notes around'
  if (/music|listen|听歌|音乐/.test(text)) return 'wearing earbuds, vibing to music'
  if (/watch|movie|drama|看剧|电影/.test(text)) return 'screen glow on face, watching something'
  if (/computer|laptop|coding|电脑/.test(text)) return 'laptop open nearby'
  if (/chill|relax|hang|lounging|resting|放松|休息|发呆/.test(text)) return 'relaxing, looking comfortable and at ease'
  if (/sketch|draw|paint|art|画|写/.test(text)) return 'sketching or drawing, art supplies visible'
  if (/phone|scroll|刷手机/.test(text)) return 'casually scrolling phone'
  return ''
}

/**
 * Infer the best selfie style from conversation context.
 */
/**
 * Detect if the user is asking for a SCENE photo (landscape, view, object)
 * rather than a selfie/photo of the character.
 */
function detectSceneRequest(userMessage: string, llmResponse: string): boolean {
  const combined = `${userMessage} ${llmResponse}`.toLowerCase()

  // User-side scene patterns
  const scenePatterns = [
    /window view/i, /view from/i, /the view/i, /outside.*(window|view)/i,
    /sunset/i, /sunrise/i, /landscape/i, /scenery/i,
    /show.*room/i, /show.*setup/i, /show.*desk/i, /show.*food/i,
    /what.*eating/i, /what.*drinking/i, /what.*cooking/i,
    /dinner/i, /lunch/i, /breakfast/i, /meal/i,
    /see.*room/i, /see.*place/i, /see.*setup/i,
    /matcha/i, /coffee.*cup/i, /food.*photo/i,
    /窗外/i, /风景/i, /看.*窗/i, /看.*外面/i,
    /not you/i, /not.*selfie/i, /not.*face/i,
  ]

  // LLM response scene patterns — if the LLM describes sending a scene photo
  const llmScenePatterns = [
    /photo.*(of|i took).*(flower|plant|tree|garden|sky|cloud|ocean|beach|mountain)/i,
    /photo.*(of|i took).*(food|meal|dish|cake|dessert|drink|matcha|coffee|tea)/i,
    /photo.*(of|i took).*(room|desk|setup|view|window|sunset|sunrise)/i,
    /here's.*(the view|my view|the sky|the sunset|the sunrise|my room|my desk|my setup)/i,
    /here's.*(my dinner|my lunch|my breakfast|my meal|my food|my matcha|my coffee)/i,
    /flower|floral|bouquet|bloom/i,
    /farmer'?s? market/i,
    /市场|花|风景|日落|日出|房间|桌子|晚餐|午餐|早餐/i,
  ]

  const userLower = userMessage.toLowerCase()
  if (/not (you|your face|a selfie)/i.test(userLower)) return true
  if (scenePatterns.some(p => p.test(combined))) return true

  // Check LLM response specifically for scene descriptions
  const llmLower = llmResponse.toLowerCase()
  if (llmScenePatterns.some(p => p.test(llmLower))) return true

  return false
}

/**
 * Extract scene context for non-selfie photo requests.
 * Generates a prompt describing the scene, not the character.
 */
function extractSceneContext(userMessage: string, llmResponse: string, characterName: string): string {
  const combined = `${userMessage} ${llmResponse}`.toLowerCase()
  const parts: string[] = []

  // Determine the scene subject from context
  if (/window|view|outside|窗/.test(combined)) {
    const isNight = /night|黑|dark|midnight|凌晨|深夜|半夜|路灯|月光|moonlight|streetlight|晚上/.test(combined)
    if (isNight) {
      parts.push('nighttime view from apartment window, dark sky')
      if (/路灯|streetlight|street.?light/.test(combined)) parts.push('dim streetlights below')
      if (/月|moon/.test(combined)) parts.push('moonlight visible')
      parts.push('city lights in the distance, quiet night atmosphere')
    } else {
      parts.push('view from a cozy apartment window')
      if (/haz[ey]|fog|mist/.test(combined)) parts.push('slightly hazy atmosphere')
      if (/tree|bloom|flower/.test(combined)) parts.push('trees visible outside')
      if (/city|urban|building/.test(combined)) parts.push('city skyline in the distance')
      else parts.push('peaceful neighborhood view')
    }
  } else if (/matcha|coffee|tea|drink|cup/.test(combined)) {
    parts.push('aesthetic matcha latte on a wooden table')
    parts.push('cozy cafe ambiance')
  } else if (/food|eat|cook|meal/.test(combined)) {
    parts.push('delicious home-cooked meal')
    parts.push('warm kitchen lighting')
  } else if (/setup|desk|workspace/.test(combined)) {
    parts.push('aesthetic desk setup with warm lighting')
    parts.push('sketchbook and stationery visible')
  } else if (/flower|floral|bouquet|bloom|garden/.test(combined)) {
    parts.push('beautiful fresh flowers close-up')
    if (/market|farmer/.test(combined)) parts.push('at a farmer\'s market stall')
    else parts.push('natural soft lighting')
  } else if (/room|place|apartment/.test(combined)) {
    parts.push('cozy apartment interior')
    parts.push('warm ambient lighting')
  } else if (/sunset|sunrise/.test(combined)) {
    parts.push('beautiful sunset sky')
    parts.push('warm golden and pink hues')
  } else if (/sky|cloud|outdoor|outside|park|street/.test(combined)) {
    parts.push('beautiful outdoor scenery')
    parts.push('natural daylight')
  } else {
    // Generic scene from LLM response context — try to extract nouns
    const llmLower = llmResponse.toLowerCase()
    const subjectMatch = llmLower.match(/photo.*(of|i took)\s+(?:some\s+)?(.{5,40})/)
    if (subjectMatch) {
      parts.push(subjectMatch[2].replace(/[.!,].*/, '').trim())
    } else {
      parts.push(`scene described by ${characterName}`)
    }
  }

  // Add time context
  const timeCtx = extractTimeContext(combined)
  if (timeCtx !== 'natural lighting') parts.push(timeCtx)
  else parts.push('natural lighting, high quality photo')

  return parts.join(', ')
}

function inferSelfieStyle(userMessage: string, llmResponse: string): string {
  const combined = `${userMessage} ${llmResponse}`.toLowerCase()
  if (/mirror|outfit|dress|全身|穿搭/.test(combined)) return 'mirror'
  if (/outside|park|beach|street|travel|cafe|restaurant|外面|公园|咖啡/.test(combined)) return 'location'
  if (/close|face|eyes|cute|脸|眼睛/.test(combined)) return 'close-up'
  return 'casual'
}

/**
 * Align an image prompt with a voice message to ensure visual coherence.
 *
 * When the LLM outputs BOTH [SELFIE: ...] and [VOICE: ...], they might
 * describe different scenes because the LLM generates them independently.
 * Even when they match at the LLM level, the image generation model may
 * ignore the scene context if it's buried under generic style tokens.
 *
 * This function:
 * 1. Extracts scene keywords from the voice text (location, activity, objects, time)
 * 2. Checks if the image prompt already contains those keywords
 * 3. If keywords are missing, prepends a coherence hint derived from the voice text
 *    so the image model generates a scene matching what the voice describes
 *
 * Returns the original prompt unchanged if already coherent, or an enriched prompt.
 */
function alignImagePromptWithVoice(
  imagePrompt: string,
  voiceText: string
): string {
  const voiceLower = voiceText.toLowerCase()
  const imageLower = imagePrompt.toLowerCase()

  // Extract scene-relevant keywords from voice text.
  // These are concrete nouns, locations, activities, and objects that
  // define what the user will "see" in the photo vs "hear" in the voice.
  const scenePatterns: Array<{ pattern: RegExp; keyword: string }> = [
    // Locations
    { pattern: /\bkitchen\b/, keyword: 'kitchen' },
    { pattern: /\bbedroom\b/, keyword: 'bedroom' },
    { pattern: /\bliving room\b/, keyword: 'living room' },
    { pattern: /\bbathroom\b/, keyword: 'bathroom' },
    { pattern: /\bbalcony\b/, keyword: 'balcony' },
    { pattern: /\bcouch\b|\bsofa\b/, keyword: 'couch' },
    { pattern: /\bbed\b/, keyword: 'bed' },
    { pattern: /\bdesk\b/, keyword: 'desk' },
    { pattern: /\bcafe\b|\bcoffee\s*shop\b/, keyword: 'cafe' },
    { pattern: /\brestaurant\b/, keyword: 'restaurant' },
    { pattern: /\bpark\b/, keyword: 'park' },
    { pattern: /\bbeach\b/, keyword: 'beach' },
    { pattern: /\bgym\b/, keyword: 'gym' },
    { pattern: /\bstudio\b/, keyword: 'studio' },
    { pattern: /\boffice\b/, keyword: 'office' },
    { pattern: /\bcar\b|\bdriving\b/, keyword: 'car' },
    { pattern: /\btrain\b|\bsubway\b|\bmetro\b/, keyword: 'train' },
    { pattern: /\bpool\b|\bswimming\b/, keyword: 'pool' },
    { pattern: /\bgarden\b|\byard\b/, keyword: 'garden' },
    { pattern: /\brooftop\b/, keyword: 'rooftop' },
    { pattern: /\bmountain\b|\bhiking\b/, keyword: 'mountain' },
    // Activities
    { pattern: /\bcook(?:ing)?\b/, keyword: 'cooking' },
    { pattern: /\bcoffee\b/, keyword: 'coffee' },
    { pattern: /\btea\b(?!m)/, keyword: 'tea' },
    { pattern: /\breakfast\b/, keyword: 'breakfast' },
    { pattern: /\blunch\b/, keyword: 'lunch' },
    { pattern: /\bdinner\b/, keyword: 'dinner' },
    { pattern: /\breading\b|\bbook\b/, keyword: 'reading a book' },
    { pattern: /\bpainting\b|\bdrawing\b/, keyword: 'painting' },
    { pattern: /\bwork(?:ing)?\s*out\b|\bexercis(?:e|ing)\b/, keyword: 'working out' },
    { pattern: /\byoga\b/, keyword: 'yoga' },
    { pattern: /\bwalk(?:ing)?\b/, keyword: 'walking' },
    { pattern: /\brun(?:ning)?\b/, keyword: 'running' },
    { pattern: /\bshopping\b/, keyword: 'shopping' },
    { pattern: /\bgaming\b|\bplaying games?\b/, keyword: 'gaming' },
    // Time of day
    { pattern: /\bmorning\b|\bjust woke\b|\bwoke up\b/, keyword: 'morning' },
    { pattern: /\bnight\b|\bbedtime\b|\bsleepy\b/, keyword: 'nighttime' },
    { pattern: /\bsunset\b/, keyword: 'sunset' },
    { pattern: /\bsunrise\b|\bdawn\b/, keyword: 'sunrise' },
    // Objects / props
    { pattern: /\bmug\b|\bcup\b/, keyword: 'holding a mug' },
    { pattern: /\bheadphones\b|\bearbuds\b/, keyword: 'wearing headphones' },
    { pattern: /\bphone\b|\bscrolling\b/, keyword: 'holding phone' },
    { pattern: /\blaptop\b|\bcomputer\b/, keyword: 'laptop nearby' },
    { pattern: /\bblanket\b/, keyword: 'wrapped in blanket' },
    { pattern: /\bhoodie\b/, keyword: 'wearing hoodie' },
    { pattern: /\bpajamas?\b|\bpjs?\b/, keyword: 'wearing pajamas' },
  ]

  const missingKeywords: string[] = []
  for (const { pattern, keyword } of scenePatterns) {
    if (pattern.test(voiceLower) && !imageLower.includes(keyword)) {
      missingKeywords.push(keyword)
    }
  }

  // If no scene keywords are missing, the prompts are already coherent
  if (missingKeywords.length === 0) {
    return imagePrompt
  }

  // Cap at 5 keywords to avoid bloating the prompt
  const hints = missingKeywords.slice(0, 5)
  const coherencePrefix = `(scene context from voice: ${hints.join(', ')})`

  debugLog(
    `[Engine] Voice-image coherence: adding ${hints.length} missing keywords: ${hints.join(', ')}`
  )

  // Prepend coherence hint so the image model sees it early in the prompt
  return `${coherencePrefix}, ${imagePrompt}`
}
