// Sign-in state for the sites behind the image/video/audio buttons. Each site keeps its own login inside the app
// (Gemini in its own window session, the others in the side browser), so the user signs in once and can see / clear it here.
import { BrowserWindow, ipcMain, session } from 'electron'
import { GEMINI_PARTITION } from '../tools/gemini-internal'
import { openGeminiInChrome } from '../tools/google-media-tools'
import { readJson, writeJson } from '../core/json-store'

// Manual corrections: when the automatic check is wrong for a site, the user marks the real state and it wins until cleared.
const MARKS_FILE = 'media-account-marks.json'
const marks = (): Record<string, 'yes' | 'no'> => readJson<Record<string, 'yes' | 'no'>>(MARKS_FILE, {})

const SIDE = 'persist:side-browser'
interface Acc { id: string; label: string; url: string; partition: string; domains: string[]; auth?: RegExp }
const ACCS: Acc[] = [
  { id: 'gemini', label: 'Gemini (Google)', url: 'https://gemini.google.com/app', partition: GEMINI_PARTITION, domains: ['google.com'], auth: /^(__Secure-1PSID|SID)$/ },
  { id: 'leonardo', label: 'Leonardo.ai', url: 'https://app.leonardo.ai/', partition: SIDE, domains: ['leonardo.ai'] },
  { id: 'ideogram', label: 'Ideogram', url: 'https://ideogram.ai/', partition: SIDE, domains: ['ideogram.ai'] },
  { id: 'designer', label: 'Microsoft Designer', url: 'https://designer.microsoft.com/', partition: SIDE, domains: ['microsoft.com', 'live.com', 'microsoftonline.com'] },
  { id: 'canva', label: 'Canva', url: 'https://www.canva.com/', partition: SIDE, domains: ['canva.com'] },
  { id: 'morphic', label: 'Morphic', url: 'https://morphic.com/', partition: SIDE, domains: ['morphic.com', 'morphic.sh'] }
]

const hit = (cookieDomain: string, acc: Acc): boolean => {
  const d = cookieDomain.replace(/^\./, '').toLowerCase()
  return acc.domains.some((x) => d === x || d.endsWith('.' + x))
}

