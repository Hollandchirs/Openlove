/**
 * Character Card Generator — 16:9 Cinematic Style
 *
 * Left: Character portrait with right-edge fade into blurred bg
 * Right: Text info overlaid on darkened + blurred version of same image
 * Output: 3840x2160 PNG (2x retina of 1920x1080)
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import chalk from 'chalk'

const SCALE = 2
const W = 1920 * SCALE
const H = 1080 * SCALE

interface CardData {
  name: string
  age: string
  location: string
  job: string
  tags: string[]
  vibe: string
}

function parseIdentity(identityPath: string): CardData {
  const raw = readFileSync(identityPath, 'utf-8')
  const { content } = matter(raw)

  const nameMatch = content.match(/^#\s+(.+)$/m)
  const name = nameMatch?.[1]?.trim() ?? 'Unknown'

  const ageMatch = content.match(/\*\*Age:\*\*\s*(\d+)/i)
  const age = ageMatch?.[1] ?? ''

  const fromMatch = content.match(/\*\*From:\*\*\s*(.+)/i)
  const locationRaw = fromMatch?.[1]?.trim() ?? ''
  const location = locationRaw.replace(/\s*\(.*\)/, '').split(' — ')[0].split(' - ')[0].trim()
  const cleanLocation = location.length > 40 || location.toLowerCase().startsWith('says ') ? '' : location

  const jobMatch = content.match(/\*\*Job:\*\*\s*(.+)/i)
  const jobRaw = jobMatch?.[1]?.trim() ?? ''
  const job = jobRaw.split(/[—–\.\+]/).map(s => s.trim()).filter(Boolean)[0] ?? ''

  const hobbiesMatch = content.match(/\*\*Hobbies:\*\*\s*(.+)/i)
  const hobbiesRaw = hobbiesMatch?.[1] ?? ''
  const tags = splitRespectingParens(hobbiesRaw)
    .map(t => t.trim()).filter(Boolean)
    .map(t => t.length > 35 ? t.split(/[,(]/)[0].trim() : t)
    .filter(t => t.length > 1)
    .slice(0, 6)

  let vibe = ''
  const soulPath = identityPath.replace('IDENTITY.md', 'SOUL.md')
  if (existsSync(soulPath)) {
    const soul = readFileSync(soulPath, 'utf-8')
    const line = soul.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('-'))
    if (line) vibe = line.trim().split('.')[0]?.trim() ?? ''
  }

  return { name, age, location: cleanLocation, job, tags, vibe }
}

function splitRespectingParens(str: string): string[] {
  const result: string[] = []; let depth = 0, current = ''
  for (const ch of str) {
    if (ch === '(') depth++; else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { result.push(current); current = '' } else current += ch
  }
  if (current) result.push(current); return result
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Build text overlay SVG — sits on top of the blurred right half */
function buildTextOverlay(data: CardData, overlayW: number): string {
  const S = SCALE
  const px = 50 * S  // tight left padding, closer to portrait
  const availW = overlayW - px - 40 * S

  const meta = [data.age, data.location].filter(Boolean).join(' · ')
  const lines = 1 + (meta ? 1 : 0) + (data.job ? 1 : 0) + (data.tags.length > 0 ? 2 : 0) + (data.vibe ? 1 : 0)
  const blockH = lines * 44 * S
  let y = Math.max(70 * S, Math.round((H - blockH) / 2))

  const nameY = y; y += 84 * S
  const metaY = y; if (meta) y += 48 * S
  const jobY = y; if (data.job) y += 44 * S

  y += 20 * S
  const tagStartY = y

  let inlineTags = ''
  let offsetX = px
  let rowY = tagStartY
  const rowH = 38 * S
  let currentRow = 1
  const maxRows = 2
  const charW = 9.5 * S
  const padW = 24 * S

  for (const tag of data.tags) {
    const maxChars = Math.floor((availW - padW) / charW)
    const label = tag.length > maxChars ? tag.slice(0, maxChars - 1) + '…' : tag
    const w = Math.ceil(label.length * charW + padW)

    if (offsetX + w > px + availW) {
      if (currentRow >= maxRows) break
      currentRow++
      offsetX = px
      rowY += rowH
    }

    inlineTags += `
      <rect x="${offsetX}" y="${rowY - 20 * S}" width="${w}" height="${36 * S}" rx="${18 * S}" fill="rgba(255,255,255,0.10)" />
      <text x="${offsetX + 12 * S}" y="${rowY + 4 * S}" font-family="system-ui, -apple-system, sans-serif" font-size="${19 * S}" fill="rgba(255,255,255,0.8)">${esc(label)}</text>
    `
    offsetX += w + 10 * S
  }

  const vibeY = tagStartY + (currentRow * rowH) + 32 * S

  const jobMax = Math.floor(availW / (9 * S))
  const vibeMax = Math.floor(availW / (8.5 * S))
  const jobText = data.job.length > jobMax ? data.job.slice(0, jobMax - 1) + '…' : data.job
  const vibeText = data.vibe.length > vibeMax ? data.vibe.slice(0, vibeMax - 1) + '…' : data.vibe

  return `<svg width="${overlayW}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Semi-transparent dark overlay for readability -->
  <rect width="${overlayW}" height="${H}" fill="rgba(0,0,0,0.55)" />

  <!-- Name -->
  <text x="${px}" y="${nameY}" font-family="system-ui, -apple-system, sans-serif" font-size="${72 * S}" font-weight="bold" fill="white">${esc(data.name)}</text>

  <!-- Meta -->
  ${meta ? `<text x="${px}" y="${metaY}" font-family="system-ui, -apple-system, sans-serif" font-size="${26 * S}" fill="rgba(255,255,255,0.65)">${esc(meta)}</text>` : ''}

  <!-- Job -->
  ${data.job ? `<text x="${px}" y="${jobY}" font-family="system-ui, -apple-system, sans-serif" font-size="${22 * S}" fill="rgba(255,255,255,0.45)">${esc(jobText)}</text>` : ''}

  <!-- Tags -->
  ${inlineTags}

  <!-- Vibe -->
  ${data.vibe ? `<text x="${px}" y="${vibeY}" font-family="system-ui, -apple-system, sans-serif" font-size="${22 * S}" fill="rgba(255,255,255,0.50)" font-style="italic">${esc(vibeText)}</text>` : ''}

  <!-- Branding -->
  <text x="${px}" y="${H - 44 * S}" font-family="system-ui, -apple-system, sans-serif" font-size="${20 * S}" font-weight="bold" fill="#ff69b4">Opencrush</text>
  <text x="${overlayW - 60 * S}" y="${H - 44 * S}" font-family="system-ui, -apple-system, sans-serif" font-size="${14 * S}" fill="rgba(255,255,255,0.4)" text-anchor="end">github.com/heloraai/Opencrush</text>
</svg>`
}

