import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const MAX_READ_CHARS = 200_000

// PDFs are binary: extract their text instead of returning raw bytes (which models cannot read and then guess about).
async function readPdfText(filePath: string): Promise<string> {
  const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> }
  const r = await mod.default(await fs.readFile(filePath))
  const raw = r.text ?? ''
  // Arabic PDFs with embedded/subset fonts often come out scrambled with NUL characters; never hand that to a model as if it were the document.
  const nuls = (raw.match(/\u0000/g) ?? []).length
  if (raw.length > 0 && nuls / raw.length > 0.02) {
    return `[PDF ${filePath}: text extraction is UNRELIABLE (scrambled characters, typical for Arabic PDFs). Do not guess or fill in the content. Tell the user and ask for a .md/.txt/.docx version of the document.]`
  }
  const text = raw.replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 20) {
    return `[PDF ${filePath}: ${r.numpages} page(s) but NO extractable text — it is probably a scan (images). OCR is not available. Do not guess the content; tell the user and ask for a text/Word version.]`
  }
  const cut = text.length > MAX_READ_CHARS
  return `[PDF text extracted: ${r.numpages} page(s)${cut ? ', truncated to ' + MAX_READ_CHARS + ' characters' : ''}]\n` + (cut ? text.slice(0, MAX_READ_CHARS) : text)
}

export async function readFile(filePath: string): Promise<string> {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.pdf') {
      try {
        return await readPdfText(filePath)
      } catch (e) {
        return `Error: could not extract text from the PDF ${filePath} (${errMessage(e)}). Do not guess its content.`
      }
    }
    if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
      return `Error: ${filePath} is an Office file, not plain text. Use the office_read tool for it.`
    }
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
