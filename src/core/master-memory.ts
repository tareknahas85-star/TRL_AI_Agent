import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './json-store'
import { listProjects } from './workspace'

// Master memory: one overview of ALL the user's projects and recent topics, injected into every chat
// so the model stays consistent across projects and can flag conflicts between them.
export type ProjectMemory = {
  id: string
  name: string
  path: string
  summary: string
  tech: string[]
  ports: number[]
  decisions: string[]
  updatedAt: number
}
type Store = { projects: Record<string, ProjectMemory>; general: { text: string; at: number }[] }

const FILE = 'master-memory.json'
const MAX_DECISIONS = 15
const MAX_GENERAL = 25
const MAX_PROMPT = 4000

const load = (): Store => {
  const s = readJson<Partial<Store>>(FILE, {})
  return { projects: s.projects ?? {}, general: s.general ?? [] }
}
const save = (s: Store): void => writeJson(FILE, s)

const TECH = [
  'docker', 'kubernetes', 'terraform', 'react', 'node', 'python', 'typescript', 'electron', 'postgres', 'mysql', 'mongodb',
  'redis', 'nginx', 'ubuntu', 'linux', 'windows', 'gcp', 'aws', 'azure', 'powershell', 'bash', 'ollama', 'documenso', 'flutter', 'android'
]

function detectFromFolder(dir: string): { tech: string[]; summary: string } {
  const tech = new Set<string>()
  let summary = ''
  try {
    const has = (n: string): boolean => fs.existsSync(path.join(dir, n))
    if (has('package.json')) tech.add('node')
    if (has('Dockerfile') || has('docker-compose.yml')) tech.add('docker')
    if (has('requirements.txt') || has('pyproject.toml')) tech.add('python')
    if (fs.readdirSync(dir).some((f) => f.endsWith('.tf'))) tech.add('terraform')
    if (fs.readdirSync(dir).some((f) => f.endsWith('.sh'))) tech.add('bash')
    for (const r of ['README.md', 'readme.md', 'CLAUDE.md']) {
      const f = path.join(dir, r)
      if (fs.existsSync(f)) {
        const para = fs
          .readFileSync(f, 'utf-8')
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .find((p) => p && !p.startsWith('#') && p.length > 30)
        if (para) summary = para.replace(/\s+/g, ' ').slice(0, 220)
        break
      }
    }
  } catch {
    /* unreadable folder */
  }
  return { tech: [...tech], summary }
}

/** Makes sure every registered project has an entry (created automatically, edited later by chats or by the user). */
export function syncRegistry(): Store {
  const s = load()
  const { projects } = listProjects()
  let changed = false
  for (const p of projects) {
    const cur = s.projects[p.id]
    if (!cur) {
      const d = detectFromFolder(p.path)
      s.projects[p.id] = { id: p.id, name: p.name, path: p.path, summary: d.summary, tech: d.tech, ports: [], decisions: [], updatedAt: Date.now() }
      changed = true
    } else if (cur.name !== p.name || cur.path !== p.path) {
      cur.name = p.name
      cur.path = p.path
      changed = true
    }
  }
  for (const id of Object.keys(s.projects)) {
    if (!projects.some((p) => p.id === id)) {
      delete s.projects[id]
      changed = true
    }
  }
  if (changed) save(s)
  return s
}

export type Conflict = { kind: 'port'; detail: string }

export function findConflicts(s: Store = syncRegistry()): Conflict[] {
  const byPort = new Map<number, string[]>()
  for (const p of Object.values(s.projects)) for (const port of p.ports) byPort.set(port, [...(byPort.get(port) ?? []), p.name])
  const out: Conflict[] = []
  for (const [port, names] of byPort) if (names.length > 1) out.push({ kind: 'port', detail: `المنفذ ${port} مستخدم بأكتر من مشروع: ${names.join('، ')}` })
  return out
}

export function getMasterMemory(): { projects: ProjectMemory[]; general: Store['general']; conflicts: Conflict[] } {
  const s = syncRegistry()
  return { projects: Object.values(s.projects), general: s.general, conflicts: findConflicts(s) }
}

export function updateProjectMemory(id: string, patch: Partial<Pick<ProjectMemory, 'summary' | 'tech' | 'ports' | 'decisions'>>): boolean {
  const s = syncRegistry()
  const p = s.projects[id]
  if (!p) return false
  if (typeof patch.summary === 'string') p.summary = patch.summary.slice(0, 500)
  if (Array.isArray(patch.tech)) p.tech = patch.tech.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 20)
  if (Array.isArray(patch.ports)) p.ports = patch.ports.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536).slice(0, 20)
  if (Array.isArray(patch.decisions)) p.decisions = patch.decisions.map(String).map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, MAX_DECISIONS)
  p.updatedAt = Date.now()
  save(s)
  return true
}

export function clearGeneral(): void {
  const s = load()
  s.general = []
  save(s)
}

const PORT_RE = /(?:port|بورت|منفذ|localhost:|127\.0\.0\.1:)\s*[:=]?\s*(\d{2,5})\b/gi
const DECISION_RE = /(قررت|قرّرت|بدي استخدم|رح استخدم|راح استخدم|خلينا نستخدم|اعتمدنا|نستخدم|استخدمت|we will use|let's use|i decided|i'll use|decided to)/i

function extractPorts(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(PORT_RE)) {
    const n = Number(m[1])
    if (n >= 80 && n < 65536) out.add(n)
  }
  return [...out]
}

