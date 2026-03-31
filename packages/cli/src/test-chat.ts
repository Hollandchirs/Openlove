/**
 * Quick Test Chat
 *
 * After creating a character, lets the user send a few messages to verify
 * the character feels right before going through full platform setup.
 *
 * Runs entirely in the terminal — no Discord/Telegram needed.
 */

import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import { join } from 'path'
import { existsSync } from 'fs'
import { callLLMDirect } from './llm-direct.js'

import { ROOT_DIR } from './paths.js'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function runTestChat(
  characterName: string,
  apiKey?: string,
  provider?: string
): Promise<void> {
  // Skip if no API key (ollama users or those who skipped)
  if (!apiKey || provider === 'ollama') return

  const { wantTest } = await inquirer.prompt([{
    type: 'confirm',
    name: 'wantTest',
    message: `\n✨ Want to say hi to ${characterName} right now? (Quick 3-message test)`,
    default: true,
  }])

  if (!wantTest) return

  console.log(chalk.gray('\n  Loading character files...\n'))

  // Load the blueprint
  const systemPrompt = await buildTestSystemPrompt(characterName)
  if (!systemPrompt) {
    console.log(chalk.yellow('  (Could not load character files — skipping test)\n'))
    return
  }

  const history: Message[] = []

  console.log(chalk.cyan(`\n  ── Chat with ${characterName} ──`))
  console.log(chalk.gray('  Type your messages. Press Enter to send. Type "done" to continue setup.\n'))

  let turns = 0
  const MAX_TURNS = 5

  while (turns < MAX_TURNS) {
    const { userMessage } = await inquirer.prompt([{
      type: 'input',
      name: 'userMessage',
      message: chalk.white('You:'),
      validate: (v: string) => v.trim().length > 0 ? true : 'Say something!',
    }])

    if (userMessage.toLowerCase().trim() === 'done') break

    history.push({ role: 'user', content: userMessage.trim() })

    const spinner = ora('').start()
    spinner.text = ''

    try {
      const reply = await callLLM(systemPrompt, history, apiKey, provider ?? 'anthropic')
      spinner.stop()
      history.push({ role: 'assistant', content: reply })
      console.log(chalk.magenta(`\n  ${characterName}:`), chalk.white(reply), '\n')
    } catch (err: any) {
      spinner.fail('API error')
      console.log(chalk.red(`  Error: ${err.message}\n`))
      break
    }

    turns++
    if (turns >= MAX_TURNS) {
      console.log(chalk.gray('\n  (Test complete — continuing setup)\n'))
    }
  }

  const { feeling } = await inquirer.prompt([{
    type: 'list',
    name: 'feeling',
    message: 'How does the character feel?',
    choices: [
      { name: '✅ Perfect — let\'s continue setup', value: 'good' },
      { name: '✏️  I want to tweak her personality files and re-run later', value: 'tweak' },
    ],
  }])

  if (feeling === 'tweak') {
    console.log(chalk.yellow(`\n  Edit the files in: characters/${characterName}/`))
    console.log(chalk.yellow('  SOUL.md controls personality. IDENTITY.md controls backstory.'))
    console.log(chalk.gray('  Run `npx opencrush@latest setup` again when ready.\n'))
    process.exit(0)
  }

  console.log(chalk.green('\n  Great! Continuing...\n'))
}

async function buildTestSystemPrompt(characterName: string): Promise<string | null> {
  const dir = join(ROOT_DIR, 'characters', characterName)
  if (!existsSync(dir)) return null

  const parts: string[] = []

  for (const file of ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md']) {
    const filePath = join(dir, file)
    if (existsSync(filePath)) {
      const { readFileSync } = await import('fs')
      parts.push(readFileSync(filePath, 'utf-8'))
    }
  }

  if (parts.length === 0) return null

  return `You are ${characterName}. Stay completely in character — never break character or mention that you are an AI.

${parts.join('\n\n---\n\n')}

Keep your replies natural and conversational. 1-3 sentences unless the topic calls for more.`
}

async function callLLM(
  systemPrompt: string,
  history: Message[],
  apiKey: string,
  provider: string
): Promise<string> {
  return callLLMDirect(provider, apiKey, systemPrompt, history, 300)
}
