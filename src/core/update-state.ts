// F23: detailed update-check states. Pure logic (no Electron), so it can be tested.
// Each state tells the user exactly what happened, and what to do about it.

export type UpdateStatus = 'current' | 'available' | 'no-release' | 'rate-limited' | 'offline' | 'timeout' | 'error'

export type UpdateResult = {
  status: UpdateStatus
  current: string
  latest?: string
  url?: string
  // When GitHub's rate limit resets (epoch ms), so the UI can say when to try again.
  retryAt?: number
}

// Compares "v5.16.0" style versions numerically. True when a is newer than b.
export function isNewer(a: string, b: string): boolean {
  const nums = (v: string): number[] => (v.replace(/^v/i, '').match(/\d+/g) ?? []).map(Number)
  const x = nums(a)
  const y = nums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

type ReleaseBody = { tag_name?: unknown; html_url?: unknown }

// Turns GitHub's HTTP response into a state.
// headers: only the two rate-limit headers matter.
export function interpretRelease(
  httpStatus: number,
  body: ReleaseBody | null,
  current: string,
  headers: { remaining?: string | null; reset?: string | null } = {},
  now: number = Date.now()
): UpdateResult {
  if (httpStatus === 404) return { status: 'no-release', current }

  // GitHub answers 403 or 429 when the anonymous limit is used up.
  const limited = httpStatus === 429 || (httpStatus === 403 && headers.remaining === '0')
  if (limited) {
    const reset = Number(headers.reset)
    return { status: 'rate-limited', current, retryAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : now + 3600_000 }
  }

  if (httpStatus < 200 || httpStatus >= 300) return { status: 'error', current }

  const latest = typeof body?.tag_name === 'string' ? body.tag_name : ''
  const url = typeof body?.html_url === 'string' ? body.html_url : undefined
  if (!latest) return { status: 'no-release', current }
  return isNewer(latest, current) ? { status: 'available', current, latest, url } : { status: 'current', current, latest }
}

// Turns a thrown error (no response at all) into a state.
// AbortSignal.timeout throws a TimeoutError; a dropped connection makes fetch throw a TypeError.
export function interpretFailure(err: unknown, current: string): UpdateResult {
  const name = err instanceof Error ? err.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return { status: 'timeout', current }
  if (err instanceof TypeError) return { status: 'offline', current }
  return { status: 'error', current }
}

// Whether to ask the user "update now or later" right now.
// Asks only when a newer version exists and the user has not postponed ("بعدين") until a later time.
export const POSTPONE_MS = 24 * 3600 * 1000
export function shouldPrompt(r: UpdateResult, snoozeUntil: number, now: number = Date.now()): boolean {
  return r.status === 'available' && now >= snoozeUntil
}

// Arabic text for the UI, per state. Kept here so it stays next to the logic.
export function describeUpdate(r: UpdateResult): string {
  switch (r.status) {
    case 'current':
      return 'إنت على آخر إصدار'
    case 'available':
      return `في إصدار أجدد: ${r.latest}`
    case 'no-release':
      return 'ما في إصدارات منشورة على GitHub لسا'
    case 'rate-limited':
      return r.retryAt
        ? 'GitHub حدّ الطلبات مؤقتاً. جرّب بعد ' + new Date(r.retryAt).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })
        : 'GitHub حدّ الطلبات مؤقتاً. جرّب بعد شوي'
    case 'offline':
      return 'ما في اتصال بالإنترنت. تأكد من الشبكة وجرّب'
    case 'timeout':
      return 'GitHub ما ردّ بالوقت المحدد. جرّب مرة تانية'
    case 'error':
      return 'صار خطأ أثناء الفحص. جرّب مرة تانية'
  }
}