export async function generateCard(characterName: string): Promise<string> {
  const sharp = (await import('sharp')).default
  const { ROOT_DIR } = await import('./paths.js')
  const charDir = join(ROOT_DIR, 'characters', characterName)

  if (!existsSync(charDir)) throw new Error(`Character "${characterName}" not found in characters/`)
  const identityPath = join(charDir, 'IDENTITY.md')
  if (!existsSync(identityPath)) throw new Error(`Missing IDENTITY.md for character "${characterName}"`)

  const data = parseIdentity(identityPath)

  const imageExts = ['.jpeg', '.jpg', '.png', '.webp']
  let refImagePath: string | undefined
  for (const ext of imageExts) {
    const p = join(charDir, `reference${ext}`)
    if (existsSync(p)) { refImagePath = p; break }
  }

  if (!refImagePath) return generateFallbackCard(charDir, characterName, data)

  // Portrait: slightly narrower to reduce muddy overlap with text panel
  const portraitW = Math.round(H * 4 / 5 * 0.9)
  const overlayW = W - portraitW + Math.round(20 * SCALE)  // minimal overlap into portrait fade zone

  // Layer 1: Full-width blurred + darkened background
  const bgBlur = await sharp(refImagePath)
    .resize(W, H, { fit: 'cover', position: 'center' })
    .blur(50)
    .modulate({ brightness: 0.30, saturation: 0.5 })
    .png()
    .toBuffer()

  // Layer 2: Sharp portrait with right-edge fade
  const portrait = await sharp(refImagePath)
    .resize(portraitW, H, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer()

  const fadeMask = Buffer.from(
    `<svg width="${portraitW}" height="${H}">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="white" />
          <stop offset="55%" stop-color="white" />
          <stop offset="100%" stop-color="black" />
        </linearGradient>
      </defs>
      <rect width="${portraitW}" height="${H}" fill="url(#fade)" />
    </svg>`
  )

  const maskedPortrait = await sharp(portrait)
    .composite([{ input: fadeMask, blend: 'dest-in' }])
    .png()
    .toBuffer()

  // Layer 3: Text overlay (semi-transparent dark on top of blurred bg)
  const textSvg = buildTextOverlay(data, overlayW)
  const textOverlay = await sharp(Buffer.from(textSvg))
    .resize(overlayW, H)
    .png()
    .toBuffer()

  // Composite: blurred bg → sharp portrait on left → text overlay on right
  const card = sharp(bgBlur).composite([
    { input: maskedPortrait, left: 0, top: 0 },
    { input: textOverlay, left: W - overlayW, top: 0 },
  ])

  const outputPath = join(charDir, 'card.png')
  await card.png({ quality: 95 }).toFile(outputPath)

  console.log(chalk.green(`\n  Card generated: characters/${characterName}/card.png`))
  console.log(chalk.gray(`  ${W}x${H} PNG (16:9)\n`))
  return outputPath
}

async function generateFallbackCard(charDir: string, characterName: string, data: CardData): Promise<string> {
  const sharp = (await import('sharp')).default
  const S = SCALE
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e" /><stop offset="100%" stop-color="#0f0f1a" />
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#bg)" />
    <text x="${W/2}" y="${H/2 - 20*S}" font-family="system-ui" font-size="${60*S}" font-weight="bold" fill="white" text-anchor="middle">${esc(data.name)}</text>
    <text x="${W/2}" y="${H/2 + 50*S}" font-family="system-ui" font-size="${20*S}" fill="#999" text-anchor="middle">${esc([data.age, data.location, data.job].filter(Boolean).join(' · '))}</text>
    <text x="${40*S}" y="${H - 30*S}" font-family="system-ui" font-size="${18*S}" font-weight="bold" fill="#ff69b4">Opencrush</text>
  </svg>`
  const outputPath = join(charDir, 'card.png')
  await sharp(Buffer.from(svg)).resize(W, H).png().toFile(outputPath)
  console.log(chalk.green(`\n  Card generated: characters/${characterName}/card.png`))
  console.log(chalk.gray(`  ${W}x${H} PNG (no reference image)\n`))
  return outputPath
}
