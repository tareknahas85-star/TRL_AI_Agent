import { readJson, writeJson } from './json-store'

// Free-only guard: while on (default), the router never tries paid tiers.
const FILE = 'spend.json'
export const freeOnly = (): boolean => readJson<{ freeOnly?: boolean }>(FILE, {}).freeOnly !== false
export const setFreeOnly = (on: boolean): boolean => {
  writeJson(FILE, { freeOnly: on })
  return on
}
