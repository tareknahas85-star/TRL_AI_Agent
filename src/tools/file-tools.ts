import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function readFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (e) {
    return `Error reading ${filePath}: ${errMessage(e)}`
  }
}

export async function writeFile(filePath: string, content: string): Promise<string> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    return `Written to ${filePath}`
  } catch (e) {
    return `Error writing ${filePath}: ${errMessage(e)}`
  }
}

export async function listFiles(dirPath: string): Promise<string> {
  try {
    const files = await fs.readdir(dirPath)
    return files.join('\n')
  } catch (e) {
    return `Error listing ${dirPath}: ${errMessage(e)}`
  }
}

export async function runCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command)
    return stdout || stderr || 'Command executed'
  } catch (e) {
    return `Error running command: ${errMessage(e)}`
  }
}

export const AVAILABLE_TOOLS = [
  { name: 'readFile', description: 'Read file content' },
  { name: 'writeFile', description: 'Write content to file' },
  { name: 'listFiles', description: 'List files in directory' },
  { name: 'runCommand', description: 'Run terminal command' }
]