async function cookiesOf(acc: Acc): Promise<Electron.Cookie[]> {
  const all = await session.fromPartition(acc.partition).cookies.get({})
  return all.filter((c) => hit(c.domain ?? '', acc))
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Runs inside the page: is it asking us to sign in? Public pages show "Log in / Sign up" links (sometimes hidden in a collapsed menu),
// signed-in pages don't, so any such link counts, visible or not.
const PAGE_CHECK = `(() => {
  const url = location.href
  const title = document.title || ''
  const vis = (e) => !!(e.offsetParent || e.getClientRects().length)
  const challenge = /just a moment|attention required|verify you are human|access denied/i.test(title)
  const loginUrl = /accounts\\.google\\.com|login\\.(live|microsoftonline)\\.com|[/.](log-?in|sign-?in|sign-?up|auth)([/?#]|$)/i.test(url)
  const pass = [...document.querySelectorAll('input[type=password]')].some(vis)
  const ctl = [...document.querySelectorAll('a,button,[role=button]')].some((e) => {
    const t = (e.textContent || '').trim()
    const h = e.getAttribute('href') || ''
    return (t.length <= 30 && /^(log ?in|sign ?in|sign ?up|create (a )?free account|get started|continue with (google|email|microsoft)|تسجيل الدخول)/i.test(t)) || /\\/(log-?in|sign-?in)\\b/i.test(h)
  })
  return { url, challenge, loginUrl, pass, ctl, len: (document.body && document.body.innerText || '').length }
})()`

interface PageInfo { challenge: boolean; loginUrl: boolean; pass: boolean; ctl: boolean; len: number }

/** Loads the site in a hidden window on the same session and decides from what the page itself shows. */
async function probe(a: Acc): Promise<'yes' | 'no' | 'unknown'> {
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: a.partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  const wc = w.webContents
  try {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const loaded = new Promise<void>((res) => {
      wc.once('did-finish-load', () => res())
      wc.once('did-fail-load', (_e, _c, _d, _u, main) => { if (main) res() })
    })
    void w.loadURL(a.url).catch(() => undefined)
    await Promise.race([loaded, sleep(15000)])
    // executeJavaScript can stall on pages that never finish loading, so the page is read through the debugger instead.
    wc.debugger.attach('1.3')
    let calm = 0
    for (let i = 0; i < 7; i++) {
      await sleep(3000) // single-page apps draw their buttons late
      const res = (await Promise.race([
        wc.debugger.sendCommand('Runtime.evaluate', { expression: PAGE_CHECK, returnByValue: true }),
        sleep(8000).then(() => null)
      ]).catch(() => null)) as { result?: { value?: PageInfo } } | null
      const r = res?.result?.value
      if (!r || r.challenge) continue
      if (r.loginUrl || r.pass || r.ctl) return 'no'
      calm = r.len >= 200 ? calm + 1 : 0
      if (calm >= 4) return 'yes' // a login link can appear late, so a clean page must stay clean for ~12s
    }
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    try { if (wc.debugger.isAttached()) wc.debugger.detach() } catch { /* ignore */ }
    if (!w.isDestroyed()) w.destroy()
  }
}
const find = (id: unknown): Acc | undefined => (typeof id === 'string' ? ACCS.find((x) => x.id === id) : undefined)

export function registerMediaAccountsIpc(): void {
  ipcMain.handle('media:accounts', async () => {
    const out: { id: string; label: string; url: string; state: 'yes' | 'maybe' | 'no' | 'unknown'; where: string; manual: boolean }[] = []
    const mk = marks()
    for (const a of ACCS) {
      let state: 'yes' | 'maybe' | 'no' | 'unknown' = 'no'
      try {
        const cs = await cookiesOf(a)
        // Google has a definite sign-in cookie; for the others a few cookies is only a hint.
        if (a.auth) state = cs.some((c) => a.auth!.test(c.name)) ? 'yes' : a.id === 'gemini' ? 'unknown' : 'no'
        else state = cs.length >= 3 ? 'maybe' : 'no'
      } catch { /* keep "no" */ }
      const manual = !!mk[a.id] && a.id !== 'gemini'
      if (manual) state = mk[a.id]
      out.push({ id: a.id, label: a.label, url: a.url, state, manual, where: a.id === 'gemini' ? 'بيسجّل دخول من Chrome المخصص (Google بيرفض النافذة المدمجة)، فالحالة ما بتنفحص' : 'المتصفح الجانبي' })
    }
    return out
  })
  /** Real check: Google by its sign-in cookie, the other sites by loading them and looking at the page. */
  ipcMain.handle('media:account-verify', async (_e, id: unknown) => {
    const a = find(id)
    if (!a) return 'unknown'
    if (a.auth) return (await cookiesOf(a)).some((c) => a.auth!.test(c.name)) ? 'yes' : a.id === 'gemini' ? 'unknown' : 'no'
    const m = marks()[a.id]
    if (m) return m
    return probe(a)
  })
  /** state = the real state the user sees; null clears the correction and goes back to the automatic check. */
  ipcMain.handle('media:account-mark', (_e, id: unknown, state: unknown) => {
    const a = find(id)
    if (!a || a.id === 'gemini') return false
    const mk = marks()
    if (state === 'yes' || state === 'no') mk[a.id] = state
    else delete mk[a.id]
    writeJson(MARKS_FILE, mk)
    return true
  })
  /** Gemini shows its own window and returns null; the others return the URL for the renderer to open in the side browser. */
  ipcMain.handle('media:account-login', async (_e, id: unknown) => {
    const a = find(id)
    if (!a) return null
    if (a.id === 'gemini') {
      await openGeminiInChrome()
      return null
    }
    return a.url
  })
  ipcMain.handle('media:account-logout', async (_e, id: unknown) => {
    const a = find(id)
    if (!a) return false
    const mk0 = marks()
    if (mk0[a.id]) { delete mk0[a.id]; writeJson(MARKS_FILE, mk0) }
    const ses = session.fromPartition(a.partition)
    for (const c of await cookiesOf(a)) {
      const host = (c.domain ?? '').replace(/^\./, '')
      try { await ses.cookies.remove((c.secure ? 'https' : 'http') + '://' + host + (c.path || '/'), c.name) } catch { /* ignore */ }
    }
    for (const d of a.domains) {
      for (const o of ['https://' + d, 'https://www.' + d]) {
        try { await ses.clearStorageData({ origin: o }) } catch { /* ignore */ }
      }
    }
    return true
  })
}