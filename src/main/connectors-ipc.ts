import { app, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getAccounts, setConnected, setWriteServer } from '../core/accounts'
import { loadMCPConfig, saveMCPConfig, testMCPServer, type MCPServer } from '../mcp/client'
import { callMcpTool, listMcpTools, mcpStatus, resetMcp } from '../mcp/runtime'
import { findOnPath } from '../core/platform'

// Connector registry. Every card in Settings > Connectors comes from here.
//  remote  : official hosted MCP through mcp-remote (OAuth sign-in happens in the browser, no app registration)
//  local   : a tool that uses the sign-in already present on this machine (no login step)
//  special : custom sign-in flow (github via gh CLI, ms365 device code)
type Group = 'accounts' | 'device'
type Def = {
  id: string
  title: string
  subtitle: string
  group: Group
  kind: 'remote' | 'local' | 'special' | 'token'
  hint: string
  build?: (vals: string[]) => string[] // token kind: optional builder for the server args from the pasted values
  fields?: { env: string; label: string }[] // token kind: values the user pastes once (stored in the MCP config only)
  requires?: string // command that must exist on PATH
  requiresFile?: () => string | null // returns a missing-path message, or null when fine
  server: () => MCPServer
}

const npx = (id: string, args: string[]): MCPServer => ({ name: id, command: 'npx', args: ['-y', ...args], env: {}, enabled: true })
const remote = (id: string, url: string): MCPServer => npx(id, ['mcp-remote', url])
const home = os.homedir()
const gcloudBundle = process.platform !== 'win32' ? '' : path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@google-cloud', 'gcloud-mcp', 'dist', 'bundle.js')
const terraformExe = process.platform === 'win32'
  ? path.join(home, 'Documents', 'mcp-servers', 'terraform-mcp-server', 'terraform-mcp-server.exe')
  : (findOnPath('terraform-mcp-server') ?? path.join(home, '.local', 'bin', 'terraform-mcp-server'))

