import { Notification } from 'electron'
import { readJson, writeJson, newId } from './json-store'
import { saveConversation } from './workspace'
import { isScheduleDue, isValidTimeZone } from './schedule-time'

// Recurring tasks: "every day at 12:00 do X". The app lives in the tray, so the scheduler keeps running after the window is closed.
export type Schedule = {
  id: string
  name: string
  prompt: string
  projectId: string | null
  mode: 'free' | 'auto'
  kind: 'daily' | 'weekly' | 'interval' | 'once' // once = F01 "at a specific time, one time only"
  time: string // HH:MM (daily/weekly)
  days: number[] // 0=Sunday..6 (weekly)
  everyMin: number // interval
  tz?: string // F02: IANA zone for daily/weekly/once. Missing = system zone.
  runAt?: number // once: epoch ms
  enabled: boolean
  createdAt: number
  lastRun?: number
  lastStatus?: 'ok' | 'failed' | 'running'
  lastResult?: string
  lastConversationId?: string
  failStreak?: number // F06: consecutive failed runs; reset on success
}
const FILE = 'schedules.json'
export type Runner = (prompt: string, projectId: string | null, mode: 'free' | 'auto', taskId: string) => Promise<{ content: string; failed?: boolean; meta?: string }>

let runner: Runner | null = null
let timer: NodeJS.Timeout | null = null
const running = new Set<string>()

export const setScheduleRunner = (r: Runner): void => {
  runner = r
}
export const listSchedules = (): Schedule[] => readJson<Schedule[]>(FILE, [])
const save = (all: Schedule[]): void => writeJson(FILE, all)

function clean(i: Partial<Schedule>, base?: Schedule): Schedule {
  const kind = i.kind === 'weekly' || i.kind === 'interval' || i.kind === 'once' ? i.kind : 'daily'
  const time = /^\d{1,2}:\d{2}$/.test(String(i.time ?? '')) ? String(i.time).padStart(5, '0') : '12:00'

  let tz: string | undefined = base?.tz
  if (i.tz !== undefined) {
    const s = String(i.tz ?? '').trim()
    if (!s) tz = undefined
    else if (!isValidTimeZone(s)) throw new Error('المنطقة الزمنية مو صحيحة: ' + s)
    else tz = s
  }

  let runAt: number | undefined
  if (kind === 'once') {
    const v = Number(i.runAt ?? base?.runAt)
    if (!Number.isFinite(v) || v <= 0) throw new Error('وقت التشغيل مطلوب للمهمة مرة وحدة')
    runAt = v
  }

  const t: Schedule = {
    id: base?.id ?? newId(),
    name: String(i.name ?? '').trim().slice(0, 80) || 'مهمة',
    prompt: String(i.prompt ?? '').trim(),
    projectId: typeof i.projectId === 'string' && i.projectId ? i.projectId : null,
    mode: i.mode === 'free' ? 'free' : 'auto',
    kind,
    time,
    days: Array.isArray(i.days) ? i.days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
    everyMin: Math.max(5, Math.min(10080, Number(i.everyMin) || 60)),
    tz,
    runAt,
    enabled: i.enabled !== false,
    createdAt: base?.createdAt ?? Date.now(),
    lastRun: base?.lastRun,
    lastStatus: base?.lastStatus,
    lastResult: base?.lastResult,
    lastConversationId: base?.lastConversationId,
    failStreak: base?.failStreak
  }
  if (!t.prompt) throw new Error('نص المهمة فاضي')
  if (t.kind === 'weekly' && !t.days.length) t.days = [new Date().getDay()]
  return t
}

export function addSchedule(i: Partial<Schedule>): Schedule {
  const t = clean(i)
  save([...listSchedules(), t])
  return t
}
export function updateSchedule(id: string, patch: Partial<Schedule>): Schedule | null {
  const all = listSchedules()
  const idx = all.findIndex((x) => x.id === id)
  if (idx < 0) return null
  all[idx] = clean({ ...all[idx], ...patch }, all[idx])
  save(all)
  return all[idx]
}
export function removeSchedule(id: string): boolean {
  const all = listSchedules()
  const next = all.filter((x) => x.id !== id)
  if (next.length === all.length) return false
  save(next)
  return true
}

export function isDue(t: Schedule, now = Date.now()): boolean {
  return isScheduleDue(t, now, running.has(t.id))
}

export async function runScheduleNow(id: string): Promise<boolean> {
  const t = listSchedules().find((x) => x.id === id)
  if (!t || !runner || running.has(id)) return false
  running.add(id)
  const patch = (p: Partial<Schedule>): void => {
    const all = listSchedules()
    const i = all.findIndex((x) => x.id === id)
    if (i >= 0) {
      all[i] = { ...all[i], ...p }
      save(all)
    }
  }
  patch({ lastStatus: 'running', lastRun: Date.now() })
  try {
    const r = await runner(t.prompt, t.projectId, t.mode, id)
    const ok = !r.failed && !/^Error:/.test(r.content) && !!r.content
    const at = Date.now()
    // F05: the conversation is saved first; the task status is only updated after that succeeds.
    const conv = saveConversation({
      messages: [
        { role: 'user', content: '⏰ [' + t.name + '] ' + t.prompt, at },
        { role: 'assistant', content: r.content || '(بدون نتيجة)', meta: r.meta, at }
      ],
      projectId: t.projectId
    })
    patch({ lastStatus: ok ? 'ok' : 'failed', lastResult: (r.content || '').slice(0, 4000), lastConversationId: conv.id, failStreak: ok ? 0 : (t.failStreak ?? 0) + 1 })
    try {
      new Notification({ title: (ok ? '✅ ' : '⚠️ ') + t.name, body: (r.content || '').replace(/\s+/g, ' ').slice(0, 180) }).show()
    } catch {
      /* no notifications */
    }
    return ok
  } catch (e) {
    patch({ lastStatus: 'failed', lastResult: 'Error: ' + (e instanceof Error ? e.message : String(e)), failStreak: (t.failStreak ?? 0) + 1 })
    return false
  } finally {
    running.delete(id)
  }
}

// F05: a run that was interrupted by closing the app leaves "running" on disk. Mark those as failed at startup.
function recoverInterrupted(): void {
  const all = listSchedules()
  let changed = false
  for (const t of all) {
    if (t.lastStatus === 'running' && !running.has(t.id)) {
      t.lastStatus = 'failed'
      t.lastResult = 'انقطعت المهمة لأن التطبيق انسكر وقت التنفيذ'
      changed = true
    }
  }
  if (changed) save(all)
}

export function startScheduler(): void {
  if (timer) return
  recoverInterrupted()
  const tick = (): void => {
    for (const t of listSchedules()) if (isDue(t)) void runScheduleNow(t.id)
  }
  setTimeout(tick, 15000)
  timer = setInterval(tick, 30000)
}
export const stopScheduler = (): void => {
  if (timer) clearInterval(timer)
  timer = null
}
export const runningSchedules = (): string[] => [...running]
