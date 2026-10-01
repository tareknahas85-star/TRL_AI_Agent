import { ipcMain, shell } from 'electron'
import { getAccounts, setGoogleEmail, setWriteServer } from '../core/accounts'
import { callMcpTool, listMcpTools } from '../mcp/runtime'

const GOOGLE = 'google-workspace'
const AUTH_URL = /https:\/\/accounts\.google\.com\/[^\s)>\]"']+/

async function googleTool(name: string) {
  const tools = await listMcpTools()
  return tools.find((t) => t.server === GOOGLE && t.name === name)
}

export function registerAccountsHandlers(): void {
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
      const out = await callMcpTool(t, args)
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
