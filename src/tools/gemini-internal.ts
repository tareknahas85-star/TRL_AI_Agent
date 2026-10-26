// Gemini web (Nano Banana / Veo) driven inside the app: a dedicated, normally hidden window on its own persistent
// session, so nothing is shared with the side browser (which stays locked down) or with the user's Chrome.
// The user signs in to Google once through the visible window (showGeminiWindow); after that it runs hidden.
import { app, BrowserWindow, session } from 'electron'
import path from 'path'

export const GEMINI_PARTITION = 'persist:gemini-media'
export const GEMINI_APP_URL = 'https://gemini.google.com/app?hl=en'

export interface Drv {
  eval<T = unknown>(expr: string): Promise<T>
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  close(): Promise<void>
}

let win: BrowserWindow | null = null
let quitting = false
let hooked = false
let pending: { dir: string; resolve: (p: string) => void; reject: (e: Error) => void } | null = null

app.on('before-quit', () => {
  quitting = true
})

function hookSession(): void {
  if (hooked) return
  hooked = true
  const s = session.fromPartition(GEMINI_PARTITION)
  // Sign-in only needs cookies and storage; every device permission is refused.
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  s.setPermissionCheckHandler(() => false)
  // Downloads are refused unless a generation is waiting for one, and then go only to the media folder.
  s.on('will-download', (_e, item) => {
    const want = pending
    if (!want) {
      item.cancel()
      return
    }
    const target = path.join(want.dir, item.getFilename() || 'gemini-' + Date.now())
    item.setSavePath(target)
    item.once('done', (_ev, state) => {
      if (pending === want) pending = null
      state === 'completed' ? want.resolve(target) : want.reject(new Error('التنزيل ' + state))
    })
  })
}

function ensureWin(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  hookSession()
  const w = new BrowserWindow({
    show: false,
    width: 1200,
    height: 850,
    title: 'Gemini',
    autoHideMenuBar: true,
    webPreferences: { partition: GEMINI_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  const wc = w.webContents
  // A plain Chrome user agent: Google refuses sign-in from agents that announce "Electron".
  const ua = wc.getUserAgent().replace(/\s?Electron\/\S+/i, '').replace(/\s?(my-ai-router|TRL_AI_Agent)\/\S+/i, '')
  wc.setUserAgent(ua)
  wc.session.setUserAgent(ua, 'en-US,en')
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts|gemini)\.google\.com\//.test(url)) void wc.loadURL(url)
    return { action: 'deny' }
  })
  // Closing the window only hides it (the session and any sign-in stay); quitting the app really closes it.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  win = w
  return w
}

/** True when the internal session already holds a Google sign-in (Google refuses to sign in inside an embedded window, so this is rare). */
export async function hasGoogleLogin(): Promise<boolean> {
  const cs = await session.fromPartition(GEMINI_PARTITION).cookies.get({})
  return cs.some((c) => /^(__Secure-1PSID|SID)$/.test(c.name) && /google\.com$/.test(c.domain ?? ''))
}

/** Shows the window on Gemini so the user can sign in (once). */
export async function showGeminiWindow(): Promise<void> {
  const w = ensureWin()
  w.show()
  w.focus()
  await w.loadURL(GEMINI_APP_URL).catch(() => undefined)
}

class WcDrv implements Drv {
  constructor(private wc: Electron.WebContents) {}
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.wc.debugger.sendCommand(method, params) as Promise<T>
  }
  async eval<T = unknown>(expr: string): Promise<T> {
    const r = await this.send<{ result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'eval error')
    return r.result?.value as T
  }
  async close(): Promise<void> {
    try {
      if (this.wc.debugger.isAttached()) this.wc.debugger.detach()
    } catch {
      /* ignore */
    }
    if (!this.wc.isDestroyed()) await this.wc.loadURL('about:blank').catch(() => undefined)
  }
}

/** Loads the page in the hidden window and returns a CDP-like driver over it. */
export async function openInternal(url: string): Promise<Drv> {
  const w = ensureWin()
  const wc = w.webContents
  await w.loadURL(url).catch(() => undefined)
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  const d = new WcDrv(wc)
  await d.send('Runtime.enable')
  await d.send('Page.enable')
  // A hidden window has no real focus; emulate it so typing and key events reach the page.
  await d.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
  return d
}

/** Arms the next download (triggered by a click in the page) to be saved into `dir`. */
export function expectDownload(dir: string, ms: number): { promise: Promise<string>; cancel: () => void } {
  let timer: NodeJS.Timeout
  const promise = new Promise<string>((resolve, reject) => {
    pending = { dir, resolve, reject }
    timer = setTimeout(() => {
      pending = null
      reject(new Error('التنزيل ما خلص بالوقت المحدد'))
    }, ms)
  }).finally(() => clearTimeout(timer))
  return {
    promise,
    cancel: () => {
      clearTimeout(timer)
      pending = null
    }
  }
}