/** Warning lines for the current request, e.g. a port that another project already uses. */
function alertsFor(msg: string, projectId: string | null, s: Store): string[] {
  const out: string[] = []
  for (const port of extractPorts(msg)) {
    for (const p of Object.values(s.projects)) {
      if (p.id !== projectId && p.ports.includes(port)) out.push(`ALERT: the request mentions port ${port}, which project "${p.name}" already uses.`)
    }
  }
  return out
}

/** The block injected into every chat. Returns undefined when there is nothing to say. */
export function masterMemoryPrompt(currentProjectId: string | null, userMsg = ''): { text: string; projects: number } | undefined {
  const s = syncRegistry()
  const list = Object.values(s.projects)
  if (!list.length && !s.general.length) return undefined
  let out =
    'MASTER MEMORY — overview of ALL the user\'s projects and recent topics. Use it to stay consistent across projects. ' +
    'If the current request conflicts with another project (same port, incompatible tech or decision, overlapping resource), say so briefly and suggest an alternative. ' +
    'Otherwise do not mention other projects and never recite this block.\n'
  for (const p of list.sort((a, b) => Number(b.id === currentProjectId) - Number(a.id === currentProjectId))) {
    const line =
      `\n* ${p.id === currentProjectId ? '[CURRENT] ' : ''}${p.name}` +
      (p.summary ? ` — ${p.summary}` : '') +
      (p.tech.length ? ` | tech: ${p.tech.join(', ')}` : '') +
      (p.ports.length ? ` | ports: ${p.ports.join(', ')}` : '') +
      (p.decisions.length ? ` | decisions: ${p.decisions.slice(-6).join('; ')}` : '')
    if (out.length + line.length > MAX_PROMPT) break
    out += line
  }
  if (s.general.length) out += '\n\nRECENT TOPICS OUTSIDE PROJECTS: ' + s.general.slice(-8).map((g) => g.text).join(' | ')
  const conflicts = findConflicts(s).map((c) => 'CONFLICT: ' + c.detail)
  const alerts = alertsFor(userMsg, currentProjectId, s)
  if (conflicts.length || alerts.length) out += '\n\n' + [...conflicts, ...alerts].join('\n')
  return { text: out.slice(0, MAX_PROMPT + 600), projects: list.length }
}

// ---- Learning from chats (runs in the background after each answered turn) ----
const LOCAL_BASE = 'http://127.0.0.1:11434'
let summarizing = false

async function refreshSummary(id: string, userMsg: string, reply: string): Promise<void> {
  if (summarizing) return // the local master is small; skip instead of queueing
  summarizing = true
  try {
    const s = load()
    const p = s.projects[id]
    if (!p) return
    const prompt =
      '/no_think\nUpdate the short project summary (max 2 sentences, Arabic, factual, no fluff). Base it ONLY on what the USER stated or decided; never add things the assistant merely suggested or claimed to have done. Keep the existing summary facts unless the user changed them. ' +
      'Return ONLY JSON: {"summary":"..."}.\n' +
      `Project: ${p.name}\nCurrent summary: ${p.summary || '(none)'}\nUser said: ${userMsg.slice(0, 600)}\nAssistant answered: ${reply.slice(0, 600)}`
    const r = await fetch(LOCAL_BASE + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3:1.7b', prompt, stream: false, format: 'json', think: false, options: { num_predict: 160, temperature: 0.2 }, keep_alive: '5m' }),
      signal: AbortSignal.timeout(60000)
    })
    const j = (await r.json()) as { response?: string }
    const m = (j.response ?? '').match(/\{.*\}/s)
    const sum = m ? (JSON.parse(m[0]) as { summary?: unknown }).summary : undefined
    if (typeof sum === 'string' && sum.trim().length > 10) {
      const fresh = load()
      if (fresh.projects[id]) {
        fresh.projects[id].summary = sum.trim().slice(0, 400)
        fresh.projects[id].updatedAt = Date.now()
        save(fresh)
      }
    }
  } catch {
    /* local master unavailable: keep the old summary */
  } finally {
    summarizing = false
  }
}

/** Records what a turn taught us. Deterministic extraction first (ports, decisions, tech), then a background summary refresh. */
export function recordTurn(projectId: string | null, userMsg: string, reply: string): void {
  try {
    const s = syncRegistry()
    if (projectId && s.projects[projectId]) {
      const p = s.projects[projectId]
      for (const port of extractPorts(userMsg)) if (!p.ports.includes(port)) p.ports.push(port)
      for (const sent of userMsg.split(/[.\n!?؟]+/)) {
        const t = sent.trim()
        if (t.length > 12 && DECISION_RE.test(t) && !p.decisions.includes(t.slice(0, 200))) p.decisions.push(t.slice(0, 200))
      }
      p.decisions = p.decisions.slice(-MAX_DECISIONS)
      const low = userMsg.toLowerCase()
      for (const t of TECH) if (low.includes(t) && !p.tech.includes(t)) p.tech.push(t)
      p.tech = p.tech.slice(0, 20)
      p.updatedAt = Date.now()
      save(s)
      void refreshSummary(projectId, userMsg, reply)
    } else if (userMsg.trim().length > 25) {
      s.general.push({ text: userMsg.trim().replace(/\s+/g, ' ').slice(0, 120), at: Date.now() })
      s.general = s.general.slice(-MAX_GENERAL)
      save(s)
    }
  } catch (e) {
    console.warn('[MasterMemory] record failed', e)
  }
}
