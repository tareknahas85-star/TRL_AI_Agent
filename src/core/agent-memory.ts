import { readJson, writeJson } from './json-store'
import { listMemory, type MemoryEntry } from './memory'

// What a CLOUD agent may know about the user. The cloud runner has no access to this PC, so the app sends it a small
// read-only "basic facts" pack. Work/project facts never leave the PC: lines that mention a blocked word (the user's own
// list + the names of the user's projects) or that look like a secret are dropped before anything is uploaded.

const FILE = 'agent-memory.json'
const MAX_CHARS = 4000
const MAX_TERMS = 200

export const getBlocked = (): string[] => {
  const c = readJson<{ blocked?: unknown }>(FILE, {})
  return Array.isArray(c.blocked) ? cleanTerms(c.blocked as unknown[]) : []
}

export function cleanTerms(list: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of list) {
    const t = String(x ?? '').trim().slice(0, 60)
    const k = t.toLowerCase()
    if (t.length < 2 || seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= MAX_TERMS) break
  }
  return out
}

export function setBlocked(list: unknown[]): string[] {
  const b = cleanTerms(list)
  writeJson(FILE, { blocked: b })
  return b
}

/** Names of the user's own projects: always blocked, so project names never reach the cloud. */
export function projectNames(): string[] {
  const p = readJson<{ projects?: { name?: unknown }[] }>('projects.json', {})
  return cleanTerms((p.projects ?? []).map((x) => x?.name))
}

const SECRET_RE =
  /AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_|xox[bp]-|Bearer\s+[A-Za-z0-9._-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|\b[0-9a-f]{32,}\b|(password|passwd|كلمة\s*(السر|المرور)|api[_ -]?key|secret|token)\s*[:=]/i

export const looksSecret = (line: string): boolean => SECRET_RE.test(line)

const hits = (s: string, terms: string[]): boolean => {
  const low = s.toLowerCase()
  return terms.some((t) => low.includes(t.toLowerCase()))
}

/** Keep only the lines that mention no blocked word and do not look like a secret. */
export function filterLines(text: string, blocked: string[]): { text: string; dropped: number } {
  let dropped = 0
  const keep: string[] = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) {
      keep.push(line)
      continue
    }
    // Memory entries are often one long paragraph, so filter per sentence, not per line.
    const ok = line.split(/(?<=[.!?؟;؛])\s+/).filter((s) => {
      const bad = looksSecret(s) || hits(s, blocked)
      if (bad) dropped++
      return !bad
    })
    if (ok.length) keep.push(ok.join(' '))
  }
  return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped }
}

export type MemoryPack = { text: string; used: number; dropped: number }

/** Pure: build the pack from entries (enabled ones only). An entry whose title is blocked is skipped entirely. */
export function buildPack(entries: MemoryEntry[], blocked: string[]): MemoryPack {
  let out = ''
  let used = 0
  let dropped = 0
  for (const e of entries) {
    if (!e.enabled) continue
    if (looksSecret(e.title) || hits(e.title, blocked)) {
      dropped++
      continue
    }
    const f = filterLines(e.content, blocked)
    dropped += f.dropped
    if (!f.text) continue
    const block = `\n## ${e.title}\n${f.text}\n`
    if (out.length + block.length > MAX_CHARS) break
    out += block
    used++
  }
  const text = out ? 'BACKGROUND FACTS ABOUT THE USER (read-only; use only when relevant, never mention this block):\n' + out : ''
  return { text, used, dropped }
}

export const cloudMemoryPack = (): MemoryPack => buildPack(listMemory(), [...getBlocked(), ...projectNames()])