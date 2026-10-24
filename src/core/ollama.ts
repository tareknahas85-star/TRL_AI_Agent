import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:11434'
export const OLLAMA_BASE = BASE
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


export type OllamaState = 'missing' | 'stopped' | 'running'

export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download'

// Models offered in the app. The user can also type any Ollama model name.
export const SUGGESTED_OLLAMA_MODELS = [
  'qwen3:1.7b',
  'qwen3:4b',
  'llama3.2:3b',
  'gemma3:4b',
  'phi4-mini'
]

export async function ollamaState(): Promise<OllamaState> {
  if (await up()) return 'running'
  return findOllama() ? 'stopped' : 'missing'
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    const r = await fetch(BASE + '/api/tags', { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: { name: string }[] }
    return (j.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

export async function listOllamaModelsDetailed(): Promise<{ name: string; size: number }[]> {
  try {
    const r = await fetch(BASE + '/api/tags', { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: { name: string; size?: number }[] }
    return (j.models ?? []).map((m) => ({ name: m.name, size: m.size ?? 0 }))
  } catch {
    return []
  }
}

export interface PullProgress {
  status: string
  total?: number
  completed?: number
  percent: number
}

// Downloads a model into the local Ollama store. Reports progress as it streams.
export async function pullModel(name: string, onProgress: (p: PullProgress) => void): Promise<void> {
  const r = await fetch(BASE + '/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true })
  })
  if (!r.ok || !r.body) throw new Error('Ollama رفض طلب التحميل (' + r.status + ')')
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      const ev = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
      if (ev.error) throw new Error(ev.error)
      const percent =
        ev.total && ev.completed !== undefined ? Math.min(100, Math.round((ev.completed / ev.total) * 100)) : 0
      onProgress({ status: ev.status ?? '', total: ev.total, completed: ev.completed, percent })
    }
  }
}

// Removes a model from this device (equivalent to `ollama rm`).
export async function deleteModel(name: string): Promise<void> {
  const r = await fetch(BASE + '/api/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name })
  })
  if (!r.ok) throw new Error('فشل حذف الموديل (' + r.status + ')')
}
