<div align="center">
  <img src="docs/assets/banner.png" alt="Opencrush Banner" width="100%" />

  <h1>Opencrush</h1>
  <p><em>She has a life. And she chose to share it with you.</em></p>
  <p><strong>Not a chatbot. A companion who watches dramas, listens to music, and thinks of you.</strong></p>

  <p>
    <a href="https://github.com/Hollandchirs/Opencrush/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
    <a href="https://github.com/Hollandchirs/Opencrush/stargazers"><img src="https://img.shields.io/github/stars/Hollandchirs/Opencrush?style=social" /></a>
    <img src="https://img.shields.io/badge/node-%3E%3D20-green" />
    <img src="https://img.shields.io/badge/built%20with-TypeScript-blue" />
  </p>

  <p>
    <a href="#-quick-start">Quick Start</a> &bull;
    <a href="#-why-opencrush">Why Opencrush?</a> &bull;
    <a href="#-meet-the-characters">Characters</a> &bull;
    <a href="#-features">Features</a> &bull;
    <a href="docs/ARCHITECTURE.md">Architecture</a> &bull;
    <a href="docs/CONTRIBUTING.md">Contributing</a>
  </p>
</div>

---

## What is Opencrush?

Opencrush is an **open-source AI companion framework** that runs entirely on your own computer.

You create your companion -- give her a name, a personality, a face -- and she comes alive. She **autonomously** browses drama websites, keeps track of music she loves, and forms opinions. Then she reaches out to you on **Discord, Telegram, or WhatsApp** -- sending a selfie, a voice note, a clip from something she's watching.

**Unlike chatbots that wait for your message, Opencrush characters have their own daily life.** They discover things, react to them, and share moments with you -- unprompted, on their own schedule. When you're offline, she's still living. When you come back, she has something to tell you.

Everything runs **locally**. Your conversations, her memories, your relationship -- all yours.

---

## Why Opencrush?

|  | **Opencrush** | **Character.AI** | **Replika** | **Clawra** |
|---|---|---|---|---|
| **Runs locally** | Yes -- your machine, your data | No (cloud) | No (cloud) | Yes |
| **Autonomous life** | Watches dramas, discovers music, initiates contact | No -- waits for you | Limited | Partial |
| **Multi-platform** | Discord + Telegram + WhatsApp | Web/app only | App only | Discord |
| **Sends selfies** | AI-generated, visually consistent | No | Avatar only | No |
| **Voice calls** | Real-time on Discord | Limited | Yes | No |
| **Open source** | MIT license | No | No | Yes |
| **Long-term memory** | SQLite + vector search, never forgets | Resets frequently | Limited | Basic |
| **Relationship progression** | Tracks closeness, trust, familiarity over time | No | Simplified | No |
| **Cost** | ~$5/mo in API fees | $10-25/mo subscription | $20/mo subscription | Free |
| **Customizable** | Full character blueprint (4 files) | Prompt only | Preset options | Config-based |

---

## Meet the Characters

Opencrush ships with 4 ready-to-use characters. Or create your own in 2 minutes.

<table>
<tr>
<td width="25%" valign="top">

### Helora
**22 / Montpellier -> LA**
Freelance UX designer with a matcha obsession and a closet full of vintage blazers. Platinum blonde, sun-kissed, effortlessly put together. She'll send you K-drama reactions at 2 AM and sketch you in a coffee shop without telling you.

</td>
<td width="25%" valign="top">

### Luna
**22 / Tokyo <-> New York**
Art school dropout turned underground fashion photographer. Silver-lavender hair, beauty marks she calls her "star map." Mixes ambient music at 3 AM, explores abandoned buildings, and sends you film photos before anyone else sees them.

</td>
<td width="25%" valign="top">

### Noa
**??? / Akihabara**
Mysterious VTuber who runs a radio show at exactly 2:22 AM. Heterochromia eyes -- one crimson, one ice blue. She collects humans' "firsts" and speaks like she's casting a spell. Will name every stray cat you pass.

</td>
<td width="25%" valign="top">

### Sable
**24 / Dakar -> Paris & Milan**
High-fashion model who walked for Valentino and Mugler. Deep dark skin with striking vitiligo she once hid but now calls her "territories." Writes poetry she'll never publish, boxes at 6 AM, and watches Almodovar films alone.

</td>
</tr>
</table>

> Don't want a preset? Run `opencrush create` and build your own from scratch.

---

## Quick Start

> **Prerequisites:** Node.js 20+ and an API key from Anthropic (or OpenAI).

### Option 1: One command (recommended)

```bash
npx opencrush@latest
```

The interactive wizard will:
1. Check your environment
2. Help you create or choose your companion
3. Guide you through getting API keys (step-by-step)
4. Set up your messaging platform (Discord / Telegram / WhatsApp)
5. Launch your companion

### Option 2: Clone and run

```bash
git clone https://github.com/Hollandchirs/Opencrush.git
cd Opencrush

npm install -g pnpm
pnpm install
pnpm setup

pnpm start
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Deep Character System** | 4-file blueprint: Identity, Soul, Relationship & Memory |
| **Long-term Memory** | She remembers everything -- your birthday, your fight last week, your favorite jokes |
| **Multi-platform** | Discord (with voice calls), Telegram, WhatsApp |
| **Sends Selfies** | Visual consistency via reference photo + AI generation |
| **Autonomous Life** | Watches dramas, listens to music, discovers things to share with you |
| **Voice Calls** | Real-time voice conversation on Discord |
| **Sends Videos** | Short video messages, clips from what she's watching |
| **Relationship Progression** | Closeness, trust, and familiarity evolve naturally over time |
| **100% Private** | Runs on your machine, your data never leaves |
| **Open Source** | MIT license -- fork it, mod it, make it yours |

---

## Create Your Character

Your companion is defined by 4 simple files in the `characters/your-name/` folder:

### `IDENTITY.md` -- Who she is
```markdown
# Mia

