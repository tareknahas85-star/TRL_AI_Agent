import { readJson, writeJson } from './json-store'

// Remembers models that cannot work right now so the router does not waste a request on them every time:
// - OpenRouter free daily limit reached (429 "free-models-per-day"): every :free model is skipped until the next UTC midnight.
// - Models that refuse API use (403 "only available on agentic harnesses" / not found): skipped for 24h.
type Health = { freeUntil: number; blocked: Record<string, number> }
const FILE = 'model-health.json'
const load = (): Health => ({ freeUntil: 0, blocked: {}, ...readJson<Partial<Health>>(FILE, {}) })
const nextUtcMidnight = (): number => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

export function noteModelFailure(model: string, message: string): void {
  const h = load()
  let changed = false
  if (/free-models-per-day/i.test(message)) {
    h.freeUntil = nextUtcMidnight()
    changed = true
  } else if (/only available on agentic harness|No endpoints found|model not found|is not a valid model/i.test(message)) {
    h.blocked[model] = Date.now() + 24 * 3600 * 1000
    changed = true
  }
  if (changed) writeJson(FILE, h)
}

export function modelBlockReason(model: string): string | null {
  const h = load()
  const now = Date.now()
  const isOpenRouterFree = model.endsWith(':free') || model === 'openrouter/free'
  if (isOpenRouterFree && h.freeUntil > now) return 'free-daily-limit'
  if ((h.blocked[model] ?? 0) > now) return 'blocked'
  return null
}