// Windows keeps the original fixed folders; elsewhere use the OS-localized ones that actually exist (fallback: home).
function fsRoots(): string[] {
  if (process.platform === 'win32') return [path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Downloads')]
  const out: string[] = []
  for (const n of ['documents', 'desktop', 'downloads'] as const) {
    try {
      const p = app.getPath(n)
      if (fs.existsSync(p) && !out.includes(p)) out.push(p)
    } catch {
      /* ignore */
    }
  }
  return out.length ? out : [home]
}

const DEFS: Def[] = [
  { id: 'github', title: 'GitHub', subtitle: 'مستودعات • Issues • Pull requests • ملفات', group: 'device', kind: 'special',
    hint: 'بيستعمل حساب GitHub المسجّل بالجهاز (gh). إذا ما كنت مسجّل، رح يطلع كود وبتنفتح صفحة GitHub.', server: () => npx('github', ['@modelcontextprotocol/server-github']) },
  { id: 'gcloud', title: 'Google Cloud', subtitle: 'مشاريع • موارد • IAM • logs (عبر gcloud المسجّل بالجهاز)', group: 'device', kind: 'local', requires: 'gcloud',
    hint: 'بيستعمل تسجيل دخول gcloud الموجود بجهازك، بدون خطوات إضافية.',
    server: () => (gcloudBundle && fs.existsSync(gcloudBundle) ? { name: 'gcloud', command: 'node', args: [gcloudBundle], env: {}, enabled: true } : npx('gcloud', ['@google-cloud/gcloud-mcp'])) },
  { id: 'terraform', title: 'Terraform', subtitle: 'بحث وثائق ومزودين ووحدات Registry', group: 'device', kind: 'local',
    requiresFile: () => (fs.existsSync(terraformExe) ? null : 'ما لقيت terraform-mcp-server (حطو بمجلد mcp-servers أو على PATH).'),
    hint: 'أداة محلية، بدون تسجيل دخول.', server: () => ({ name: 'terraform', command: terraformExe, args: ['stdio'], env: {}, enabled: true }) },
  { id: 'kubernetes', title: 'Kubernetes', subtitle: 'clusters • pods • logs (عبر kubeconfig الموجود)', group: 'device', kind: 'local', requires: 'kubectl',
    hint: 'بيستعمل kubectl والـ kubeconfig الموجود بجهازك.', server: () => npx('kubernetes', ['mcp-server-kubernetes']) },
  { id: 'ms365', title: 'Microsoft 365', subtitle: 'Outlook • Calendar • OneDrive • To Do • Excel • OneNote', group: 'accounts', kind: 'special',
    hint: 'رح تظهر كود وبتنفتح صفحة Microsoft (أول مرة بتتأخر شوي).', server: () => npx('ms365', ['@softeria/ms-365-mcp-server']) },
  { id: 'canva', title: 'Canva', subtitle: 'تصاميم وعروض ومجلدات', group: 'accounts', kind: 'remote',
    hint: 'انفتحت صفحة Canva بالمتصفح: سجّل الدخول ووافق (أول مرة بتتأخر شوي).', server: () => remote('canva', 'https://mcp.canva.com/mcp') },
  { id: 'miro', title: 'Miro', subtitle: 'بوردات • خرائط ذهنية • مخططات', group: 'accounts', kind: 'remote',
    hint: 'بتفتح صفحة Miro: سجّل الدخول واختار الـ Team اللي فيه البوردات.', server: () => remote('miro', 'https://mcp.miro.com/') },
  { id: 'notion', title: 'Notion', subtitle: 'صفحات • قواعد بيانات • وثائق', group: 'accounts', kind: 'remote',
    hint: 'بتفتح صفحة Notion: سجّل الدخول واختار الصفحات المسموحة.', server: () => remote('notion', 'https://mcp.notion.com/mcp') },
  { id: 'linear', title: 'Linear', subtitle: 'Issues • مشاريع • Cycles', group: 'accounts', kind: 'remote',
    hint: 'بتفتح صفحة Linear: سجّل الدخول ووافق.', server: () => remote('linear', 'https://mcp.linear.app/mcp') },
  { id: 'cloudflare', title: 'Cloudflare', subtitle: 'كامل Cloudflare API: DNS • Workers • Zero Trust • logs', group: 'accounts', kind: 'remote',
    hint: 'بتفتح صفحة Cloudflare: سجّل الدخول واختار الحساب والصلاحيات.', server: () => remote('cloudflare', 'https://mcp.cloudflare.com/mcp') },
  { id: 'dropbox', title: 'Dropbox', subtitle: 'ملفات ومجلدات ومشاركة', group: 'accounts', kind: 'remote',
    hint: 'بتفتح صفحة Dropbox: سجّل الدخول ووافق. (تجريبي: Dropbox بتدعم التسجيل التلقائي لعملاء معينين، وإذا رفضت بنعمل إعداد يدوي.)', server: () => remote('dropbox', 'https://mcp.dropbox.com/mcp') },
  { id: 'browseruse', title: 'Browser Use', subtitle: 'أتمتة متصفح سحابي: تنفيذ مهام ويب وجلسات', group: 'accounts', kind: 'token',
    fields: [ { env: 'BROWSER_USE_API_KEY', label: 'API key' } ],
    hint: 'من cloud.browser-use.com/settings انسخ الـ API key والصقه هون.',
    server: () => npx('browseruse', ['mcp-remote', 'https://api.browser-use.com/v3/mcp', '--header', 'x-browser-use-api-key:${BROWSER_USE_API_KEY}']) },
  { id: 'deepgram', title: 'Deepgram', subtitle: 'تفريغ صوت وتحليله (Speech-to-Text)', group: 'accounts', kind: 'token',
    fields: [ { env: 'DEEPGRAM_API_KEY', label: 'API key' } ],
    hint: 'من console.deepgram.com اعمل API key والصقه هون. بيشتغل عبر uvx (deepgram-mcp).',
    server: () => ({ name: 'deepgram', command: 'uvx', args: ['--with', 'mcp<2', 'deepgram-mcp'], env: {}, enabled: true }) },
  { id: 'assemblyai', title: 'AssemblyAI', subtitle: 'بحث بوثائق AssemblyAI (بدون تسجيل دخول)', group: 'accounts', kind: 'remote',
    hint: 'سيرفر الوثائق الرسمي: بدون تسجيل دخول. للتفريغ الفعلي بتستعمل Deepgram أو API مباشر.',
    server: () => remote('assemblyai', 'https://mcp.assemblyai.com/docs') },
  { id: 'desktopcommander', title: 'Desktop Commander', subtitle: 'ترمنال وعمليات وتعديل ملفات على الجهاز', group: 'device', kind: 'local',
    hint: 'أداة محلية بدون تسجيل. أدوات الكتابة والتشغيل مخفية إلا إذا فعّلت «السماح بالكتابة» وبتطلب موافقتك كل مرة.',
    server: () => npx('desktopcommander', ['@wonderwhy-er/desktop-commander@latest']) },
  { id: 'filesystem', title: 'Filesystem', subtitle: 'قراءة وكتابة ملفات بمجلدات Documents وDesktop وDownloads', group: 'device', kind: 'local',
    hint: 'محصور بالمجلدات: Documents وDesktop وDownloads. الحذف ممنوع دايماً.',
    server: () => npx('filesystem', ['@modelcontextprotocol/server-filesystem', ...fsRoots()]) },
]
const byId = (id: unknown): Def | undefined => (typeof id === 'string' ? DEFS.find((d) => d.id === id) : undefined)

const onPath = (cmd: string): Promise<boolean> =>
  new Promise((resolve) => {
    const c = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], { shell: process.platform === 'win32', windowsHide: true, stdio: 'ignore' })
    c.on('error', () => resolve(false))
    c.on('exit', (code) => resolve(code === 0))
  })

