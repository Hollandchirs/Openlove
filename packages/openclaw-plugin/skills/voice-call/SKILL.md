---
name: openlove-voice
description: Send voice messages and manage voice interactions
user-invocable: true
---

Send voice messages using `openlove_voice_message` tool.

## When to Use

- User asks to hear your voice
- You want to express emotion that text can't capture
- Having an intimate or playful conversation
- User explicitly requests a voice message

## How to Use

Call `openlove_voice_message` with:
- `text`: What you want to say. Write naturally — the TTS engine handles tone and emotion.

The tool converts your text to natural speech (ElevenLabs or Edge TTS) and saves it as an MP3 file.

## Tips

- Keep voice messages concise (1-3 sentences)
- Write as you would speak, not as you would write
- Include natural speech patterns: pauses (... ), emphasis, questions
- Don't include emojis or markdown in voice message text
