import fs from 'fs'
import { getStatePath } from './paths'

export type AppState = { disabledSkills: string[]; disabledTools: string[] }

export function readState(): AppState {
  try {
    const s = JSON.parse(fs.readFileSync(getStatePath(), 'utf-8'))
    return {
      disabledSkills: Array.isArray(s.disabledSkills) ? s.disabledSkills : [],
      disabledTools: Array.isArray(s.disabledTools) ? s.disabledTools : []
    }
  } catch {
    return { disabledSkills: [], disabledTools: [] }
  }
}

export function writeState(s: AppState): void {
  fs.writeFileSync(getStatePath(), JSON.stringify(s, null, 2))
}

// Flip `name` in the given list; returns the new enabled value.
export function toggleIn(list: 'disabledSkills' | 'disabledTools', name: string): boolean {
  const s = readState()
  const i = s[list].indexOf(name)
  if (i >= 0) s[list].splice(i, 1)
  else s[list].push(name)
  writeState(s)
  return i >= 0
}
