import { readJson, writeJson } from './json-store'

// 5.16: عدّاد استخدام Claude محلي. ما في API بيعطينا نسبة الحصة الحقيقية، فالنسبة محسوبة من سقف أسبوعي بتحدده انت.
type Day = { runs: number; minutes: number }
type Store = { capRuns: number; capMinutes: number; days: Record<string, Day> }
export type ClaudeUsage = { runs: number; minutes: number; capRuns: number; capMinutes: number; pct: number | null }

const FILE = 'claude-usage.json'
const WINDOW_DAYS = 7
const KEEP_DAYS = 14
const LEVELS = [70, 90]

const dayKey = (d: Date): string => d.toISOString().slice(0, 10)
const lastDays = (n: number): string[] => Array.from({ length: n }, (_, i) => dayKey(new Date(Date.now() - i * 86400000)))

function load(): Store {
  const s = readJson<Partial<Store>>(FILE, {})
  return { capRuns: Number(s.capRuns) || 0, capMinutes: Number(s.capMinutes) || 0, days: s.days ?? {} }
}

function weekTotals(s: Store): { runs: number; minutes: number } {
  let runs = 0
  let minutes = 0
  for (const k of lastDays(WINDOW_DAYS)) {
    const v = s.days[k]
    if (v) {
      runs += v.runs
      minutes += v.minutes
    }
  }
  return { runs, minutes }
}

/** أعلى نسبة من السقفين (تشغيلات، دقايق). null إذا ما في سقف محدد. */
export function usagePct(t: { runs: number; minutes: number }, caps: { capRuns: number; capMinutes: number }): number | null {
  const parts: number[] = []
  if (caps.capRuns > 0) parts.push((t.runs / caps.capRuns) * 100)
  if (caps.capMinutes > 0) parts.push((t.minutes / caps.capMinutes) * 100)
  return parts.length ? Math.max(...parts) : null
}

/** أعلى مستوى تنبيه عبرناه بين القيمة القديمة والجديدة (70 أو 90)، أو null. */
export function crossedLevel(prev: number | null, next: number | null): number | null {
  if (next === null) return null
  const before = prev ?? 0
  const hit = LEVELS.filter((l) => before < l && next >= l)
  return hit.length ? hit[hit.length - 1] : null
}

export function getClaudeUsage(): ClaudeUsage {
  const s = load()
  const t = weekTotals(s)
  return { ...t, capRuns: s.capRuns, capMinutes: s.capMinutes, pct: usagePct(t, s) }
}

export function setClaudeCap(next: { capRuns?: number; capMinutes?: number }): ClaudeUsage {
  const s = load()
  if (next.capRuns !== undefined) s.capRuns = Math.max(0, Math.round(Number(next.capRuns) || 0))
  if (next.capMinutes !== undefined) s.capMinutes = Math.max(0, Math.round(Number(next.capMinutes) || 0))
  writeJson(FILE, s)
  return getClaudeUsage()
}

/** يسجّل تشغيل Claude واحد. يرجّع رسالة تنبيه إذا عبرت النسبة 70% أو 90%. */
export function recordClaudeRun(minutes: number): string | null {
  const s = load()
  const before = usagePct(weekTotals(s), s)
  const k = dayKey(new Date())
  const d = s.days[k] ?? { runs: 0, minutes: 0 }
  d.runs += 1
  d.minutes += Math.max(0, minutes)
  s.days[k] = d
  const keep = new Set(lastDays(KEEP_DAYS))
  for (const key of Object.keys(s.days)) if (!keep.has(key)) delete s.days[key]
  writeJson(FILE, s)
  const after = usagePct(weekTotals(s), s)
  const lvl = crossedLevel(before, after)
  if (lvl === null || after === null) return null
  return (
    'تنبيه حصة Claude: وصلت ' + Math.round(after) + '% من السقف الأسبوعي اللي حدّدته (عتبة ' + lvl + '%). ' +
    (lvl >= 90 ? 'وقّف الأدوار الثقيلة على Claude أو بدّل المنفّذ لمحرّك ثاني.' : 'خفّف التخطيط والمراجعة على Claude.')
  )
}