import { app, ipcMain, Notification, shell } from 'electron'
import { readJson, writeJson } from '../core/json-store'

// Update check (no silent install): asks GitHub Releases once a day for a newer version and tells you.
// Only one anonymous GET to api.github.com; it sends nothing about you or your files.
const REPO = 'tareknahas85-star/TRL_AI_Agent'
const FILE = 'updates.json'
type Cfg = { enabled: boolean; lastCheck: number; notified: string }
type Res = { ok: boolean; current: string; latest?: string; newer?: boolean; url?: string; note?: string }

const cfg = (): Cfg => ({ enabled: true, lastCheck: 0, notified: '', ...readJson<Partial<Cfg>>(FILE, {}) })
const nums = (v: string): number[] => (v.replace(/^v/i, '').match(/\d+/g) ?? []).map(Number)
export const isNewer = (a: string, b: string): boolean => {
  const x = nums(a)
  const y = nums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export async function checkUpdate(): Promise<Res> {
  const current = app.getVersion()
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'TRL_AI_Agent' },
      signal: AbortSignal.timeout(10000)
    })
    if (r.status === 404) return { ok: true, current, newer: false, note: 'ما في إصدارات منشورة على GitHub لسا' }
    if (!r.ok) return { ok: false, current, note: 'GitHub رد ' + r.status }
    const j = (await r.json()) as { tag_name?: string; html_url?: string }
    const latest = j.tag_name ?? ''
    return { ok: true, current, latest, newer: !!latest && isNewer(latest, current), url: j.html_url }
  } catch (e) {
    return { ok: false, current, note: e instanceof Error ? e.message : String(e) }
  }
}

async function auto(): Promise<void> {
  const c = cfg()
  if (!c.enabled || Date.now() - c.lastCheck < 22 * 3600 * 1000) return
  const r = await checkUpdate()
  const next = { ...c, lastCheck: Date.now() }
  if (r.ok && r.newer && r.latest && c.notified !== r.latest) {
    next.notified = r.latest
    try {
      new Notification({ title: 'TRL_AI_Agent: في تحديث', body: `إصدار ${r.latest} متوفر (إنت على ${r.current}). افتح الإعدادات ← عام.` }).show()
    } catch {
      /* notification is best effort */
    }
  }
  writeJson(FILE, next)
}

export function registerUpdateHandlers(): void {
  ipcMain.handle('update:get', () => ({ enabled: cfg().enabled, version: app.getVersion() }))
  ipcMain.handle('update:set', (_e, enabled: unknown) => {
    writeJson(FILE, { ...cfg(), enabled: !!enabled })
    return { enabled: !!enabled, version: app.getVersion() }
  })
  ipcMain.handle('update:check', async () => {
    const r = await checkUpdate()
    writeJson(FILE, { ...cfg(), lastCheck: Date.now() })
    return r
  })
  ipcMain.handle('update:open', (_e, url: unknown) => {
    if (typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`)) void shell.openExternal(url)
    return true
  })
  setTimeout(() => void auto().catch(() => undefined), 30000)
  setInterval(() => void auto().catch(() => undefined), 6 * 3600 * 1000)
}
