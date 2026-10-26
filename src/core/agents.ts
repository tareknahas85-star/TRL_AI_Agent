import crypto from 'crypto'
import { readJson, writeJson } from './json-store'
import { isValidTimeZone, systemTz } from './schedule-time'

// User-defined agents: a name, a system prompt, and where each one runs (this PC, the cloud runner, or automatic).
export type RunOn = 'local' | 'cloud' | 'auto'
// memory: what the cloud runner may know about the user. 'basic' = the filtered basic-facts pack (see agent-memory.ts), 'none' = nothing.
export type AgentMemory = 'basic' | 'none'
export type Agent = { id: string; name: string; prompt: string; runOn: RunOn; memory: AgentMemory; model: string; tool: AgentTool; schedule: AgentSchedule | null; sources: string[] }

// tool: 'text' = normal chat agent, 'image' = generates a picture, 'video' = generates a video (cloud runner, Gemini API, billing-enabled key). model = optional model id override.
export type AgentTool = 'text' | 'image' | 'video'
export const cleanTool = (t: unknown): AgentTool => (t === 'image' || t === 'video' ? t : 'text')
// Cloud schedule: the gate's cron fires the agent with 	ask at 	ime (HH:MM in 	z); days 'work' = Sun-Thu.
export type AgentSchedule = { time: string; days: 'all' | 'work'; task: string; tz: string }
export function cleanSchedule(s: unknown): AgentSchedule | null {
  const x = (s ?? {}) as Partial<AgentSchedule>
  const time = String(x.time ?? '')
  const task = String(x.task ?? '').trim().slice(0, 2000)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !task) return null
  const tz = typeof x.tz === 'string' && isValidTimeZone(x.tz) ? x.tz : systemTz()
  return { time, days: x.days === 'work' ? 'work' : 'all', task, tz }
}
// Mailbox labels (MAIL_SRC of each Apps Script) this agent may read; empty = all.
export const cleanSources = (l: unknown): string[] =>
  (Array.isArray(l) ? l : String(l ?? '').split(/[,\s]+/))
    .map((s) => String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20))
    .filter(Boolean)
    .slice(0, 5)
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/
const FILE = 'agents.json'
const MODES: RunOn[] = ['local', 'cloud', 'auto']

export function listAgents(): Agent[] {
  const a = readJson<Agent[]>(FILE, [])
  return Array.isArray(a)
    ? a.filter((x) => x && typeof x.name === 'string' && x.name.trim()).map((x) => ({
        ...x,
        memory: x.memory === 'none' ? ('none' as const) : ('basic' as const),
        model: typeof x.model === 'string' && MODEL_RE.test(x.model) ? x.model : '',
        tool: cleanTool(x.tool),
        schedule: cleanSchedule(x.schedule),
        sources: cleanSources(x.sources)
      }))
    : []
}

function clean(a: Partial<Agent>): Agent | null {
  const name = String(a.name ?? '').trim().slice(0, 40)
  if (!name) return null
  const id = typeof a.id === 'string' && /^[0-9a-f]{8}$/.test(a.id) ? a.id : crypto.randomBytes(4).toString('hex')
  const runOn = MODES.includes(a.runOn as RunOn) ? (a.runOn as RunOn) : 'auto'
  const memory: AgentMemory = a.memory === 'none' ? 'none' : 'basic'
  const model = typeof a.model === 'string' && MODEL_RE.test(a.model.trim()) ? a.model.trim() : ''
  const tool: AgentTool = cleanTool(a.tool)
  return { id, name, prompt: String(a.prompt ?? '').slice(0, 3000), runOn, memory, model, tool, schedule: cleanSchedule(a.schedule), sources: cleanSources(a.sources) }
}

export function saveAgent(p: Partial<Agent>): Agent[] {
  const n = clean(p)
  if (!n) throw new Error('الاسم مطلوب')
  const list = listAgents()
  if (list.some((x) => x.id !== n.id && x.name.toLowerCase() === n.name.toLowerCase())) throw new Error('في وكيل بنفس الاسم')
  const i = list.findIndex((x) => x.id === n.id)
  if (i >= 0) list[i] = n
  else list.push(n)
  writeJson(FILE, list.slice(0, 50))
  return listAgents()
}

export function deleteAgent(id: string): Agent[] {
  writeJson(FILE, listAgents().filter((x) => x.id !== id))
  return listAgents()
}

/** Longest agent name that prefixes the text (case-insensitive) and is followed by whitespace or the end. */
export function matchAgent(arg: string): { agent: Agent; task: string } | null {
  const low = arg.trim().toLowerCase()
  const found = [...listAgents()]
    .sort((a, b) => b.name.length - a.name.length)
    .find((a) => {
      const n = a.name.toLowerCase()
      return low.startsWith(n) && (low.length === n.length || /\s/.test(low[n.length]))
    })
  return found ? { agent: found, task: arg.trim().slice(found.name.length).trim() } : null
}