async function missing(d: Def): Promise<string | null> {
  if (d.requires && !(await onPath(d.requires))) return `${d.requires} مش مثبّت أو مو بالـ PATH.`
  return d.requiresFile?.() ?? null
}

async function ensureServer(d: Def, enable = true): Promise<MCPServer> {
  const cfg = await loadMCPConfig()
  let s = cfg.servers.find((x) => x.name === d.id)
  if (!s) {
    s = d.server()
    cfg.servers.push(s)
    await saveMCPConfig(cfg)
  } else if (enable && s.enabled === false) {
    s.enabled = true
    await saveMCPConfig(cfg)
  }
  return s
}

async function disableServer(id: string): Promise<void> {
  const cfg = await loadMCPConfig()
  const s = cfg.servers.find((x) => x.name === id)
  if (s && s.enabled !== false) {
    s.enabled = false
    await saveMCPConfig(cfg)
  }
}

async function setServerArgs(id: string, args: string[]): Promise<void> {
  const cfg = await loadMCPConfig()
  const s = cfg.servers.find((x) => x.name === id)
  if (!s) return
  s.args = args
  await saveMCPConfig(cfg)
}

async function setServerEnv(id: string, env: Record<string, string> | null): Promise<void> {
  const cfg = await loadMCPConfig()
  const s = cfg.servers.find((x) => x.name === id)
  if (!s) return
  s.env = env ? { ...(s.env ?? {}), ...env } : {}
  await saveMCPConfig(cfg)
}

type Reply = { ok: boolean; message: string }

