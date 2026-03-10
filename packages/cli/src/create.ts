/**
 * Character Creation — Three paths to match any user's comfort level
 *
 * Path A (30 seconds): Pick a preset → rename → done
 * Path B (2 minutes): Describe in one sentence → AI generates everything
 * Path C (advanced):  Manual editing of 4 markdown files
 *
 * Design principle: "light input, strong completion"
 * The user should feel like they made something real, with minimal effort.
 */

import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { join, extname } from 'path'
import { PRESETS, CharacterPreset } from './presets.js'

const ROOT_DIR = process.cwd()

export interface CreatedCharacter {
  folderName: string
  displayName: string
  gender: 'female' | 'male' | 'nonbinary'
  hasPhoto: boolean
}

/**
 * Main entry point — shows path selector and routes accordingly.
 */
export async function createCharacterFlow(
  llmApiKey?: string,
  llmProvider?: string
): Promise<CreatedCharacter> {
  console.log(chalk.magenta('\n  💝 Create your companion\n'))

  const { path } = await inquirer.prompt([{
    type: 'list',
    name: 'path',
    message: 'How do you want to create your companion?',
    choices: [
      {
        name: '⚡  Pick a preset — ready in 30 seconds',
        value: 'preset',
        short: 'Preset',
      },
      {
        name: '✍️   Describe them — AI builds the full character from your words',
        value: 'describe',
        short: 'Describe',
      },
      {
        name: '📁  Start blank — I\'ll edit the files myself',
        value: 'blank',
        short: 'Blank',
      },
    ],
  }])

  switch (path) {
    case 'preset':   return createFromPreset()
    case 'describe': return createFromDescription(llmApiKey, llmProvider)
    case 'blank':    return createBlank()
  }
  throw new Error('unreachable')
}

// ── Path A: Preset ─────────────────────────────────────────────────────────

async function createFromPreset(): Promise<CreatedCharacter> {
  // Show presets with emoji + vibe description
  const { presetId } = await inquirer.prompt([{
    type: 'list',
    name: 'presetId',
    message: 'Choose your companion:',
    choices: PRESETS.map(p => ({
      name: `${p.emoji}  ${p.label}\n     ${chalk.gray(p.description)}`,
      value: p.id,
      short: p.label.split('—')[0].trim(),
    })),
  }])

  const preset = PRESETS.find(p => p.id === presetId)!

  // Let them rename
  const { customName } = await inquirer.prompt([{
    type: 'input',
    name: 'customName',
    message: `Name your companion:`,
    default: preset.id.charAt(0).toUpperCase() + preset.id.slice(1),
  }])

  const displayName = customName.trim() || preset.id
  const folderName = displayName.toLowerCase().replace(/\s+/g, '-')

  const spinner = ora(`Creating ${displayName}...`).start()
  writeCharacterFiles(folderName, preset, displayName)
  spinner.succeed(chalk.green(`${displayName} created!`))

  // Photo prompt
  const hasPhoto = await promptForPhoto(folderName, displayName)

  printCreationSuccess(folderName, displayName, 'preset')
  return { folderName, displayName, gender: preset.gender, hasPhoto }
}

// ── Path B: AI Description ─────────────────────────────────────────────────

