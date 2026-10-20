// Pure scheduling math (F01–F04). No electron imports, so it can be unit-tested.
// Times are computed in each task's IANA time zone (F02), when missing the system zone is used.

export type DueInput = {
  enabled: boolean
  kind: 'daily' | 'weekly' | 'interval' | 'once'
  time: string // HH:MM (daily/weekly)
  days: number[] // 0=Sunday..6 (weekly)
  everyMin: number // interval step
  createdAt: number
  lastRun?: number
  runAt?: number // once: epoch ms
  tz?: string // IANA zone; empty = system zone
}

const CATCH_UP_MS = 12 * 3600000 // a missed daily/weekly slot is recovered only within 12 hours (F04)

export const systemTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// Wall-clock parts of an instant as seen in a zone.
export function zonedParts(ts: number, tz: string): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short'
  })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(ts)) p[x.type] = x.value
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: DOW[p.weekday] ?? 0 }
}

// Epoch ms of a wall-clock time in a zone (handles DST by correcting the offset twice).
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min)
  const offsetAt = (ts: number): number => {
    const p = zonedParts(ts, tz)
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - ts
  }
  const first = guess - offsetAt(guess)
  return guess - offsetAt(first)
}

// The most recent daily/weekly slot at or before nowMs, in the task's zone (null for interval/once).
export function lastDueSlot(t: DueInput, nowMs: number): number | null {
  if (t.kind === 'interval' || t.kind === 'once') return null
  const tz = t.tz || systemTz()
  const [h, min] = t.time.split(':').map(Number)
  const today = zonedParts(nowMs, tz)
  for (let back = 0; back < 9; back++) {
    const dt = new Date(Date.UTC(today.y, today.m - 1, today.d - back))
    const y = dt.getUTCFullYear()
    const m = dt.getUTCMonth() + 1
    const d = dt.getUTCDate()
    if (t.kind === 'weekly' && !t.days.includes(dt.getUTCDay())) continue
    const ts = zonedToUtc(y, m, d, h, min, tz)
    if (ts > nowMs) continue
    return ts
  }
  return null
}

// F03: interval tasks run on a fixed grid anchored at creation (createdAt + k*step), not on "last run + step",
// so the schedule does not drift over time. The first slot is one step after creation.
export function intervalSlot(createdAt: number, everyMin: number, nowMs: number): number | null {
  const step = Math.max(1, everyMin) * 60000
  const k = Math.floor((nowMs - createdAt) / step)
  if (k < 1) return null
  return createdAt + k * step
}

export function isScheduleDue(t: DueInput, nowMs: number, isRunning: boolean): boolean {
  if (!t.enabled || isRunning) return false
  if (t.kind === 'once') return t.runAt != null && nowMs >= t.runAt && (t.lastRun ?? 0) < t.runAt
  if (t.kind === 'interval') {
    const slot = intervalSlot(t.createdAt, t.everyMin, nowMs)
    return slot != null && (t.lastRun ?? 0) < slot
  }
  const slot = lastDueSlot(t, nowMs)
  if (slot == null) return false
  return slot >= t.createdAt && nowMs - slot < CATCH_UP_MS && (t.lastRun ?? 0) < slot
}
