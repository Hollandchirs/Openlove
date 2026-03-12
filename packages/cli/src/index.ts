#!/usr/bin/env node
/**
 * Openlove CLI Entry Point
 *
 * Commands:
 *   openlove setup    — Interactive first-time setup
 *   openlove start    — Start your companion
 *   openlove create   — Create a new character
 *   openlove status   — Show current status
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

      const { startOpenlove } = await import('./start.js')
      await startOpenlove()
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

      console.log(chalk.magenta('\n  💝 Waking up Openlove...\n'))
      const { killExistingProcess, startOpenlove } = await import('./start.js')
      killExistingProcess()
      await startOpenlove()
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

      console.log(chalk.magenta('\n  💝 Openlove Status\n'))

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

    case '--help':
    case 'help':
    case '-h': {
      console.log(`
  ${chalk.magenta('💝 Openlove')} — Your AI companion

  ${chalk.bold('Usage:')}
    ${chalk.cyan('pnpm setup')}        First-time setup wizard
    ${chalk.cyan('pnpm start')}        Start your companion
    ${chalk.cyan('pnpm wakeup')}       Kill existing process + restart
    ${chalk.cyan('pnpm create-character')}   Create a new companion
    ${chalk.cyan('pnpm status')}       Show current status

  ${chalk.bold('Files:')}
    ${chalk.gray('.env')}              Your API keys and settings
    ${chalk.gray('characters/<name>/')} Your companion's blueprint files

  ${chalk.bold('Documentation:')}
    ${chalk.gray('https://github.com/Hollandchirs/Openlove')}
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