async function createFromDescription(
  apiKey?: string,
  provider?: string
): Promise<CreatedCharacter> {

  if (!apiKey) {
    console.log(chalk.yellow('\n  ℹ️  No API key found yet — using template generation instead.'))
    console.log(chalk.gray('  Add ANTHROPIC_API_KEY to .env for AI-powered generation.\n'))
    return createFromPromptTemplate()
  }

  console.log(chalk.gray('\n  Just describe who you want. The AI will build everything else.\n'))
  console.log(chalk.gray('  Examples:'))
  console.log(chalk.gray('  "A 25-year-old Japanese musician who loves jazz and is secretly shy"'))
  console.log(chalk.gray('  "An American grad student who\'s brilliant but forgets to eat"'))
  console.log(chalk.gray('  "A Korean idol trainee who never made it but became a barista instead"\n'))

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'What\'s their name?',
      validate: (v: string) => v.trim().length > 0 ? true : 'Name is required',
    },
    {
      type: 'list',
      name: 'gender',
      message: 'Gender:',
      choices: [
        { name: '👩 Female', value: 'female' },
        { name: '👨 Male', value: 'male' },
        { name: '🌈 Non-binary', value: 'nonbinary' },
      ],
    },
    {
      type: 'input',
      name: 'description',
      message: 'Describe them in 1-3 sentences:\n  → ',
      validate: (v: string) => v.trim().length > 10 ? true : 'Tell me a bit more',
    },
    {
      type: 'input',
      name: 'relationship',
      message: 'How would you describe your relationship with them? (optional)',
      default: 'Close friends who talk almost every day',
    },
  ])

  const spinner = ora('AI is building your companion...').start()

  try {
    const blueprint = await generateBlueprintWithAI(answers, apiKey, provider)
    const folderName = answers.name.toLowerCase().replace(/\s+/g, '-')

    writeCharacterFiles(folderName, {
      ...blueprint,
      id: folderName,
      emoji: '✨',
      label: answers.name,
      description: answers.description,
      gender: answers.gender as any,
    }, answers.name)

    spinner.succeed(chalk.green(`${answers.name} created!`))

    // Show a preview of the soul
    console.log('\n' + chalk.gray('  ── Soul preview ──────────────────────────'))
    const firstLines = blueprint.soul.split('\n').slice(0, 6).join('\n')
    console.log(chalk.white(firstLines.split('\n').map(l => '  ' + l).join('\n')))
    console.log(chalk.gray('  ──────────────────────────────────────────\n'))

    const { happy } = await inquirer.prompt([{
      type: 'confirm',
      name: 'happy',
      message: 'Does this feel right?',
      default: true,
    }])

    if (!happy) {
      // Regenerate with same inputs
      spinner.start('Regenerating with a different angle...')
      const blueprint2 = await generateBlueprintWithAI(answers, apiKey, provider)
      writeCharacterFiles(folderName, {
        ...blueprint2,
        id: folderName,
        emoji: '✨',
        label: answers.name,
        description: answers.description,
        gender: answers.gender as any,
      }, answers.name)
      spinner.succeed('Regenerated!')
      console.log(chalk.gray('\n  You can always fine-tune by editing the files in characters/' + folderName + '/\n'))
    }

    const hasPhoto = await promptForPhoto(folderName, answers.name)
    printCreationSuccess(folderName, answers.name, 'ai')
    return { folderName, displayName: answers.name, gender: answers.gender as any, hasPhoto }

  } catch (err: any) {
    spinner.fail('AI generation failed')
    console.log(chalk.yellow('  Falling back to template generation...'))
    console.log(chalk.gray('  Error: ' + err.message + '\n'))
    return createFromPromptTemplate(answers)
  }
}

// ── Path B fallback: Template (no API key) ─────────────────────────────────

async function createFromPromptTemplate(
  prefilled?: Record<string, string>
): Promise<CreatedCharacter> {
  const answers = prefilled ?? await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Name:',
      validate: (v: string) => v.trim().length > 0 ? true : 'Required',
    },
    {
      type: 'list',
      name: 'gender',
      message: 'Gender:',
      choices: [
        { name: '👩 Female', value: 'female' },
        { name: '👨 Male', value: 'male' },
        { name: '🌈 Non-binary', value: 'nonbinary' },
      ],
    },
    {
      type: 'input',
      name: 'description',
      message: 'Describe them briefly:',
    },
    {
      type: 'list',
      name: 'vibe',
      message: 'Overall vibe:',
      choices: [
        { name: '🌸 Warm & caring — nurturing, emotionally available', value: 'warm' },
        { name: '⚡ Sharp & witty — quick humor, confident opinions', value: 'witty' },
        { name: '🌙 Quiet & deep — thoughtful, slow to open up', value: 'quiet' },
        { name: '☀️ Bright & energetic — enthusiastic, lifts the mood', value: 'bright' },
        { name: '🔮 Mysterious & intense — complex, pulls you in', value: 'mysterious' },
      ],
    },
    {
      type: 'input',
      name: 'hobbies',
      message: 'What do they love? (comma-separated)',
      default: 'music, movies, late-night conversations',
    },
  ])

  const folderName = answers.name.toLowerCase().replace(/\s+/g, '-')
  const spinner = ora(`Creating ${answers.name}...`).start()

  const preset: CharacterPreset = buildTemplatePreset(answers)
  writeCharacterFiles(folderName, preset, answers.name)
  spinner.succeed(chalk.green(`${answers.name} created!`))

  const hasPhoto = await promptForPhoto(folderName, answers.name)
  printCreationSuccess(folderName, answers.name, 'template')
  return { folderName, displayName: answers.name, gender: answers.gender as any, hasPhoto }
}

// ── Path C: Blank ──────────────────────────────────────────────────────────

