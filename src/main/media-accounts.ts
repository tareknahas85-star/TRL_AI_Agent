// Sign-in state for the sites behind the image/video/audio buttons. Each site keeps its own login inside the app
// (Gemini in its own window session, the others in the side browser), so the user signs in once and can see / clear it here.
import { ipcMain, session } from 'electron'
import { GEMINI_PARTITION, showGeminiWindow } from '../tools/gemini-internal'

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

const find = (id: unknown): Acc | undefined => (typeof id === 'string' ? ACCS.find((x) => x.id === id) : undefined)

export function registerMediaAccountsIpc(): void {
  ipcMain.handle('media:accounts', async () => {
    const out: { id: string; label: string; url: string; state: 'yes' | 'maybe' | 'no'; where: string }[] = []
    for (const a of ACCS) {
      let state: 'yes' | 'maybe' | 'no' = 'no'
      try {
        const cs = await cookiesOf(a)
        // Google has a definite sign-in cookie; for the others a few cookies is only a hint.
        if (a.auth) state = cs.some((c) => a.auth!.test(c.name)) ? 'yes' : 'no'
        else state = cs.length >= 3 ? 'maybe' : 'no'
      } catch { /* keep "no" */ }
      out.push({ id: a.id, label: a.label, url: a.url, state, where: a.partition === SIDE ? 'المتصفح الجانبي' : 'نافذة Gemini الداخلية' })
    }
    return out
  })
  /** Gemini shows its own window and returns null; the others return the URL for the renderer to open in the side browser. */
  ipcMain.handle('media:account-login', async (_e, id: unknown) => {
    const a = find(id)
    if (!a) return null
    if (a.id === 'gemini') {
      await showGeminiWindow()
      return null
    }
    return a.url
  })
  ipcMain.handle('media:account-logout', async (_e, id: unknown) => {
    const a = find(id)
    if (!a) return false
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