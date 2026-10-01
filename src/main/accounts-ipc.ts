import { ipcMain, shell } from 'electron'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { getAccounts, setGoogleEmail, setWriteServer } from '../core/accounts'
import { callMcpTool, listMcpTools, resetMcp } from '../mcp/runtime'
import { loadMCPConfig, saveMCPConfig } from '../mcp/client'

const GOOGLE = 'google-workspace'
const AUTH_URL = /https:\/\/accounts\.google\.com\/[^\s)>\]"']+/

async function googleTool(name: string) {
  const tools = await listMcpTools()
  return tools.find((t) => t.server === GOOGLE && t.name === name)
}

const CLIENT_ID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/

export function registerAccountsHandlers(): void {
  // One-time Google app credentials: stored in the MCP config only, never returned to the UI.
  ipcMain.handle('accounts:googleCreds', async () => {
    const s = (await loadMCPConfig()).servers.find((x) => x.name === GOOGLE)
    const id = s?.env?.GOOGLE_OAUTH_CLIENT_ID ?? ''
    return { hasCreds: CLIENT_ID_RE.test(id) && !!s?.env?.GOOGLE_OAUTH_CLIENT_SECRET, clientTail: id ? id.slice(0, 10) + '…' : '' }
  })
  ipcMain.handle('accounts:googleSetup', async (_e, a: unknown, b: unknown) => {
    let id = typeof a === 'string' ? a.trim() : ''
    let secret = typeof b === 'string' ? b.trim() : ''
    if (id.startsWith('{')) {
      try {
        const j = JSON.parse(id)
        const o = j.installed ?? j.web ?? j
        id = String(o.client_id ?? '').trim()
        secret = String(o.client_secret ?? '').trim()
      } catch {
        return { ok: false, error: 'ملف JSON غير صالح' }
      }
    }
    if (!CLIENT_ID_RE.test(id)) return { ok: false, error: 'Client ID لازم ينتهي بـ .apps.googleusercontent.com' }
    if (secret.length < 10) return { ok: false, error: 'الـ Client secret ناقص' }
    const cfg = await loadMCPConfig()
    const env = { OAUTHLIB_INSECURE_TRANSPORT: '1' }
    const cur = cfg.servers.find((x) => x.name === GOOGLE)
    if (cur) {
      cur.env = { ...(cur.env ?? {}), ...env, GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret }
      cur.enabled = true
    } else {
      cfg.servers.push({ name: GOOGLE, command: 'uvx', args: ['workspace-mcp'], env: { ...env, GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret }, enabled: true })
    }
    await saveMCPConfig(cfg)
    resetMcp()
    return { ok: true }
  })
  // Disconnect = remove the saved sign-in token of this account (the app's own token file), then restart the server.
  ipcMain.handle('accounts:googleDisconnect', async () => {
    const email = getAccounts().googleEmail
    resetMcp()
    if (email) {
      const dir = path.join(os.homedir(), '.google_workspace_mcp', 'credentials')
      for (const f of [path.join(dir, email + '.json'), path.join(dir, email.toLowerCase() + '.json')]) await fs.rm(f, { force: true }).catch(() => undefined)
    }
    return { ok: true }
  })
  ipcMain.handle('accounts:get', () => getAccounts())
  ipcMain.handle('accounts:setEmail', (_e, v: unknown) => (typeof v === 'string' ? setGoogleEmail(v) : { ok: false, error: 'قيمة غير صالحة' }))
  ipcMain.handle('accounts:setWrite', (_e, server: unknown, on: unknown) =>
    typeof server === 'string' && typeof on === 'boolean' ? setWriteServer(server, on) : getAccounts().writeServers
  )

  // action: 'connect' opens the Google sign-in page in the browser (the user signs in there); 'test' checks the link.
  ipcMain.handle('accounts:google', async (_e, action: unknown) => {
    const email = getAccounts().googleEmail
    if (!email) return { ok: false, message: 'اكتب إيميل Google أول واحفظه.' }
    try {
      const wanted = action === 'connect' ? 'start_google_auth' : 'list_calendars'
      const t = await googleTool(wanted)
      if (!t) return { ok: false, message: `ما لقيت الأداة ${wanted}. تأكد إن سيرفر google-workspace شغال بصفحة MCP.` }
      const props = (t.schema?.properties ?? {}) as Record<string, unknown>
      const args: Record<string, unknown> = {}
      if ('user_google_email' in props) args.user_google_email = email
      if ('service_name' in props) args.service_name = 'Gmail'
      const out = await callMcpTool(t, args, { noReauth: true })
      const url = out.match(AUTH_URL)?.[0]
      if (action === 'connect') {
        if (url) {
          void shell.openExternal(url)
          return { ok: true, message: 'انفتح المتصفح: سجّل الدخول ووافق على الصلاحيات، وبعدها اكبس "اختبار".' }
        }
        return { ok: !out.startsWith('Error'), message: out.slice(0, 300) || 'تم.' }
      }
      if (url || /authenticat|authoriz|credentials/i.test(out.slice(0, 300))) {
        return { ok: false, message: 'غير متصل بعد. اكبس "اتصل" وسجّل الدخول.' }
      }
      if (out.startsWith('Error')) return { ok: false, message: out.slice(0, 300) }
      return { ok: true, message: 'الاتصال شغال.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
}
