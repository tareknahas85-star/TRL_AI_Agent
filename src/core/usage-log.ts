import { readJson, writeJson } from './json-store'

// 5.16: سجل استخدام يومي لكل محرّك (Claude / Gemini / Codex). عدّاد محلي بس، ما فيه رصيد متبقي من الحساب.
export type EngineDay = { runs: number; minutes: number }
type Store = { days: Record<string, Record<string, EngineDay>> }
export type SeriesPoint = { day: string; runs: number; minutes: number }
export type EngineSeries = { engine: string; points: SeriesPoint[]; totalRuns: number; totalMinutes: number }
export type UsageSeries = { days: string[]; engines: EngineSeries[] }

const FILE = 'usage-log.json'
const KEEP = 30
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)
/** آخر n يوم بترتيب تصاعدي (قديم ← جديد). */
const lastDays = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => dayKey(new Date(Date.now() - i * 86400000))).reverse()

export function recordEngineRun(engine: string, minutes: number): void {
  try {
    const s = readJson<Store>(FILE, { days: {} })
    const k = dayKey(new Date())
    const day = s.days[k] ?? {}
    const cur = day[engine] ?? { runs: 0, minutes: 0 }
    cur.runs += 1
    cur.minutes += Math.max(0, minutes)
    day[engine] = cur
    s.days[k] = day
    const keep = new Set(lastDays(KEEP))
    for (const key of Object.keys(s.days)) if (!keep.has(key)) delete s.days[key]
    writeJson(FILE, s)
  } catch {
    /* best-effort: العدّاد ما بيوقف التشغيل */
  }
}

export function getEngineSeries(days = 14): UsageSeries {
  const s = readJson<Store>(FILE, { days: {} })
  const win = lastDays(days)
  const names = new Set<string>()
  for (const d of win) for (const e of Object.keys(s.days[d] ?? {})) names.add(e)
  const engines: EngineSeries[] = [...names].sort().map((engine) => {
    const points: SeriesPoint[] = win.map((day) => {
      const v = s.days[day]?.[engine]
      return { day, runs: v?.runs ?? 0, minutes: Math.round((v?.minutes ?? 0) * 10) / 10 }
    })
    return {
      engine,
      points,
      totalRuns: points.reduce((a, p) => a + p.runs, 0),
      totalMinutes: Math.round(points.reduce((a, p) => a + p.minutes, 0) * 10) / 10,
    }
  })
  return { days: win, engines }
}