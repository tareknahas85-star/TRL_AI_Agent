import { readJson, writeJson } from './json-store'

// Which free source goes first in the free (normal chat) mode. OpenRouter is the default; the other one is the fallback.
export type FreeFirst = 'openrouter' | 'apinex'
const FILE = 'free-provider.json'

export const freeFirst = (): FreeFirst =>
  readJson<{ first?: FreeFirst }>(FILE, {}).first === 'apinex' ? 'apinex' : 'openrouter'

export const setFreeFirst = (first: FreeFirst): FreeFirst => {
  writeJson(FILE, { first })
  return first
}
