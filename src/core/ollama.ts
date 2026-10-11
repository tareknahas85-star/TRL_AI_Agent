import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:11434'
let owned: ChildProcess | null = null

async function up(): Promise<boolean> {
  try {
    const r = await fetch(BASE + '/api/tags', { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

function findOllama(): string | null {
  const local = process.env.LOCALAPPDATA
  const candidates = [
    local ? path.join(local, 'Programs', 'Ollama', 'ollama.exe') : '',
    'C:\\Program Files\\Ollama\\ollama.exe'
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  if (process.platform !== 'win32') {
    for (const c of ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/ollama/bin/ollama']) if (fs.existsSync(c)) return c
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, process.platform === 'win32' ? 'ollama.exe' : 'ollama')
    if (dir && fs.existsSync(p)) return p
  }
  return null
}

// Starts `ollama serve` in the background if it is not already running. Never throws.
export async function ensureOllama(): Promise<boolean> {
  try {
    if (await up()) return true
    const exe = findOllama()
    if (!exe) return false
    owned = spawn(exe, ['serve'], { detached: false, windowsHide: true, stdio: 'ignore' })
    owned.on('exit', () => {
      owned = null
    })
    owned.on('error', () => {
      owned = null
    })
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 750))
      if (await up()) return true
    }
    return false
  } catch {
    return false
  }
}

// Only stops an Ollama instance that this app started itself.
export function stopOwnedOllama(): void {
  try {
    owned?.kill()
  } catch {
    /* ignore */
  }
  owned = null
}
