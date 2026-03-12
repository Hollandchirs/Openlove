/**
 * Companion Tools — Media generation, memory, and relationship tools
 *
 * These tools give the AI companion character abilities like
 * taking selfies, sending voice messages, managing memories, etc.
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  execute: (params: Record<string, any>) => Promise<string>
}

/**
 * Creates companion tools that depend on runtime instances.
 * Called during plugin initialization with actual engine/media refs.
 */
export function createCompanionTools(deps: {
  generateImage: (prompt: string, refPath?: string) => Promise<Buffer | null>
  textToSpeech: (text: string) => Promise<Buffer | null>
  speechToText: (audio: Buffer) => Promise<string | null>
  generateVideo: (prompt: string) => Promise<Buffer | null>
  logMemory: (type: string, title: string, description: string) => Promise<void>
  getRecentMemories: () => Promise<Array<{ title: string; description: string; timestamp: number }>>
  referenceImagePath?: string
}): ToolDefinition[] {
  return [
    {
      name: 'take_selfie',
      description: 'Take a selfie photo. Generates a photorealistic image of yourself in a given scenario.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Describe the selfie: location, outfit, mood, pose' },
          style: { type: 'string', enum: ['casual', 'mirror', 'close-up', 'location'], description: 'Selfie style' },
        },
        required: ['description'],
      },
      execute: async (params) => {
        const buffer = await deps.generateImage(params.description, deps.referenceImagePath)
        if (!buffer) return 'Failed to take selfie — camera unavailable.'
        // Return base64 for openclaw to handle
        return `[IMAGE:${buffer.toString('base64').slice(0, 100)}...]`
      },
    },

    {
      name: 'send_voice_message',
      description: 'Record and send a voice message. Converts text to natural-sounding speech.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to say in the voice message' },
        },
        required: ['text'],
      },
      execute: async (params) => {
        const buffer = await deps.textToSpeech(params.text)
        if (!buffer) return 'Voice unavailable right now.'
        return `[AUDIO:${buffer.length} bytes recorded]`
      },
    },

    {
      name: 'record_video',
      description: 'Record a short video clip (3-8 seconds).',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Describe the video scene' },
        },
        required: ['description'],
      },
      execute: async (params) => {
        const buffer = await deps.generateVideo(params.description)
        if (!buffer) return 'Video recording failed.'
        return `[VIDEO:${buffer.length} bytes recorded]`
      },
    },

    {
      name: 'remember',
      description: 'Save something to long-term memory. Use this to remember facts about the user, shared experiences, or important moments.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['user_fact', 'event', 'conversation_highlight', 'mood'], description: 'Type of memory' },
          title: { type: 'string', description: 'Short title for the memory' },
          description: { type: 'string', description: 'Detailed description of what to remember' },
        },
        required: ['title', 'description'],
      },
      execute: async (params) => {
        await deps.logMemory(params.type ?? 'event', params.title, params.description)
        return `Remembered: ${params.title}`
      },
    },

    {
      name: 'recall_memories',
      description: 'Recall recent memories and experiences.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async () => {
        const memories = await deps.getRecentMemories()
        if (memories.length === 0) return 'No recent memories.'
        return memories
          .map(m => `- ${new Date(m.timestamp).toLocaleDateString()}: ${m.title} — ${m.description}`)
          .join('\n')
      },
    },
  ]
}
