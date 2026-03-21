/**
 * Character Export / Import
 *
 * Export: Pack characters/<name>/ into <name>.opencrush.tar.gz
 * Import: Unpack .opencrush.tar.gz into characters/ (supports file path or URL)
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'

function getRootDir(): string {
  return process.env.INIT_CWD ?? process.cwd()
}

export async function exportCharacter(characterName: string): Promise<string> {
  const rootDir = getRootDir()
  const charDir = join(rootDir, 'characters', characterName)

  if (!existsSync(charDir)) {
    throw new Error(`Character "${characterName}" not found in characters/`)
  }

  const outputFile = `${characterName}.opencrush.tar.gz`
  const outputPath = join(rootDir, outputFile)

  // Create tar.gz from the character directory
  execSync(`tar -czf "${outputPath}" -C "${join(rootDir, 'characters')}" "${characterName}"`, {
    stdio: 'pipe',
  })

  console.log(chalk.green(`\n  Exported: ${outputFile}`))
  console.log(chalk.gray(`  Contains: characters/${characterName}/\n`))

  return outputPath
}

export async function importCharacter(source: string): Promise<string> {
  const rootDir = getRootDir()
  const charactersDir = join(rootDir, 'characters')
  mkdirSync(charactersDir, { recursive: true })

  let tarPath: string
  let isTemp = false

  if (source.startsWith('http://') || source.startsWith('https://')) {
    // Download from URL
    console.log(chalk.gray(`  Downloading from ${source}...`))
    tarPath = join(rootDir, `_import_temp_${Date.now()}.tar.gz`)
    isTemp = true

    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const { writeFileSync } = await import('fs')
    writeFileSync(tarPath, buffer)
  } else {
    tarPath = source
    if (!existsSync(tarPath)) {
      throw new Error(`File not found: ${tarPath}`)
    }
  }

  if (!tarPath.endsWith('.opencrush.tar.gz') && !tarPath.endsWith('.tar.gz')) {
    if (isTemp) unlinkSync(tarPath)
    throw new Error('File must be a .opencrush.tar.gz or .tar.gz archive')
  }

  // List contents to find the character name (top-level directory)
  const listing = execSync(`tar -tzf "${tarPath}"`, { encoding: 'utf-8' })
  const firstEntry = listing.split('\n')[0]
  const characterName = firstEntry.split('/')[0]

  if (!characterName) {
    if (isTemp) unlinkSync(tarPath)
    throw new Error('Could not determine character name from archive')
  }

  const destDir = join(charactersDir, characterName)
  if (existsSync(destDir)) {
    if (isTemp) unlinkSync(tarPath)
    throw new Error(
      `Character "${characterName}" already exists. Remove characters/${characterName}/ first.`
    )
  }

  // Extract into characters/
  execSync(`tar -xzf "${tarPath}" -C "${charactersDir}"`, { stdio: 'pipe' })

  // Clean up temp file
  if (isTemp) {
    unlinkSync(tarPath)
  }

  console.log(chalk.green(`\n  Imported: ${characterName}`))
  console.log(chalk.gray(`  Location: characters/${characterName}/\n`))

  return characterName
}
