/**
 * Character Card Generator
 *
 * Generates a 1200x630 PNG card for a character with:
 *   - Left: character portrait (circular crop)
 *   - Right: name, age+location, personality tags, one-line description
 *   - Bottom: Opencrush branding + GitHub URL
 *   - Background: dark gradient based on character vibe
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import chalk from 'chalk'

const WIDTH = 1200
const HEIGHT = 630
const PORTRAIT_SIZE = 280
const PORTRAIT_X = 80
const PORTRAIT_Y = 100

interface CharacterCardData {
  name: string
  age: string
  location: string
  tags: string[]
  description: string
  gender: string
}

function parseIdentity(identityPath: string): CharacterCardData {
  const raw = readFileSync(identityPath, 'utf-8')
  const { content } = matter(raw)

  const nameMatch = content.match(/^#\s+(.+)$/m)
  const name = nameMatch?.[1]?.trim() ?? 'Unknown'

  const ageMatch = content.match(/\*\*Age:\*\*\s*(\d+)/i)
  const age = ageMatch?.[1] ?? '??'

  const fromMatch = content.match(/\*\*From:\*\*\s*(.+)/i)
  const location = fromMatch?.[1]?.trim() ?? 'Unknown'

  const hobbiesMatch = content.match(/\*\*Hobbies:\*\*\s*(.+)/i)
  const hobbiesRaw = hobbiesMatch?.[1] ?? ''
  const tags = hobbiesRaw
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 5)

  // Use the first sentence of Background or Appearance as description
  const bgMatch = content.match(/## (?:Background|Appearance)\s*\n+(.+)/i)
  const description = bgMatch?.[1]?.trim().split('.')[0]?.trim() ?? name

  const { data: meta } = matter(raw)
  const gender = (meta.gender as string) ?? 'female'

  return { name, age, location, tags, description, gender }
}

/** Pick gradient colors based on character name/vibe */
function pickGradient(name: string): { from: string; to: string } {
  const gradients: Array<{ from: string; to: string }> = [
    { from: '#1a1a2e', to: '#16213e' },  // deep navy
    { from: '#2d1b3d', to: '#1a1a2e' },  // purple-dark
    { from: '#1b2d2d', to: '#0f1f1f' },  // teal-dark
    { from: '#2d1b1b', to: '#1a1a1a' },  // warm dark
    { from: '#1b2d1b', to: '#0f1f0f' },  // forest dark
    { from: '#2d2d1b', to: '#1f1f0f' },  // amber dark
  ]
  // Deterministic pick based on name
  const hash = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return gradients[hash % gradients.length]
}

