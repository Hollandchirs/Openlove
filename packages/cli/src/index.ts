#!/usr/bin/env node
/**
 * Opencrush CLI Entry Point
 *
 * Commands:
 *   opencrush setup    — Interactive first-time setup
 *   opencrush start    — Start your companion
 *   opencrush create   — Create a new character
 *   opencrush status   — Show current status
 */

import 'dotenv/config'
import chalk from 'chalk'

const [, , command] = process.argv

async function main(): Promise<void> {
  switch (command) {
    case 'setup':
    case 'init': {
      const { runSetupWizard } = await import('./setup.js')
      await runSetupWizard()
      break
    }

    case 'start':
    case undefined: {
      // Default action if no command given — check if setup is done
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const rootDir = process.env.INIT_CWD ?? process.cwd()

      if (!existsSync(join(rootDir, '.env'))) {
        console.log(chalk.yellow('\n  No .env found. Running setup wizard...\n'))
        const { runSetupWizard } = await import('./setup.js')
        await runSetupWizard()
        return
      }

      const { startOpencrush } = await import('./start.js')
      await startOpencrush()
      break
    }

    case 'wakeup':
    case 'wake':
    case 'restart': {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const rootDir = process.env.INIT_CWD ?? process.cwd()

      if (!existsSync(join(rootDir, '.env'))) {
        console.log(chalk.yellow('\n  No .env found. Running setup first...\n'))
        const { runSetupWizard } = await import('./setup.js')
        await runSetupWizard()
      }

      console.log(chalk.magenta('\n  💝 Waking up Opencrush...\n'))
      const { killExistingProcess, startOpencrush } = await import('./start.js')
      killExistingProcess()
      await startOpencrush()
      break
    }

    case 'create':
    case 'create-character': {
      const { createCharacterFlow } = await import('./create.js')
      const result = await createCharacterFlow()
      console.log(chalk.green(`\n  ✅ Character "${result.folderName}" created!`))
      console.log(chalk.gray(`  Files: characters/${result.folderName}/\n`))
      break
    }

    case 'status': {
      const { existsSync, readdirSync } = await import('fs')
      const { join } = await import('path')

      console.log(chalk.magenta('\n  💝 Opencrush Status\n'))

      const hasEnv = existsSync(join(process.cwd(), '.env'))
      console.log(`  Config: ${hasEnv ? chalk.green('✓ .env found') : chalk.red('✗ No .env — run: pnpm setup')}`)

      const charactersDir = join(process.cwd(), 'characters')
      if (existsSync(charactersDir)) {
        const chars = readdirSync(charactersDir, { withFileTypes: true })
          .filter(d => d.isDirectory()).map(d => d.name)
        console.log(`  Characters: ${chars.map(c => chalk.cyan(c)).join(', ') || chalk.gray('none')}`)
      }

      const activeChar = process.env.CHARACTER_NAME
      if (activeChar) {
        console.log(`  Active: ${chalk.magenta(activeChar)}`)
      }
      console.log()
      break
    }

    case 'memory':
    case 'recall':
    case 'brain': {
      const { existsSync, readFileSync } = await import('fs')
      const { join } = await import('path')
      const Database = (await import('better-sqlite3')).default

      const charName = process.env.CHARACTER_NAME ?? 'helora'
      const rootDir = process.env.INIT_CWD ?? process.cwd()
      const charDir = join(rootDir, 'characters', charName)
      const dbPath = join(charDir, 'memory.db')

      if (!existsSync(dbPath)) {
        console.log(chalk.red(`\n  No memory found for "${charName}". Start a conversation first.\n`))
        break
      }

      const db = new Database(dbPath, { readonly: true })

      // Recent conversations
      console.log(chalk.magenta(`\n  🧠 ${charName}'s Memory\n`))
      console.log(chalk.bold('  ── 💬 Recent Conversations ──'))
      const msgs = db.prepare(
        'SELECT role, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT 10'
      ).all() as Array<{ role: string; content: string; timestamp: number }>

      for (const m of msgs.reverse()) {
        const time = new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        const who = m.role === 'user' ? chalk.cyan('You') : chalk.magenta(charName)
        const text = m.content.replace(/\n/g, ' ').slice(0, 80)
        console.log(`  ${chalk.gray(time)} ${who}: ${text}`)
      }

      // Relationship
      console.log(chalk.bold('\n  ── 💕 Relationship Status ──'))
      const rel = db.prepare("SELECT value FROM relationship WHERE key='state'").get() as { value: string } | undefined
      if (rel) {
        const r = JSON.parse(rel.value)

        const stageLabels: Record<string, string> = {
          stranger: 'Stranger 👋', acquaintance: 'Acquaintance 🤝', friend: 'Friend 😊',
          close_friend: 'Close Friend 💛', intimate: 'Intimate 💕',
        }
        const nextStage: Record<string, { name: string; threshold: number }> = {
          stranger: { name: 'Acquaintance', threshold: 0.15 },
          acquaintance: { name: 'Friend', threshold: 0.35 },
          friend: { name: 'Close Friend', threshold: 0.60 },
          close_friend: { name: 'Intimate', threshold: 0.85 },
        }

        console.log(`  Stage: ${chalk.yellow(stageLabels[r.stage] ?? r.stage)}`)

        // Progress bar to next stage
        const next = nextStage[r.stage]
        if (next) {
          const currentThresholds: Record<string, number> = {
            stranger: 0, acquaintance: 0.15, friend: 0.35, close_friend: 0.60, intimate: 0.85,
          }
          const cur = currentThresholds[r.stage] ?? 0
          const progress = (r.closeness - cur) / (next.threshold - cur)
          const barLen = 20
          const filled = Math.round(progress * barLen)
          const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
          console.log(`  Progress: [${chalk.green(bar)}] → ${next.name} (${(progress * 100).toFixed(0)}%)`)
        }

        console.log('')
        const fmtStat = (_label: string, val: number) => chalk.green((val * 100).toFixed(1) + '%')
        console.log(`  Closeness: ${fmtStat('', r.closeness)}  Trust: ${fmtStat('', r.trust)}  Familiarity: ${fmtStat('', r.familiarity)}`)
        console.log(`  Messages: ${r.totalMessages}  Days: ${r.totalDays}  Streak: ${r.currentStreak}d (Best: ${r.longestStreak}d)`)

        // Relationship history — show changes
        try {
          const hasHistory = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='relationship_history'"
          ).get()

          if (hasHistory) {
            // Today's changes
            const todayStart = new Date()
            todayStart.setHours(0, 0, 0, 0)
            const todayMs = todayStart.getTime()

            const todayStats = db.prepare(`
              SELECT
                SUM(closeness_delta) as c_total,
                SUM(trust_delta) as t_total,
                SUM(familiarity_delta) as f_total,
                COUNT(*) as interactions
              FROM relationship_history WHERE timestamp >= ?
            `).get(todayMs) as { c_total: number | null; t_total: number | null; f_total: number | null; interactions: number } | undefined

            if (todayStats && todayStats.interactions > 0) {
              console.log(chalk.bold('\n  ── 📈 Today\'s Changes ──'))
              const fmtDelta = (val: number | null) => {
                if (!val) return chalk.gray('+0.0%')
                const pct = (val * 100).toFixed(1)
                return val > 0 ? chalk.green(`+${pct}%`) : chalk.red(`${pct}%`)
              }
              console.log(`  Closeness ${fmtDelta(todayStats.c_total)}  Trust ${fmtDelta(todayStats.t_total)}  Familiarity ${fmtDelta(todayStats.f_total)}`)
              console.log(`  Interactions today: ${todayStats.interactions}`)
            }

            // Last 7 days daily summary
            const weekAgo = Date.now() - 7 * 86_400_000
            const dailyStats = db.prepare(`
              SELECT
                date(timestamp / 1000, 'unixepoch', 'localtime') as day,
                SUM(closeness_delta) as c_total,
                SUM(trust_delta) as t_total,
                SUM(familiarity_delta) as f_total,
                COUNT(*) as interactions
              FROM relationship_history
              WHERE timestamp >= ?
              GROUP BY day
              ORDER BY day DESC
            `).all(weekAgo) as Array<{ day: string; c_total: number; t_total: number; f_total: number; interactions: number }>

            if (dailyStats.length > 0) {
              console.log(chalk.bold('\n  ── 📊 7-Day Trend ──'))
              console.log(chalk.gray('  Date         Closeness  Trust      Familiar   Chats'))
              for (const d of dailyStats) {
                const fmtD = (val: number) => {
                  const pct = (val * 100).toFixed(1).padStart(5)
                  return val > 0 ? chalk.green(`+${pct}%`) : val < 0 ? chalk.red(`${pct}%`) : chalk.gray(` ${pct}%`)
                }
                console.log(`  ${chalk.gray(d.day)}  ${fmtD(d.c_total)}  ${fmtD(d.t_total)}  ${fmtD(d.f_total)}   ${String(d.interactions).padStart(3)}`)
              }
            }

            // Recent interactions with deltas
            const recentChanges = db.prepare(`
              SELECT timestamp, closeness_delta, trust_delta, familiarity_delta, trigger_text, stage
              FROM relationship_history
              ORDER BY timestamp DESC LIMIT 5
            `).all() as Array<{ timestamp: number; closeness_delta: number; trust_delta: number; familiarity_delta: number; trigger_text: string; stage: string }>

            if (recentChanges.length > 0) {
              console.log(chalk.bold('\n  ── 💬 Recent Interaction Impact ──'))
              for (const ch of recentChanges.reverse()) {
                const time = new Date(ch.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                const cStr = ch.closeness_delta > 0.003 ? chalk.green('♥') : chalk.gray('·')
                const tStr = ch.trust_delta > 0.003 ? chalk.blue('★') : chalk.gray('·')
                const fStr = ch.familiarity_delta > 0.003 ? chalk.yellow('◆') : chalk.gray('·')
                const text = (ch.trigger_text ?? '').slice(0, 50)
                console.log(`  ${chalk.gray(time)} ${cStr}${tStr}${fStr} "${text}"`)
              }
              console.log(chalk.gray('  Legend: ♥=Closeness↑ ★=Trust↑ ◆=Familiarity↑ ·=Minor'))
            }
          }
        } catch {
          // history table doesn't exist yet, skip
        }
      }

      // Episodes
      console.log(chalk.bold('\n  ── 📖 Recent Life ──'))
      const episodes = db.prepare(
        'SELECT type, title, timestamp FROM episodes ORDER BY timestamp DESC LIMIT 10'
      ).all() as Array<{ type: string; title: string; timestamp: number }>

      for (const e of episodes) {
        const time = new Date(e.timestamp).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        const icon = e.type === 'music' ? '🎵' : e.type === 'drama' ? '📺' : e.type === 'mood' ? '💭' : '📌'
        console.log(`  ${chalk.gray(time)} ${icon} ${e.title.slice(0, 70)}`)
      }

      // Semantic memory (vector)
      const vectorPath = join(charDir, 'vectors', 'index.json')
      if (existsSync(vectorPath)) {
        console.log(chalk.bold('\n  ── 🧠 Long-term Memory (Last 10) ──'))
        const vecData = JSON.parse(readFileSync(vectorPath, 'utf-8'))
        const items = vecData.items ?? []
        for (const item of items.slice(-10)) {
          const text = (item.metadata?.text ?? '').replace(/\n/g, ' ').slice(0, 90)
          console.log(`  ${chalk.gray('•')} ${text}`)
        }
        console.log(chalk.gray(`\n  Total: ${items.length} vector memories\n`))
      }

      db.close()
      break
    }

    case 'reset':
    case 'fresh-start': {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const Database = (await import('better-sqlite3')).default

      const charName = process.env.CHARACTER_NAME ?? 'helora'
      const rootDir = process.env.INIT_CWD ?? process.cwd()
      const dbPath = join(rootDir, 'characters', charName, 'memory.db')

      if (!existsSync(dbPath)) {
        console.log(chalk.red(`\n  No memory found for "${charName}".\n`))
        break
      }

      console.log(chalk.yellow(`\n  ⚠️  This will clear ALL conversation history for ${charName}.`))
      console.log(chalk.gray('  Relationship stats, episodes, and MEMORY.md will be preserved.\n'))

      const readline = await import('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>(resolve => rl.question(chalk.yellow('  Type "reset" to confirm: '), resolve))
      rl.close()

      if (answer.trim().toLowerCase() === 'reset') {
        const db = new Database(dbPath)
        const deleted = db.prepare('DELETE FROM messages').run()
        db.close()
        console.log(chalk.green(`\n  ✓ Cleared ${deleted.changes} messages. Fresh start!`))
        console.log(chalk.gray('  MEMORY.md and relationship stats are preserved.'))
        console.log(chalk.gray('  Run `opencrush wake` to restart.\n'))
      } else {
        console.log(chalk.gray('\n  Cancelled.\n'))
      }
      break
    }

    case '--help':
    case 'help':
    case '-h': {
      console.log(`
  ${chalk.magenta('💝 Opencrush')} — Your AI companion

  ${chalk.bold('Usage:')}
    ${chalk.cyan('pnpm setup')}        First-time setup wizard
    ${chalk.cyan('pnpm start')}        Start your companion
    ${chalk.cyan('pnpm wakeup')}       Kill existing process + restart
    ${chalk.cyan('pnpm create-character')}   Create a new companion
    ${chalk.cyan('pnpm status')}       Show current status
    ${chalk.cyan('opencrush memory')}  View AI's memory, relationship, and impressions

  ${chalk.bold('Files:')}
    ${chalk.gray('.env')}              Your API keys and settings
    ${chalk.gray('characters/<name>/')} Your companion's blueprint files

  ${chalk.bold('Documentation:')}
    ${chalk.gray('https://github.com/Hollandchirs/Opencrush')}
      `)
      break
    }

    default:
      console.log(chalk.red(`\n  Unknown command: ${command}`))
      console.log(chalk.gray('  Run "pnpm help" for usage\n'))
      process.exit(1)
  }
}

main().catch(err => {
  console.error(chalk.red('\n  Error:'), err.message)
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
})