async function createBlank(): Promise<CreatedCharacter> {
  const { name, gender } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Character name:',
      validate: (v: string) => v.trim().length > 0 ? true : 'Required',
    },
    {
      type: 'list',
      name: 'gender',
      message: 'Gender:',
      choices: [
        { name: '👩 Female', value: 'female' },
        { name: '👨 Male', value: 'male' },
        { name: '🌈 Non-binary', value: 'nonbinary' },
      ],
    },
  ])

  const folderName = name.toLowerCase().replace(/\s+/g, '-')
  const dir = join(ROOT_DIR, 'characters', folderName)
  mkdirSync(dir, { recursive: true })

  // Copy blank templates
  const templatesDir = join(ROOT_DIR, 'templates')
  for (const file of ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md']) {
    const src = join(templatesDir, file)
    const dst = join(dir, file)
    if (existsSync(src)) {
      let content = require('fs').readFileSync(src, 'utf-8')
        .replace(/\{\{CHARACTER_NAME\}\}/g, name)
      writeFileSync(dst, content, 'utf-8')
    } else {
      writeFileSync(dst, `# ${file.replace('.md', '')}\n\nAdd content here.\n`, 'utf-8')
    }
  }

  console.log(chalk.cyan(`\n  ✓ Created characters/${folderName}/`))
  console.log(chalk.gray('  Edit the 4 markdown files to define your companion.'))
  console.log(chalk.gray('  Then run: pnpm start\n'))

  return { folderName, displayName: name, gender, hasPhoto: false }
}

// ── AI Generation ──────────────────────────────────────────────────────────

async function generateBlueprintWithAI(
  answers: Record<string, string>,
  apiKey: string,
  provider = 'anthropic'
): Promise<Pick<CharacterPreset, 'identity' | 'soul' | 'user' | 'memory'>> {

  const systemPrompt = `You are a creative writer specializing in creating rich, believable fictional characters for AI companions.
You will be given a brief description of a character and generate detailed personality files for them.
Write in a way that feels real and lived-in — specific details, genuine quirks, contradictions.
Avoid clichés. Make them feel like a person, not a character archetype.`

  const userPrompt = `Create a companion character with these details:
Name: ${answers.name}
Gender: ${answers.gender}
Description: ${answers.description}
Relationship with user: ${answers.relationship ?? 'Close friends'}

Generate exactly four sections, each starting with the exact header shown:

===IDENTITY===
(Markdown with frontmatter. Include: age, hometown/current city, job, languages, hobbies, and a brief appearance description.
Start with:
---
gender: ${answers.gender}
language: en
timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
---

# ${answers.name}
)

===SOUL===
(Their voice, vibe, what they love, what they dislike, emotional patterns, speech patterns.
Be specific — not "loves music" but what music, why it matters to them.
Real people have contradictions. Include some.)

===USER===
(How they met the user, their dynamic, what they call each other, 3-5 things they know about the user in generic placeholder form.)

===MEMORY===
(Their current obsessions, 2-3 personal notes-to-self, initial shared context with user.)

Be creative. Be specific. Make them feel real.`

  let responseText = ''

  if (provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    })
    const block = msg.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response')
    responseText = block.text
  } else {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const resp = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    responseText = resp.choices[0]?.message?.content ?? ''
  }

  return parseAIBlueprintResponse(responseText, answers.name, answers.gender)
}

function parseAIBlueprintResponse(
  text: string,
  name: string,
  gender: string
): Pick<CharacterPreset, 'identity' | 'soul' | 'user' | 'memory'> {
  const extract = (key: string): string => {
    const pattern = new RegExp(`===\\s*${key}\\s*===\\s*([\\s\\S]*?)(?===\\w|$)`, 'i')
    const match = text.match(pattern)
    return match?.[1]?.trim() ?? ''
  }

  return {
    identity: extract('IDENTITY') || fallbackIdentity(name, gender),
    soul: extract('SOUL') || fallbackSoul(),
    user: extract('USER') || fallbackUser(),
    memory: extract('MEMORY') || fallbackMemory(),
  }
}

// ── Photo Upload ───────────────────────────────────────────────────────────