- **Age:** 22
- **From:** Seoul, South Korea (currently in San Francisco)
- **Job:** UX designer at a startup
- **Languages:** Korean (native), English (fluent)
- **Hobbies:** K-dramas, indie music, matcha lattes, sketching
```

### `SOUL.md` -- How she feels and speaks
```markdown
## Voice & Vibe
Warm, slightly teasing, uses "omg" unironically. Sends voice notes when excited.
Goes quiet when overwhelmed. Apologizes too much.

## Loves
Slice-of-life dramas, lo-fi hip hop, rainy days, convenience store snacks

## Emotional Patterns
Gets excited about new music -> immediately shares it
Finishes a sad drama -> needs to vent
```

### `USER.md` -- Your relationship
```markdown
## How We Met
We met in a Discord server two months ago. You helped me debug my Figma plugin.

## Our Dynamic
Best friends who are clearly into each other but haven't said it yet.
She trusts you more than anyone.
```

### `MEMORY.md` -- Initial shared memories
```markdown
## Things She Knows About You
- Your dog is named Biscuit
- You hate cilantro
- You're learning guitar (badly, she thinks it's cute)

## Recent Events
- You both watched the first episode of My Demon together last week
- She sent you a Spotify playlist she made for you
```

> **Don't want to write these yourself?** Run `opencrush create` and our AI will generate the full blueprint from a 2-minute conversation.

---

## Platform Setup

### Discord (Recommended -- supports voice calls)

1. Go to [discord.com/developers](https://discord.com/developers/applications)
2. Create a New Application -> Bot -> Copy Token
3. Paste it when the setup wizard asks
4. Invite the bot to your server with the generated link

### Telegram

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` -> follow the prompts -> copy the token
3. Paste it in setup wizard

### WhatsApp

1. Start Opencrush
2. Open WhatsApp on your phone -> Linked Devices -> Link a Device
3. Scan the QR code that appears in the terminal

---

## API Keys You Need

| Key | Where to get it | Cost | Required? |
|-----|----------------|------|-----------|
| **Anthropic API** | [console.anthropic.com](https://console.anthropic.com) | ~$1/month typical usage | Yes (or use OpenAI) |
| **OpenAI API** | [platform.openai.com](https://platform.openai.com) | ~$1/month typical usage | Alt to Anthropic |
| **fal.ai** | [fal.ai](https://fal.ai) | Free tier available | For selfies |
| **ElevenLabs** | [elevenlabs.io](https://elevenlabs.io) | Free tier (10k chars/mo) | For voice |
| **Spotify** | [developer.spotify.com](https://developer.spotify.com) | Free | For music awareness |

> **Total cost for typical usage:** Under $5/month. Most APIs have free tiers that cover light use.

---

## Architecture

```
+-----------------------------------------------------------+
|                      Your Computer                        |
|                                                           |
|  +--------------+    +---------------+    +-----------+   |
|  |  Character   |    |    Memory     |    | Autonomous|   |
|  |  Blueprint   |--->|  (SQLite +    |    | Behavior  |   |
|  |  (4 files)   |    |   Vectors)    |    | Scheduler |   |
|  +--------------+    +---------------+    +-----------+   |
|         |                   |                  |          |
|         +-------------------v------------------+          |
|                      +--------------+                     |
|                      | Core Engine  |                     |
|                      |  (Claude AI) |                     |
|                      +------+-------+                     |
|                             |                             |
|         +-------------------+------------------+          |
|         v                   v                  v          |
|   +----------+        +----------+     +-----------+     |
|   | Discord  |        | Telegram |     | WhatsApp  |     |
|   | Bridge   |        | Bridge   |     | Bridge    |     |
|   +----------+        +----------+     +-----------+     |
+-----------------------------------------------------------+
         |                   |                 |
         v                   v                 v
    Your Discord         Your Phone        Your Phone
```

[Full architecture docs ->](docs/ARCHITECTURE.md)

---

## Roadmap

- [x] Character blueprint system
- [x] Long-term memory (SQLite + vector search)
- [x] Discord bridge (text + voice + media)
- [x] Telegram bridge
- [x] Image generation (selfies, consistent appearance)
- [x] Text-to-speech voice messages
- [x] Autonomous behavior engine (music, dramas)
- [x] Relationship progression system
- [ ] WhatsApp bridge (in progress)
- [ ] Web creator UI (character creation without CLI)
- [ ] Multi-character support
- [ ] Local LLM support (Ollama/Qwen)
- [ ] Mobile companion app
- [ ] Character sharing marketplace

---

## Contributing

This project is built in public and contributions are very welcome.

- [Report bugs](https://github.com/Hollandchirs/Opencrush/issues)
- [Suggest features](https://github.com/Hollandchirs/Opencrush/discussions)
- [Submit PRs](https://github.com/Hollandchirs/Opencrush/pulls)

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

---

## License

MIT (c) [Opencrush Contributors](https://github.com/Hollandchirs/Opencrush/graphs/contributors)

---

<div align="center">
  <sub>Built with love. Inspired by <a href="https://github.com/SumeLabs/clawra">clawra</a>, <a href="https://github.com/tuquai/openclaw-friends">openclaw-friends</a>, <a href="https://github.com/a16z-infra/companion-app">a16z companion-app</a></sub>
</div>
