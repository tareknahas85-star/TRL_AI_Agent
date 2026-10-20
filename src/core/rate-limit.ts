// Pure helpers for F07 (backoff after rate limits) and F08 (honouring Retry-After). No I/O, so they are unit-tested.

export const RL_BASE_MS = 30_000 // first cooldown after a rate limit
export const RL_CAP_MS = 30 * 60_000 // never block a model longer than 30 minutes

// True when an error is a provider rate limit / temporary overload (retry later), not a billing or "free daily cap" problem.
export function isRateLimitError(status: number | undefined, message: string): boolean {
  if (/insufficient|billing|payment|credit|free-models-per-day/i.test(message)) return false
  if (status === 429 || status === 503) return true
  return /rate.?limit|too many requests|overloaded|temporarily unavailable/i.test(message)
}

// Retry-After is either delta-seconds or an HTTP date. Returns milliseconds from now, or null when missing/invalid.
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (value == null) return null
  const v = String(value).trim()
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return Math.max(0, t - nowMs)
}

// How long to block a model: the provider's Retry-After when it sent a usable one, otherwise 30s doubling per consecutive limit.
export function cooldownMs(streak: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null && retryAfterMs > 0) return Math.min(retryAfterMs, RL_CAP_MS)
  return Math.min(RL_BASE_MS * 2 ** (Math.max(1, streak) - 1), RL_CAP_MS)
}
