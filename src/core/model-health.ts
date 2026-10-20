import { readJson, writeJson } from './json-store'
import { isRateLimitError, parseRetryAfterMs, cooldownMs } from './rate-limit'

// Remembers models that cannot work right now so the router does not waste a request on them every time:
// - OpenRouter free daily limit reached (429 "free-models-per-day"): every :free model is skipped until the next UTC midnight.
// - Models that refuse API use (403 "only available on agentic harnesses" / not found): skipped for 24h.
// - F07/F08: models hit by a rate limit / overload are cooled down (Retry-After if sent, otherwise 30s doubling, max 30 min).
type Limited = { until: number; streak: number }
type Health = { freeUntil: number; blocked: Record<string, number>; limited: Record<string, Limited> }
const FILE = 'model-health.json'
const load = (): Health => {
  const raw = readJson<Partial<Health>>(FILE, {})
  return { freeUntil: 0, blocked: {}, ...raw, limited: raw.limited ?? {} }
}
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

// Reads a header from the SDK error (a Headers object or a plain record, depending on the SDK version).
function headerOf(h: unknown, name: string): string | null {
  if (!h) return null
  const get = (h as { get?: (k: string) => string | null }).get
  if (typeof get === 'function') return get.call(h, name) ?? null
  const rec = h as Record<string, unknown>
  const v = rec[name] ?? rec[name.toLowerCase()]
  return v == null ? null : String(v)
}

// F07/F08: call on every failed attempt. Only real rate limits / overloads start a cooldown.
export function noteRateLimit(model: string, error: unknown): void {
  const e = error as { status?: number; headers?: unknown }
  const msg = error instanceof Error ? error.message : String(error)
  if (!isRateLimitError(e?.status, msg)) return
  const h = load()
  const now = Date.now()
  const prev = h.limited[model]
  // A streak continues while the previous cooldown ended less than an hour ago; otherwise it starts again.
  const streak = (prev && prev.until > now - 3600000 ? prev.streak : 0) + 1
  const retryAfter = parseRetryAfterMs(headerOf(e?.headers, 'retry-after'), now)
  h.limited[model] = { until: now + cooldownMs(streak, retryAfter), streak }
  writeJson(FILE, h)
}

// F07: a successful answer clears the cooldown and the streak for that model.
export function noteModelOk(model: string): void {
  const h = load()
  if (h.limited[model]) {
    delete h.limited[model]
    writeJson(FILE, h)
  }
}

// Seconds left on a model's rate-limit cooldown (0 when it is not cooling down).
export function rateLimitWaitSec(model: string): number {
  const lim = load().limited[model]
  return lim && lim.until > Date.now() ? Math.ceil((lim.until - Date.now()) / 1000) : 0
}

export function modelBlockReason(model: string): string | null {
  const h = load()
  const now = Date.now()
  const isOpenRouterFree = model.endsWith(':free') || model === 'openrouter/free'
  if (isOpenRouterFree && h.freeUntil > now) return 'free-daily-limit'
  if ((h.blocked[model] ?? 0) > now) return 'blocked'
  if ((h.limited[model]?.until ?? 0) > now) return 'rate-limited'
  return null
}

// Counts today's OpenRouter free-model requests (UTC day) so the UI can show how close the daily cap is.
const COUNT_FILE = 'free-usage.json'
export const FREE_DAILY_LIMIT = 50 // 1000 once the OpenRouter account has $10 credit
const utcDay = (): string => new Date().toISOString().slice(0, 10)
export function bumpFreeCount(): void {
  const u = readJson<{ day?: string; count?: number }>(COUNT_FILE, {})
  const day = utcDay()
  writeJson(COUNT_FILE, { day, count: (u.day === day ? (u.count ?? 0) : 0) + 1 })
}
export function freeUsage(): { count: number; limit: number; limited: boolean } {
  const u = readJson<{ day?: string; count?: number }>(COUNT_FILE, {})
  return { count: u.day === utcDay() ? (u.count ?? 0) : 0, limit: FREE_DAILY_LIMIT, limited: load().freeUntil > Date.now() }
}
