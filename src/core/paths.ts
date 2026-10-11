import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// Dev: read/write the project files directly. Packaged: bundled defaults live in
// process.resourcesPath (read-only) and are copied once to userData (writable).
function bundled(...p: string[]): string {
  return path.join(process.resourcesPath, ...p)
}

function copyDirIfMissing(from: string, to: string): void {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirIfMissing(src, dst)
    else if (!fs.existsSync(dst)) fs.copyFileSync(src, dst)
  }
}

export function getSkillsDir(): string {
  if (!app.isPackaged) return path.join(process.cwd(), 'src/skills/delegate-skills')
  const dir = path.join(app.getPath('userData'), 'skills')
  copyDirIfMissing(bundled('skills'), dir)
  return dir
}

export function getMCPConfigPath(): string {
  if (!app.isPackaged) return path.join(process.cwd(), 'src/mcp/config.json')
  const file = path.join(app.getPath('userData'), 'mcp-config.json')
  if (!fs.existsSync(file)) {
    const src = bundled('mcp', 'config.json')
    if (fs.existsSync(src)) fs.copyFileSync(src, file)
    else fs.writeFileSync(file, JSON.stringify({ servers: [] }, null, 2))
  }
  return file
}

export function getStatePath(): string {
  return path.join(app.getPath('userData'), 'state.json')
}