// GitHub sign-in goes through the GitHub CLI (already logged in on this machine, or a browser device-code login).
// The token is read in the main process and written to the MCP config only; the UI never sees it.
function runGh(args: string[], onData?: (s: string, stdin: NodeJS.WritableStream) => void, timeoutMs = 120000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32'
    let out = ''
    const child = spawn('gh', args, { shell: win, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const feed = (d: Buffer): void => {
      out += d.toString()
      onData?.(out, child.stdin)
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.stdin.on('error', () => undefined)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, out })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}

async function githubToken(send: (code: string, url: string) => void): Promise<{ token?: string; error?: string }> {
  const get = async (): Promise<string> => {
    const r = await runGh(['auth', 'token'], undefined, 20000)
    return r.code === 0 ? r.out.trim().split(/\s+/)[0] : ''
  }
  let t = await get()
  if (t) return { token: t }
  let sent = false
  const r = await runGh(
    ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--scopes', 'repo,read:org,gist'],
    (out, stdin) => {
      if (/Press Enter/i.test(out)) stdin.write('\n')
      const code = out.match(/code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1]
      if (code && !sent) {
        sent = true
        send(code, 'https://github.com/login/device')
      }
    },
    5 * 60 * 1000
  )
  if (r.code === -1) return { error: 'GitHub CLI (gh) مش مثبّت. ثبّته من cli.github.com وبعدين جرّب.' }
  t = await get()
  return t ? { token: t } : { error: r.out.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200) || 'فشل تسجيل الدخول.' }
}

// Runs the Microsoft device-code sign-in; forwards the code to the UI and opens the login page.
function microsoftLogin(send: (code: string, url: string) => void, flag: '--login' | '--logout'): Promise<Reply> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32'
    const child = spawn('npx', ['-y', '@softeria/ms-365-mcp-server', flag], { shell: win, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let sent = false
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, message: 'انتهت المهلة قبل ما يكتمل تسجيل الدخول. جرّب تاني.' })
    }, 5 * 60 * 1000)
    const feed = (d: Buffer): void => {
      out += d.toString()
      if (sent || flag !== '--login') return
      const url = out.match(/https:\/\/[^\s]*microsoft\.com\/[^\s]*devicelogin[^\s]*/i)?.[0]
      const code = out.match(/code\s+([A-Z0-9]{6,12})\b/)?.[1]
      if (url && code) {
        sent = true
        send(code, url)
        void shell.openExternal(url)
      }
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, message: e.message })
    })
    child.on('exit', (c) => {
      clearTimeout(timer)
      const tail = out.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 240)
      resolve(c === 0 ? { ok: true, message: flag === '--login' ? 'اتصلنا.' : 'انفصل.' } : { ok: false, message: tail || 'فشل تسجيل الدخول.' })
    })
  })
}

