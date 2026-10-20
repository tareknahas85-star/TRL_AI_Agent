import { readJson, writeJson } from './json-store'
import { CODEX_CLI, GEMINI_CLI } from './cli-agent'

// Per-role engine preference: manager, executor and reviewer. 'auto' keeps the built-in order.
export type RoleEngine = 'auto' | typeof GEMINI_CLI | 'cli:claude' | typeof CODEX_CLI
export type Roles = { manager: RoleEngine; executor: RoleEngine; reviewer: RoleEngine }

const VALID = new Set<string>(['auto', GEMINI_CLI, 'cli:claude', CODEX_CLI])
const pick = (v: unknown): RoleEngine => (typeof v === 'string' && VALID.has(v) ? (v as RoleEngine) : 'auto')

export function getRoles(): Roles {
  const raw = readJson<Partial<Roles>>('roles.json', {})
  return { manager: pick(raw.manager), executor: pick(raw.executor), reviewer: pick(raw.reviewer) }
}

export function setRoles(next: Partial<Roles>): Roles {
  const cur = getRoles()
  const merged: Roles = {
    manager: pick(next.manager ?? cur.manager),
    executor: pick(next.executor ?? cur.executor),
    reviewer: pick(next.reviewer ?? cur.reviewer),
  }
  writeJson('roles.json', merged)
  return merged
}