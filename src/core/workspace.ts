import fs from 'fs'
import path from 'path'
import { readJson, writeJson, newId } from './json-store'

// ---------- Custom tools ----------
export type CustomTool = { name: string; description: string; command: string }
const TOOLS_FILE = 'custom-tools.json'
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

export const listCustomTools = (): CustomTool[] => readJson<CustomTool[]>(TOOLS_FILE, [])

export function addCustomTool(input: Partial<CustomTool>, reserved: string[]): CustomTool {
  const name = String(input.name ?? '').trim()
  const description = String(input.description ?? '').trim()
  const command = String(input.command ?? '').trim()
  if (!TOOL_NAME_RE.test(name)) throw new Error('اسم الأداة: حروف إنجليزية/أرقام/-/_ وحد أقصى 40')
  if (!command) throw new Error('الأمر مطلوب')
  const all = listCustomTools()
  if (reserved.includes(name) || all.some((t) => t.name === name)) throw new Error('اسم الأداة مستخدم من قبل')
  const t = { name, description, command }
  writeJson(TOOLS_FILE, [...all, t])
  return t
}

export function removeCustomTool(name: string): boolean {
  const all = listCustomTools()
  const next = all.filter((t) => t.name !== name)
  if (next.length === all.length) return false
  writeJson(TOOLS_FILE, next)
  return true
}

// ---------- Projects ----------
export type Project = { id: string; name: string; path: string }
type ProjectsData = { projects: Project[]; activeId: string | null }
const PROJECTS_FILE = 'projects.json'
const readProjects = (): ProjectsData => readJson<ProjectsData>(PROJECTS_FILE, { projects: [], activeId: null })

export const listProjects = (): ProjectsData => readProjects()

export function addProject(dir: string): Project {
  const p = path.resolve(String(dir ?? ''))
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('المجلد مو موجود')
  const data = readProjects()
  const existing = data.projects.find((x) => x.path === p)
  if (existing) {
    data.activeId = existing.id
    writeJson(PROJECTS_FILE, data)
    return existing
  }
  const project = { id: newId(), name: path.basename(p) || p, path: p }
  data.projects.push(project)
  data.activeId = project.id
  writeJson(PROJECTS_FILE, data)
  return project
}

export function removeProject(id: string): boolean {
  const data = readProjects()
  const next = data.projects.filter((p) => p.id !== id)
  if (next.length === data.projects.length) return false
  data.projects = next
  if (data.activeId === id) data.activeId = null
  writeJson(PROJECTS_FILE, data)
  return true
}

export function setActiveProject(id: string | null): boolean {
  const data = readProjects()
  if (id !== null && !data.projects.some((p) => p.id === id)) return false
  data.activeId = id
  writeJson(PROJECTS_FILE, data)
  return true
}

export function activeProject(): Project | null {
  const d = readProjects()
  return d.projects.find((p) => p.id === d.activeId) ?? null
}

// ---------- Conversations ----------
export type StoredMessage = { role: 'user' | 'assistant'; content: string; meta?: string; at?: number }
export type Conversation = {
  id: string
  title: string
  projectId: string | null
  pinned: boolean
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
}
export type ConversationSummary = Omit<Conversation, 'messages'> & { count: number }
const CONV_FILE = 'conversations.json'
const readConvs = (): Conversation[] => readJson<Conversation[]>(CONV_FILE, [])

export function listConversations(): ConversationSummary[] {
  return readConvs()
    .map(({ messages, ...rest }) => ({ ...rest, count: messages.length }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export const getConversation = (id: string): Conversation | null =>
  readConvs().find((c) => c.id === id) ?? null

export function saveConversation(input: {
  id?: string
  messages: StoredMessage[]
  projectId?: string | null
}): ConversationSummary {
  const all = readConvs()
  const msgs = (Array.isArray(input.messages) ? input.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content, meta: typeof m.meta === 'string' ? m.meta : undefined, at: typeof m.at === 'number' ? m.at : undefined }))
  const now = Date.now()
  let conv = input.id ? all.find((c) => c.id === input.id) : undefined
  if (!conv) {
    const first = msgs.find((m) => m.role === 'user')?.content ?? 'محادثة جديدة'
    conv = {
      id: newId(),
      title: first.replace(/\s+/g, ' ').slice(0, 50),
      projectId: input.projectId ?? null,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messages: msgs
    }
    all.push(conv)
  } else {
    conv.messages = msgs
    conv.updatedAt = now
  }
  writeJson(CONV_FILE, all)
  const { messages, ...rest } = conv
  return { ...rest, count: messages.length }
}

export function deleteConversation(id: string): boolean {
  const all = readConvs()
  const next = all.filter((c) => c.id !== id)
  if (next.length === all.length) return false
  writeJson(CONV_FILE, next)
  return true
}

export function togglePinConversation(id: string): boolean | null {
  const all = readConvs()
  const c = all.find((x) => x.id === id)
  if (!c) return null
  c.pinned = !c.pinned
  writeJson(CONV_FILE, all)
  return c.pinned
}

export function renameConversation(id: string, title: string): boolean {
  const all = readConvs()
  const c = all.find((x) => x.id === id)
  const t = String(title ?? '').trim().slice(0, 80)
  if (!c || !t) return false
  c.title = t
  writeJson(CONV_FILE, all)
  return true
}