export function registerConnectorsHandlers(): void {
  ipcMain.handle('connectors:list', async () => {
    const a = getAccounts()
    return Promise.all(
      DEFS.map(async (d) => ({
        id: d.id,
        title: d.title,
        subtitle: d.subtitle,
        group: d.group,
        kind: d.kind,
        hint: d.hint,
        fields: d.fields?.map((f) => f.label),
        connected: a.connected.includes(d.id),
        write: a.writeServers.includes(d.id),
        unavailable: await missing(d)
      }))
    )
  })

  // token kind: store the pasted values in the MCP config (never returned to the UI), then connect.
  ipcMain.handle('connectors:setup', async (_e, id: unknown, values: unknown): Promise<Reply> => {
    const d = byId(id)
    if (!d || d.kind !== 'token' || !d.fields || !Array.isArray(values)) return { ok: false, message: 'طلب مو صالح' }
    const vals = values.map((v) => (typeof v === 'string' ? v.trim() : ''))
    if (vals.length !== d.fields.length || vals.some((v) => v.length < 4)) return { ok: false, message: 'عبّي كل الحقول.' }
    await ensureServer(d)
    await setServerEnv(d.id, Object.fromEntries(d.fields.map((f, i) => [f.env, vals[i]])))
    if (d.build) await setServerArgs(d.id, d.build(vals))
    resetMcp()
    const s = await ensureServer(d)
    const r = await testMCPServer(s, d.build ? 180000 : 90000)
    if (r.ok) setConnected(d.id, true)
    return r.ok ? { ok: true, message: 'اتصلنا بـ ' + d.title + '.' } : { ok: false, message: r.message.slice(0, 240) }
  })

  ipcMain.handle('connectors:connect', async (e, id: unknown): Promise<Reply> => {
    const d = byId(id)
    if (!d) return { ok: false, message: 'خدمة مو معروفة' }
    try {
      const miss = await missing(d)
      if (miss) return { ok: false, message: miss }
      if (d.kind === 'token') {
        const cur = (await loadMCPConfig()).servers.find((x) => x.name === d.id)
        if (!d.fields?.every((f) => cur?.env?.[f.env])) return { ok: false, message: 'الصق القيم المطلوبة أول ودوس «حفظ واتصال».' }
      }
      const s = await ensureServer(d)
      const send = (code: string, url: string): void => e.sender.send('connectors:code', d.id, code, url)
      if (d.id === 'github') {
        const g = await githubToken(send)
        if (!g.token) return { ok: false, message: g.error ?? 'فشل.' }
        await setServerEnv(d.id, { GITHUB_PERSONAL_ACCESS_TOKEN: g.token })
        setConnected(d.id, true)
        resetMcp()
        return { ok: true, message: 'اتصلنا بـ GitHub.' }
      }
      if (d.id === 'ms365') {
        const r = await microsoftLogin(send, '--login')
        if (r.ok) setConnected(d.id, true)
        resetMcp()
        return r
      }
      // remote: mcp-remote opens the sign-in page itself and the handshake finishes once the user approves.
      // local : plain handshake, nothing to sign in to.
      const r = await testMCPServer(s, d.kind === 'remote' || d.build ? 180000 : 90000)
      if (!r.ok && d.kind === 'token') setConnected(d.id, false)
      if (r.ok) setConnected(d.id, true)
      resetMcp()
      return r.ok ? { ok: true, message: `اتصلنا بـ ${d.title}.` } : { ok: false, message: r.message.slice(0, 240) }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  // Live view for the chat status bar: enabled MCP servers, whether their process is up, and how many tools they expose (no process is started here).
  ipcMain.handle('connectors:active', async (_e, load?: unknown) => {
    if (load === true) await listMcpTools() // starts the enabled servers (same as the first tool request in a chat)
    return (await mcpStatus()).map((s) => ({ ...s, title: byId(s.id)?.title ?? s.id }))
  })

  ipcMain.handle('app:about', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform + ' ' + process.arch
  }))

  ipcMain.handle('connectors:test', async (_e, id: unknown): Promise<Reply> => {
    const d = byId(id)
    if (!d) return { ok: false, message: 'خدمة مو معروفة' }
    try {
      await ensureServer(d)
      const tools = (await listMcpTools()).filter((t) => t.server === d.id)
      if (!tools.length) {
        setConnected(d.id, false)
        return { ok: false, message: 'ما في أدوات. دوس اتصل.' }
      }
      if (d.id === 'ms365') {
        const v = tools.find((t) => /verify.?login/i.test(t.name))
        if (v) {
          const out = await callMcpTool(v, {}, { noReauth: true })
          const good = !out.startsWith('Error') && /success|logged in|authenticated|displayName|userPrincipalName/i.test(out) && !/not (logged|authenticated)|no (account|token)/i.test(out)
          setConnected(d.id, good)
          return { ok: good, message: good ? 'الاتصال شغال.' : 'مش متصل. دوس اتصل.' }
        }
      }
      setConnected(d.id, true)
      return { ok: true, message: `الاتصال شغال (${tools.length} أداة).` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('connectors:disconnect', async (e, id: unknown): Promise<Reply> => {
    const d = byId(id)
    if (!d) return { ok: false, message: 'خدمة مو معروفة' }
    setConnected(d.id, false)
    setWriteServer(d.id, false)
    resetMcp()
    if (d.id === 'github') await setServerEnv(d.id, null)
    if (d.id === 'ms365') await microsoftLogin((c, u) => e.sender.send('connectors:code', d.id, c, u), '--logout')
    await disableServer(d.id)
    return { ok: true, message: d.kind === 'remote' ? 'انفصل من التطبيق. (لو بدك تلغي الصلاحية كلياً، ألغيها من إعدادات حسابك عند الخدمة.)' : 'انفصل.' }
  })
}