function createSvgOverlay(data: CharacterCardData, gradient: { from: string; to: string }): string {
  const textX = PORTRAIT_X + PORTRAIT_SIZE + 60
  const tagY = 280

  const tagsSvg = data.tags
    .map((tag, i) => {
      const x = textX + i * 0  // stacked vertically or inline
      const inlineX = textX
      const inlineY = tagY + i * 36
      return `
        <rect x="${inlineX - 4}" y="${inlineY - 18}" width="${tag.length * 10 + 24}" height="28" rx="14" fill="rgba(255,255,255,0.12)" />
        <text x="${inlineX + 8}" y="${inlineY}" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="#e0e0e0">${escapeXml(tag)}</text>
      `
    })
    .join('\n')

  // Render tags inline (horizontal flow)
  let inlineTags = ''
  let offsetX = textX
  const tagRowY = tagY
  for (const tag of data.tags) {
    const w = tag.length * 8.5 + 24
    inlineTags += `
      <rect x="${offsetX - 2}" y="${tagRowY - 16}" width="${w}" height="26" rx="13" fill="rgba(255,255,255,0.10)" />
      <text x="${offsetX + 10}" y="${tagRowY}" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#c0c0c0">${escapeXml(tag)}</text>
    `
    offsetX += w + 8
    if (offsetX > WIDTH - 40) break  // prevent overflow
  }

  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${gradient.from}" />
      <stop offset="100%" stop-color="${gradient.to}" />
    </linearGradient>
    <clipPath id="circle">
      <circle cx="${PORTRAIT_X + PORTRAIT_SIZE / 2}" cy="${PORTRAIT_Y + PORTRAIT_SIZE / 2}" r="${PORTRAIT_SIZE / 2}" />
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />

  <!-- Subtle border around portrait area -->
  <circle cx="${PORTRAIT_X + PORTRAIT_SIZE / 2}" cy="${PORTRAIT_Y + PORTRAIT_SIZE / 2}" r="${PORTRAIT_SIZE / 2 + 3}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" />

  <!-- Character Name -->
  <text x="${textX}" y="170" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="bold" fill="white">${escapeXml(data.name)}</text>

  <!-- Age + Location -->
  <text x="${textX}" y="215" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#a0a0a0">${escapeXml(data.age)} · ${escapeXml(truncate(data.location, 60))}</text>

  <!-- Personality Tags (inline) -->
  ${inlineTags}

  <!-- One-line description -->
  <text x="${textX}" y="${tagRowY + 50}" font-family="system-ui, -apple-system, sans-serif" font-size="15" fill="#b0b0b0" font-style="italic">${escapeXml(truncate(data.description, 70))}</text>

  <!-- Bottom bar -->
  <rect x="0" y="${HEIGHT - 50}" width="${WIDTH}" height="50" fill="rgba(0,0,0,0.3)" />
  <text x="40" y="${HEIGHT - 20}" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="bold" fill="#ff69b4">Opencrush</text>
  <text x="${WIDTH - 40}" y="${HEIGHT - 20}" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#888" text-anchor="end">github.com/Hollandchirs/Opencrush</text>
</svg>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

export async function generateCard(characterName: string): Promise<string> {
  const sharp = (await import('sharp')).default
  const rootDir = process.env.INIT_CWD ?? process.cwd()
  const charDir = join(rootDir, 'characters', characterName)

  if (!existsSync(charDir)) {
    throw new Error(`Character "${characterName}" not found in characters/`)
  }

  const identityPath = join(charDir, 'IDENTITY.md')
  if (!existsSync(identityPath)) {
    throw new Error(`Missing IDENTITY.md for character "${characterName}"`)
  }

  const data = parseIdentity(identityPath)
  const gradient = pickGradient(data.name)

  // Find reference image
  const imageExts = ['.jpeg', '.jpg', '.png', '.webp']
  let refImagePath: string | undefined
  for (const ext of imageExts) {
    const p = join(charDir, `reference${ext}`)
    if (existsSync(p)) {
      refImagePath = p
      break
    }
  }

  // Create SVG overlay
  const svgOverlay = createSvgOverlay(data, gradient)
  const svgBuffer = Buffer.from(svgOverlay)

  // Render the base card from SVG
  let card = sharp(svgBuffer, { density: 150 }).resize(WIDTH, HEIGHT)

  if (refImagePath) {
    // Prepare circular portrait from reference image
    const circleMask = Buffer.from(
      `<svg width="${PORTRAIT_SIZE}" height="${PORTRAIT_SIZE}">
        <circle cx="${PORTRAIT_SIZE / 2}" cy="${PORTRAIT_SIZE / 2}" r="${PORTRAIT_SIZE / 2}" fill="white" />
      </svg>`
    )

    const portrait = await sharp(refImagePath)
      .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: 'cover', position: 'top' })
      .composite([{ input: circleMask, blend: 'dest-in' }])
      .png()
      .toBuffer()

    // Composite portrait onto the card
    card = sharp(await card.png().toBuffer()).composite([
      {
        input: portrait,
        top: PORTRAIT_Y,
        left: PORTRAIT_X,
      },
    ])
  }

  const outputPath = join(charDir, 'card.png')
  await card.png().toFile(outputPath)

  console.log(chalk.green(`\n  Card generated: characters/${characterName}/card.png`))
  console.log(chalk.gray(`  ${WIDTH}x${HEIGHT} PNG\n`))

  return outputPath
}
