import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readJson, writeJson } from '../core/json-store'
import { interpretRelease, interpretFailure, shouldPrompt, POSTPONE_MS, type UpdateResult } from '../core/update-state'

// Update flow:
// 1) A daily check against GitHub Releases (one anonymous GET, sends nothing about you).
// 2) If a newer version exists, the app ASKS: "update now" or "later". Nothing is downloaded or installed without that yes.
// 3) "Now": download the new version, then restart and install. "Later": asked again after 24 hours.
const REPO = 'tareknahas85-star/TRL_AI_Agent'
const FILE = 'updates.json'
type Cfg = { enabled: boolean; lastCheck: number; snoozeUntil: number }

const cfg = (): Cfg => ({ enabled: true, lastCheck: 0, snoozeUntil: 0, ...readJson<Partial<Cfg>>(FILE, {}) })

// electron-updater must never download or install on its own.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

let wantInstall = false

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

export async function checkUpdate(): Promise<UpdateResult> {
  const current = app.getVersion()
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'TRL_AI_Agent' },
      signal: AbortSignal.timeout(10000)
    })
    let body: { tag_name?: unknown; html_url?: unknown } | null = null
    if (r.ok) body = (await r.json()) as { tag_name?: unknown; html_url?: unknown }
    return interpretRelease(r.status, body, current, {
      remaining: r.headers.get('x-ratelimit-remaining'),
      reset: r.headers.get('x-ratelimit-reset')
    })
  } catch (e) {
    return interpretFailure(e, current)
  }
}

function askUser(r: UpdateResult): void {
  send('update:prompt', { latest: r.latest, current: r.current, url: r.url })
}

async function auto(): Promise<void> {
  const c = cfg()
  if (!c.enabled || Date.now() - c.lastCheck < 22 * 3600 * 1000) return
  const r = await checkUpdate()
  const next = { ...c, lastCheck: Date.now() }
  if (shouldPrompt(r, c.snoozeUntil)) askUser(r)
  writeJson(FILE, next)
}

// Download and install progress, pushed to the window.
autoUpdater.on('update-available', () => {
  // Downloading starts only when the user said "now".
  if (!wantInstall) return
  send('update:progress', { stage: 'downloading', percent: 0 })
  void autoUpdater.downloadUpdate().catch((err: Error) => {
    wantInstall = false
    send('update:progress', { stage: 'error', message: err.message })
  })
})
autoUpdater.on('download-progress', (p) => send('update:progress', { stage: 'downloading', percent: Math.round(p.percent) }))
autoUpdater.on('update-not-available', () => {
  wantInstall = false
  send('update:progress', { stage: 'none' })
})
autoUpdater.on('error', (err) => {
  wantInstall = false
  send('update:progress', { stage: 'error', message: err?.message ?? 'خطأ غير معروف' })
})
autoUpdater.on('update-downloaded', () => {
  if (!wantInstall) return
  send('update:progress', { stage: 'installing' })
  // Restart now and install. The window closes, the installer runs.
  autoUpdater.quitAndInstall(false, true)
})

export function registerUpdateHandlers(): void {
  ipcMain.handle('update:get', () => ({ enabled: cfg().enabled, version: app.getVersion() }))
  ipcMain.handle('update:set', (_e, enabled: unknown) => {
    writeJson(FILE, { ...cfg(), enabled: !!enabled })
    return { enabled: !!enabled, version: app.getVersion() }
  })
  ipcMain.handle('update:check', async () => {
    const r = await checkUpdate()
    writeJson(FILE, { ...cfg(), lastCheck: Date.now() })
    // A manual check always shows the question, even during a snooze.
    if (r.status === 'available') askUser(r)
    return r
  })
  ipcMain.handle('update:now', async () => {
    if (!app.isPackaged) {
      return { ok: false, note: 'التحديث من داخل البرنامج بيشتغل بالنسخة المركّبة بس، مش بوضع التطوير' }
    }
    wantInstall = true
    try {
      send('update:progress', { stage: 'checking' })
      await autoUpdater.checkForUpdates()
      // The rest happens in the events above: download, then install.
      return { ok: true }
    } catch (e) {
      wantInstall = false
      const message = e instanceof Error ? e.message : String(e)
      send('update:progress', { stage: 'error', message })
      return { ok: false, note: message }
    }
  })
  ipcMain.handle('update:later', () => {
    writeJson(FILE, { ...cfg(), snoozeUntil: Date.now() + POSTPONE_MS })
    return true
  })
  ipcMain.handle('update:open', (_e, url: unknown) => {
    if (typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`)) void shell.openExternal(url)
    return true
  })
  setTimeout(() => void auto().catch(() => undefined), 30000)
  setInterval(() => void auto().catch(() => undefined), 6 * 3600 * 1000)
}
