import { readJson, writeJson } from './json-store'

// Which local (Ollama) model answers light chat.
//   null   = off (default): light chat goes to the first working free model, no local model involved.
//   'auto' = the app measures installed local models and picks the fastest that answers well (see trivial.ts).
//   name   = always that model.
export const LOCAL_AUTO = 'auto'
const FILE = 'local-chat.json'

export const localChatModel = (): string | null => {
  const m = readJson<{ model?: unknown }>(FILE, {}).model
  return typeof m === 'string' && m.trim() ? m.trim() : null
}

export const setLocalChatModel = (model: unknown): string | null => {
  const m = typeof model === 'string' && model.trim() ? model.trim().slice(0, 200) : null
  writeJson(FILE, { model: m })
  return m
}
