import crypto from 'crypto'
import { readJson, writeJson } from './json-store'

// User-defined agents: a name, a system prompt, and where each one runs (this PC, the cloud runner, or automatic).
export type RunOn = 'local' | 'cloud' | 'auto'
export type Agent = { id: string; name: string; prompt: string; runOn: RunOn }

const FILE = 'agents.json'
const MODES: RunOn[] = ['local', 'cloud', 'auto']

export function listAgents(): Agent[] {
  const a = readJson<Agent[]>(FILE, [])
  return Array.isArray(a) ? a.filter((x) => x && typeof x.name === 'string' && x.name.trim()) : []
}

function clean(a: Partial<Agent>): Agent | null {
  const name = String(a.name ?? '').trim().slice(0, 40)
  if (!name) return null
  const id = typeof a.id === 'string' && /^[0-9a-f]{8}$/.test(a.id) ? a.id : crypto.randomBytes(4).toString('hex')
  const runOn = MODES.includes(a.runOn as RunOn) ? (a.runOn as RunOn) : 'auto'
  return { id, name, prompt: String(a.prompt ?? '').slice(0, 3000), runOn }
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