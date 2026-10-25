import { readJson, writeJson } from './json-store'

// Personal to-do list ("ملاحظات"). It lives in the main process (todo.json) so the desktop page and the phone app read and write the same list.
export type TodoItem = { id: string; text: string; done: boolean; at: number }
export type TodoOp =
  | { op: 'add'; lines: string[] }
  | { op: 'toggle'; id: string }
  | { op: 'del'; id: string }
  | { op: 'clearDone' }
  | { op: 'import'; items: unknown }

const FILE = 'todo.json'
const MAX_ITEMS = 1000
const MAX_LINES = 50
const MAX_TEXT = 2000

export function cleanItems(v: unknown): TodoItem[] {
  if (!Array.isArray(v)) return []
  const out: TodoItem[] = []
  for (const i of v as Partial<TodoItem>[]) {
    if (!i || typeof i.text !== 'string' || !i.text.trim()) continue
    out.push({
      id: typeof i.id === 'string' && i.id ? i.id.slice(0, 60) : `${Date.now()}-${out.length}`,
      text: i.text.slice(0, MAX_TEXT),
      done: i.done === true,
      at: typeof i.at === 'number' ? i.at : Date.now()
    })
  }
  return out.slice(0, MAX_ITEMS)
}

/** One pasted block -> one item per line (bullets and numbering stripped), same rule as the desktop page. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((l) => l.slice(0, MAX_TEXT))
}

/** Pure: applies one operation to a list and returns the new list. Unknown or malformed ops change nothing. */
export function applyOp(items: TodoItem[], op: unknown, now = Date.now()): TodoItem[] {
  const o = op as { op?: string; lines?: unknown; id?: unknown; items?: unknown } | null
  if (!o || typeof o !== 'object') return items
  switch (o.op) {
    case 'add': {
      const lines = Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).slice(0, MAX_LINES) : []
      if (!lines.length) return items
      const added = lines.map((t, i) => ({ id: `${now}-${i}-${Math.random().toString(36).slice(2, 6)}`, text: t.trim().slice(0, MAX_TEXT), done: false, at: now }))
      return [...added, ...items].slice(0, MAX_ITEMS)
    }
    case 'toggle':
      return typeof o.id === 'string' ? items.map((x) => (x.id === o.id ? { ...x, done: !x.done } : x)) : items
    case 'del':
      return typeof o.id === 'string' ? items.filter((x) => x.id !== o.id) : items
    case 'clearDone':
      return items.filter((x) => !x.done)
    case 'import':
      // one-time migration from the old browser storage: only when nothing is saved yet
      return items.length === 0 ? cleanItems(o.items) : items
    default:
      return items
  }
}

const listeners = new Set<() => void>()
export const onTodoChange = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function listTodo(): TodoItem[] {
  return cleanItems(readJson<{ items?: unknown }>(FILE, {}).items)
}

export function todoOp(op: unknown): TodoItem[] {
  const cur = listTodo()
  const next = applyOp(cur, op)
  if (next !== cur) {
    writeJson(FILE, { items: next })
    for (const f of listeners) {
      try {
        f()
      } catch {
        /* a failing listener must not block the others */
      }
    }
  }
  return next
}