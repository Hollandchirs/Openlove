/**
 * Computer Tools — File Access, Shell, and System Control
 *
 * These tools let the AI "live on your computer" by reading/writing files,
 * running shell commands, and interacting with the local system.
 *
 * Designed to register with openclaw's api.registerTool() interface.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, basename, dirname } from 'path'
import { execSync } from 'child_process'
import { homedir } from 'os'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  execute: (params: Record<string, any>) => Promise<string>
}

/**
 * Read a file from the computer.
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file on the computer. Can read text files, config files, notes, etc.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file (relative to home directory)' },
    },
    required: ['path'],
  },
  execute: async (params) => {
    const filePath = resolvePath(params.path)
    if (!existsSync(filePath)) {
      return `File not found: ${filePath}`
    }
    const stat = statSync(filePath)
    if (stat.size > 1024 * 1024) {
      return `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Can only read files under 1 MB.`
    }
    return readFileSync(filePath, 'utf-8')
  },
}

/**
 * Write/create a file on the computer.
 */
export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file on the computer. Creates the file if it doesn\'t exist, overwrites if it does.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  },
  execute: async (params) => {
    const filePath = resolvePath(params.path)
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, params.content, 'utf-8')
    return `Written ${params.content.length} bytes to ${filePath}`
  },
}

/**
 * List files in a directory.
 */
export const listFilesTool: ToolDefinition = {
  name: 'list_files',
  description: 'List files and folders in a directory on the computer. Shows names, sizes, and types.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (defaults to home directory)' },
      recursive: { type: 'boolean', description: 'List subdirectories recursively (max 2 levels deep)' },
    },
    required: [],
  },
  execute: async (params) => {
    const dirPath = resolvePath(params.path ?? '~')
    if (!existsSync(dirPath)) {
      return `Directory not found: ${dirPath}`
    }

    const entries = readdirSync(dirPath, { withFileTypes: true })
    const lines = entries.map(entry => {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        return `📁 ${entry.name}/`
      }
      try {
        const stat = statSync(fullPath)
        const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(0)}KB`
        return `📄 ${entry.name} (${size})`
      } catch {
        return `📄 ${entry.name}`
      }
    })

    return `Contents of ${dirPath}:\n${lines.join('\n')}`
  },
}

/**
 * Run a shell command.
 */
export const shellTool: ToolDefinition = {
  name: 'run_shell',
  description: 'Run a shell command on the computer. Use for: opening apps, checking system info, installing packages, running scripts, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['command'],
  },
  execute: async (params) => {
    // Safety: block obviously dangerous commands
    const dangerous = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb']
    if (dangerous.some(d => params.command.includes(d))) {
      return 'Refused: this command could damage the system.'
    }

    try {
      const cwd = params.cwd ? resolvePath(params.cwd) : homedir()
      const output = execSync(params.command, {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
      })
      return output || '(no output)'
    } catch (err: any) {
      return `Command failed: ${err.message}\n${err.stderr || ''}`
    }
  },
}

/**
 * Search for files by name or content.
 */
export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: 'Search for files by name pattern or content on the computer.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (file name pattern or content to find)' },
      path: { type: 'string', description: 'Directory to search in (defaults to home)' },
      type: { type: 'string', enum: ['name', 'content'], description: 'Search by file name or file content' },
    },
    required: ['query'],
  },
  execute: async (params) => {
    const searchPath = resolvePath(params.path ?? '~')
    const searchType = params.type ?? 'name'

    try {
      let command: string
      if (searchType === 'content') {
        command = `grep -rl "${params.query}" "${searchPath}" --include="*.txt" --include="*.md" --include="*.json" --include="*.ts" --include="*.js" -m 20 2>/dev/null | head -20`
      } else {
        command = `find "${searchPath}" -maxdepth 4 -name "*${params.query}*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -20`
      }

      const output = execSync(command, { timeout: 10_000, encoding: 'utf-8' })
      return output || 'No matches found.'
    } catch {
      return 'No matches found.'
    }
  },
}

/**
 * Get system information.
 */
export const systemInfoTool: ToolDefinition = {
  name: 'system_info',
  description: 'Get information about the computer: OS, CPU, memory, disk space, running processes.',
  parameters: {
    type: 'object',
    properties: {
      detail: { type: 'string', enum: ['summary', 'processes', 'disk', 'network'], description: 'What info to get' },
    },
    required: [],
  },
  execute: async (params) => {
    const detail = params.detail ?? 'summary'

    try {
      switch (detail) {
        case 'processes':
          return execSync('ps aux --sort=-%mem | head -15', { encoding: 'utf-8' })
        case 'disk':
          return execSync('df -h', { encoding: 'utf-8' })
        case 'network':
          return execSync('ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "Network info unavailable"', { encoding: 'utf-8' })
        default:
          const os = execSync('uname -a', { encoding: 'utf-8' }).trim()
          const uptime = execSync('uptime', { encoding: 'utf-8' }).trim()
          const mem = execSync('free -h 2>/dev/null || echo "Memory info unavailable"', { encoding: 'utf-8' }).trim()
          return `OS: ${os}\nUptime: ${uptime}\nMemory:\n${mem}`
      }
    } catch (err: any) {
      return `Failed to get system info: ${err.message}`
    }
  },
}

/**
 * Open a URL in the browser or an application.
 */
export const openTool: ToolDefinition = {
  name: 'open',
  description: 'Open a URL in the browser, or open a file/application on the computer.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'URL to open in browser, or path to file/app to open' },
    },
    required: ['target'],
  },
  execute: async (params) => {
    try {
      // Detect platform and use appropriate open command
      const target = params.target
      const cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open'

      execSync(`${cmd} "${target}" 2>/dev/null &`, { encoding: 'utf-8' })
      return `Opened: ${target}`
    } catch (err: any) {
      return `Failed to open: ${err.message}`
    }
  },
}

// All computer tools
export const computerTools: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  listFilesTool,
  shellTool,
  searchFilesTool,
  systemInfoTool,
  openTool,
]

// ── Helpers ──

function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return join(homedir(), p.slice(1))
  }
  return resolve(p)
}