async function promptForPhoto(folderName: string, displayName: string): Promise<boolean> {
  console.log()
  console.log(chalk.bold('  📸 Reference photo (for selfies)'))
  console.log(chalk.gray(`  ${displayName} can send photos of herself. For consistent appearance,`))
  console.log(chalk.gray('  drop a photo into the character folder named "reference.jpg"\n'))

  const { addPhoto } = await inquirer.prompt([{
    type: 'confirm',
    name: 'addPhoto',
    message: 'Do you have a photo to use as reference?',
    default: false,
  }])

  if (!addPhoto) {
    console.log(chalk.gray('  → You can add one later: characters/' + folderName + '/reference.jpg'))
    return false
  }

  const { photoPath } = await inquirer.prompt([{
    type: 'input',
    name: 'photoPath',
    message: 'Drag the photo file here (or paste its path):',
    filter: (v: string) => v.trim().replace(/^['"]|['"]$/g, ''), // strip quotes from drag-drop
    validate: (v: string) => {
      const cleaned = v.trim().replace(/^['"]|['"]$/g, '')
      if (!existsSync(cleaned)) return 'File not found. Try pasting the full path.'
      const ext = extname(cleaned).toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'Please use a JPG, PNG, or WebP image.'
      return true
    },
  }])

  const cleaned = photoPath.trim().replace(/^['"]|['"]$/g, '')
  const ext = extname(cleaned).toLowerCase()
  const destPath = join(ROOT_DIR, 'characters', folderName, `reference${ext}`)
  copyFileSync(cleaned, destPath)
  console.log(chalk.green(`  ✓ Photo saved as reference${ext}`))
  return true
}

// ── Helpers ────────────────────────────────────────────────────────────────

function writeCharacterFiles(
  folderName: string,
  preset: CharacterPreset,
  displayName: string
): void {
  const dir = join(ROOT_DIR, 'characters', folderName)
  mkdirSync(dir, { recursive: true })

  // Replace preset's original name with user's chosen name
  const replace = (text: string) =>
    text.replace(new RegExp(`# ${preset.id}\\b`, 'gi'), `# ${displayName}`)
        .replace(new RegExp(`\\b${preset.id}\\b`, 'gi'), displayName)

  writeFileSync(join(dir, 'IDENTITY.md'), replace(preset.identity), 'utf-8')
  writeFileSync(join(dir, 'SOUL.md'), preset.soul, 'utf-8')
  writeFileSync(join(dir, 'USER.md'), preset.user, 'utf-8')
  writeFileSync(join(dir, 'MEMORY.md'), preset.memory, 'utf-8')
}

function printCreationSuccess(folderName: string, name: string, path: string): void {
  console.log()
  console.log(chalk.green(`  ✅ ${name} is ready!`))
  console.log(chalk.gray(`  Character files: characters/${folderName}/`))
  if (path !== 'blank') {
    console.log(chalk.gray(`  Customize anytime: characters/${folderName}/SOUL.md`))
  }
  console.log()
}

function buildTemplatePreset(answers: Record<string, string>): CharacterPreset {
  const vibeMap: Record<string, string> = {
    warm: 'Nurturing, emotionally available, remembers everything you mention. Makes you feel seen.',
    witty: 'Quick humor, confident opinions, challenges ideas playfully. Keeps you on your toes.',
    quiet: 'Thoughtful and precise. Says less, means more. Opens up slowly but genuinely.',
    bright: 'Enthusiastic about everything, lifts the mood without trying, texts first.',
    mysterious: 'Complex and layered. You keep discovering new things. Pulls you in without trying.',
  }

  return {
    id: answers.name.toLowerCase().replace(/\s+/g, '-'),
    emoji: '✨',
    label: answers.name,
    description: answers.description,
    gender: answers.gender as any,
    identity: `---
gender: ${answers.gender}
language: en
timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
---

# ${answers.name}

${answers.description}

**Hobbies:** ${answers.hobbies}`,
    soul: `## Voice & Vibe

${vibeMap[answers.vibe] ?? 'Genuine and authentic.'}

## Loves

${answers.hobbies.split(',').map((h: string) => h.trim()).join('\n')}

## Emotional Patterns

- Excited → shares it with you immediately
- Processing something → gets quieter, comes back when ready
- Comfortable → reveals more than expected`,
    user: `## How We Met

You crossed paths and clicked immediately.

## Our Dynamic

${answers.relationship ?? 'Close friends who talk almost every day.'}`,
    memory: `## Current Obsessions

*(Updates as she lives her life)*

## Notes to Self

*(Things she\'s working through)*`,
  }
}

// Minimal fallbacks if AI parsing fails
const fallbackIdentity = (name: string, gender: string) => `---
gender: ${gender}
language: en
timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
---

# ${name}

*(Edit this file to define ${name}\'s background)*`

const fallbackSoul = () => `## Voice & Vibe

*(Edit this file to define personality, speech style, and emotional patterns)*`

const fallbackUser = () => `## Our Dynamic

*(Edit this file to define your relationship)*`

const fallbackMemory = () => `## Things She Knows About You

*(Add personal facts here)*`
