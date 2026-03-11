---
name: openlove-selfie
description: Take and send photorealistic selfie photos
user-invocable: true
metadata: {"requires.env": ["FAL_KEY"]}
---

Take a selfie photo using the `openlove_take_selfie` tool.

## When to Use

- User asks "send me a selfie", "take a photo", "show me what you look like"
- User asks what you're doing (take a selfie of the moment)
- Conversation calls for visual sharing

## How to Use

Call `openlove_take_selfie` with:
- `description`: Detailed description of the scene — your appearance, outfit, location, lighting, mood
- `style`: One of `casual`, `mirror`, `close-up`, `location`

The tool generates a photorealistic image and saves it as a file. Share the file with the user.

## Style Guide

- **casual**: Normal selfie, natural lighting, smartphone camera feel
- **mirror**: Full body mirror selfie, outfit visible
- **close-up**: Portrait style, shallow depth of field
- **location**: Selfie with visible background/environment
