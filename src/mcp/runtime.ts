import { setComputerBase } from '../computer/pathbase'
import { addComputerTools, computerEnabled } from '../computer/control'
import { currentSignal } from '../core/progress'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import type OpenAI from 'openai'
import { listSkills, loadSkill } from '../skills/loader'
import { loadMCPConfig, type MCPServer } from './client'
import { readFile, listFiles } from '../tools/file-tools'
import { readState } from '../core/state'
import { approveNewTool, approveWrite, getAccounts } from '../core/accounts'
import { fenceUntrusted } from '../core/untrusted'
import { shell } from 'electron'
import { addPlaceTools } from '../tools/place-tools'
import { getPrefs } from '../core/prefs'
import { needsDocTools, needsLocation, needsSecurity } from '../core/guidance'
import { addDocTools } from '../tools/doc-tools'
import { addSecurityTools } from '../tools/security-tools'
import { addSandboxTools, needsSandbox } from '../tools/sandbox-tools'
import { toolPrior } from '../core/learning'
import { neededConnectors } from '../core/connector-hints'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

class Conn {
  private child: ChildProcessWithoutNullStreams
  private buf = ''
  private id = 0
  private pending = new Map<number, Pending>()
  dead = false

  constructor(server: MCPServer, onExit: () => void) {
    const win = process.platform === 'win32'
    const q = (v: string): string => (win && /[\s&()^%!<>|]/.test(v) && !/^".*"$/.test(v) ? `"${v}"` : v)
    this.child = spawn(q(server.command), (server.args ?? []).map(q), {
      env: { ...process.env, ...(server.env ?? {}) },
      shell: win,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const fail = (e: Error): void => {
      this.dead = true
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(e)
      }
      this.pending.clear()
      onExit()
    }
    this.child.on('error', (e) => fail(e))
    this.child.on('exit', () => fail(new Error('MCP server exited')))
    this.child.stderr.on('data', () => undefined)
    this.child.stdin.on('error', () => undefined)
    this.child.stdout.on('data', (d) => {
      this.buf += d.toString()
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined
          if (!p) continue
          this.pending.delete(msg.id)
          clearTimeout(p.timer)
          if (msg.error) p.reject(new Error(msg.error.message ?? 'MCP error'))
          else p.resolve(msg.result)
        } catch {
          /* non-JSON line */
        }
      }
    })
  }

  request(method: string, params: unknown, ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('MCP connection closed'))
      const id = ++this.id
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP timeout: ${method}`))
      }, ms)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  notify(method: string): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  }

  kill(): void {
    this.dead = true
    try {
      if (process.platform === 'win32' && this.child.pid) {
        spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true })
      } else this.child.kill()
    } catch {
      /* ignore */
    }
  }
}

const pool = new Map<string, Promise<Conn>>()

function getConn(server: MCPServer): Promise<Conn> {
  const existing = pool.get(server.name)
  if (existing) return existing
  const p = (async () => {
    const c = new Conn(server, () => pool.delete(server.name))
    try {
      await c.request(
        'initialize',
        { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ai-router-os', version: '1.0.0' } },
        60000
      )
      c.notify('notifications/initialized')
      return c
    } catch (e) {
      c.kill()
      pool.delete(server.name)
      throw e
    }
  })()
  pool.set(server.name, p)
  p.catch(() => pool.delete(server.name))
  return p
}

export type McpToolInfo = { fullName: string; server: string; name: string; description: string; schema: any }
// Per-server cache: a server that failed to answer (cold start under load) is NOT cached, so the next call retries it.
const toolCache = new Map<string, { at: number; tools: McpToolInfo[] }>()
const TTL = 10 * 60 * 1000
// A failed server is not retried for a while, and one request never waits more than WAIT_MS for cold starters (they keep starting in the background).
const failedAt = new Map<string, number>()
const FAIL_TTL = 5 * 60 * 1000
const WAIT_MS = 15000

const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_')

export async function listMcpTools(): Promise<McpToolInfo[]> {
  const cfg = await loadMCPConfig()
  const active = cfg.servers.filter((s) => s.enabled !== false)
  const stale = active.filter((s) => {
    const hit = toolCache.get(s.name)
    if (hit && Date.now() - hit.at <= TTL) return false
    const f = failedAt.get(s.name)
    return !(f && Date.now() - f < FAIL_TTL)
  })
  if (stale.length) {
    const work = Promise.all(
      stale.map(async (s) => {
        try {
          const c = await getConn(s)
          const r = await c.request('tools/list', {}, 60000)
          const mapped = ((r?.tools ?? []) as any[]).map(
            (t): McpToolInfo => ({
              fullName: `${safe(s.name)}__${safe(String(t.name))}`.slice(0, 64),
              server: s.name,
              name: String(t.name),
              description: String(t.description ?? ''),
              schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }
            })
          )
          toolCache.set(s.name, { at: Date.now(), tools: mapped })
          failedAt.delete(s.name)
        } catch (e) {
          failedAt.set(s.name, Date.now())
          console.warn('[MCP] tools/list failed for', s.name, e instanceof Error ? e.message : e)
        }
      })
    )
    await Promise.race([work, new Promise((r) => setTimeout(r, WAIT_MS))])
  }
  return active.flatMap((s) => toolCache.get(s.name)?.tools ?? [])
}

const GOOGLE_AUTH = /https:\/\/accounts\.google\.com\/o\/oauth2[^\s)>\]"']+/
let lastReauth = 0

export async function callMcpTool(info: McpToolInfo, args: Record<string, unknown>, opts?: { noReauth?: boolean }): Promise<string> {
  const cfg = await loadMCPConfig()
  const server = cfg.servers.find((s) => s.name === info.server && s.enabled !== false)
  if (!server) return 'Error: MCP server is disabled or removed'
  try {
    const c = await getConn(server)
    const r = await c.request('tools/call', { name: info.name, arguments: args }, 60000)
    const text = ((r?.content ?? []) as any[])
      .map((x) => (x?.type === 'text' ? String(x.text) : `[${x?.type ?? 'content'}]`))
      .join('\n')
    // Expired Google sign-in: open the login page for the user instead of failing silently (at most once per 3 minutes).
    if (!opts?.noReauth && info.server === 'google-workspace') {
      const url = text.match(GOOGLE_AUTH)?.[0]
      if (url) {
        if (Date.now() - lastReauth > 3 * 60 * 1000) {
          lastReauth = Date.now()
          void shell.openExternal(url)
        }
        return 'Error: Google sign-in has expired. A login page was opened in the user\'s browser. Tell the user to sign in there, then ask again. Do not retry now.'
      }
    }
    return (r?.isError ? 'Error: ' : '') + text
  } catch (e) {
    return 'Error: ' + (e instanceof Error ? e.message : String(e))
  }
}

export function resetMcp(): void {
  closeAllMcp()
  toolCache.clear()
}

export async function mcpStatus(): Promise<{ id: string; prefix: string; running: boolean; tools: number; names: string[] }[]> {
  const cfg = await loadMCPConfig()
  return cfg.servers
    .filter((s) => s.enabled !== false)
    .map((s) => {
      const hit = toolCache.get(s.name)
      return { id: s.name, prefix: safe(s.name) + '__', running: pool.has(s.name), tools: hit?.tools.length ?? 0, names: (hit?.tools ?? []).map((t) => t.name) }
    })
}

export function closeAllMcp(): void {
  for (const p of pool.values()) p.then((c) => c.kill()).catch(() => undefined)
  pool.clear()
}

export type Toolset = {
  defs: OpenAI.Chat.ChatCompletionTool[]
  call: (name: string, args: Record<string, unknown>) => Promise<string>
  // Why some capabilities are missing this turn (shown to the model and, if it pretends, to the user).
  notes: string[]
}

const MAX_MCP = 12
// Permanent deletion is never offered to the model, even when write access is on.
const HARD_BLOCK = /(delete|purge|empty[_-]?trash)/i
// Arabic request words -> English tool keywords, so Arabic requests can find English tool names.
const SYN: [RegExp, string[]][] = [
  [/ايميل|إيميل|بريد|رسال|ايميلاتي/, ['gmail', 'email', 'message', 'thread', 'draft', 'send']],
  [/تقويم|كلندر|موعد|مواعيد|اجتماع|حدث/, ['calendar', 'event', 'events']],
  [/مهام|مهمة|ملاحظ|تذكير/, ['task', 'tasks']],
  [/درايف|ملفات|مجلد/, ['drive', 'file', 'files', 'folder']],
  [/جدول بيانات|شيت|اكسل|إكسل/, ['sheet', 'spreadsheet', 'values']],
  [/مستند|دوك|وثيقة/, ['doc', 'docs', 'document']],
  [/عرض تقديمي|سلايد|بوربوينت/, ['presentation', 'slides']],
  [/جهات اتصال|جهة اتصال|كونتاكت/, ['contact', 'contacts']],
  [/استبيان|فورم/, ['form', 'forms']]
]
// Safety: tools that look like they change state (send/delete/write/run...) are never offered to the model automatically.
const RISKY = /(edit|interact|send|delete|remove|create|write|update|modify|manage|set[_-]|push|merge|apply|execut|exec[_-]|run[_-]|kubectl|terminate|drop|insert|upload|post[_-]|reply|draft|import|copy|move|install|uninstall|spawn|start|stop|kill|reset|patch|scale|rollout|cleanup|shutdown|store|save|add[_-]|register|train|deploy|claim|assign|handoff|steal|cancel|retry|complete)/i
const MAX_RESULT = 6000
const SEARCHY = /search|crawl|fetch|browse|web|ddg|duckduckgo|expand_link/i

// Builds the tool list for one request: a keyword-shortlisted slice of the MCP tools, plus read-only file tools
// confined to the active project folder (only when a project is active).
export async function buildToolset(userInput: string, projectPath?: string, opts: { fresh?: boolean; confidential?: boolean } = {}): Promise<Toolset | null> {
  const disabled = readState().disabledTools
  const defs: OpenAI.Chat.ChatCompletionTool[] = []
  const handlers = new Map<string, (a: Record<string, unknown>) => Promise<string>>()

  const inside = (p: string): string | null => {
    if (!projectPath) return null
    const full = path.resolve(projectPath, p)
    const rel = path.relative(projectPath, full)
    return rel.startsWith('..') || path.isAbsolute(rel) ? null : full
  }
  if (projectPath) {
    if (!disabled.includes('readFile')) {
      defs.push({
        type: 'function',
        function: {
          name: 'readFile',
          description: 'Read a text file inside the active project folder (relative path).',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        }
      })
      handlers.set('readFile', async (a) => {
        const p = inside(String(a.path ?? ''))
        return p ? readFile(p) : 'Error: path is outside the project folder'
      })
    }
    if (!disabled.includes('listFiles')) {
      defs.push({
        type: 'function',
        function: {
          name: 'listFiles',
          description: 'List files in a directory inside the active project folder (relative path, "." for root).',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        }
      })
      handlers.set('listFiles', async (a) => {
        const p = inside(String(a.path ?? '.'))
        return p ? listFiles(p) : 'Error: path is outside the project folder'
      })
    }
  }

  setComputerBase(projectPath)
  if (computerEnabled()) addComputerTools(defs, handlers, currentSignal)

  // Skills: the model can list and load any enabled skill, like Claude does.
  try {
    const names = await listSkills()
    if (names.length) {
      defs.push({
        type: 'function',
        function: {
          name: 'use_skill',
          description: 'Load the instructions of a skill and follow them. Available skills: ' + names.join(', ') + '. Load the matching one before doing a task it covers.',
          parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        }
      })
      handlers.set('use_skill', async (a) => {
        const sk = await loadSkill(String(a.name ?? ''))
        return sk && sk.enabled ? sk.content.slice(0, 12000) : 'Error: skill not found or disabled. Available: ' + names.join(', ')
      })
    }
  } catch {
    /* skills are optional */
  }

  // Location + places (OpenStreetMap): opt-in, only for location-style requests, never in a confidential project.
  const locNote: string[] = []
  if (needsLocation(userInput)) {
    if (opts.confidential) locNote.push('location tools are not allowed in a confidential project')
    else if (!getPrefs().locationEnabled) locNote.push('location tools (get_location, nearby_places) are switched off; tell the user to enable them in Settings > General > Location')
    else addPlaceTools(defs, handlers)
  }

  // Security checks (Pwned Passwords + VirusTotal hash lookup): opt-in, only for security-style requests, never in a confidential project.
  if (needsSecurity(userInput)) {
    if (opts.confidential) locNote.push('security tools are not allowed in a confidential project')
    else if (!getPrefs().securityToolsEnabled) locNote.push('security tools (pwned_password_check, virustotal_hash_lookup) are switched off; tell the user to enable them in Settings > General > Security checks')
    else addSecurityTools(defs, handlers)
  }

  // Isolated code sandbox (WSL Ubuntu): Windows only, every run needs approval, never in a confidential project.
  if (needsSandbox(userInput) && !opts.confidential && process.platform === 'win32') addSandboxTools(defs, handlers)

  // Local PDF/image tools (merge, extract pages, convert/shrink): run on this PC only, so they are fine in confidential projects. Needs PC control because they write files.
  if (needsDocTools(userInput) && computerEnabled()) addDocTools(defs, handlers, projectPath)

  let mcp: McpToolInfo[] = []
  try {
    mcp = await listMcpTools()
  } catch {
    mcp = []
  }
  const words = new Set(userInput.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  for (const [re, ex] of SYN) if (re.test(userInput)) ex.forEach((w) => words.add(w))
  const acc = getAccounts()
  const writeOn = new Set(acc.writeServers)
  const all = mcp.map((t) => {
    const hay = `${t.server} ${t.name.replace(/[-_]/g, ' ')} ${t.description}`.toLowerCase()
    let sc = 0
    for (const w of words) if (hay.includes(w)) sc += t.name.toLowerCase().includes(w) || t.server.toLowerCase().includes(w) ? 3 : 1
    // Requests that need live information always get the web search / fetch tools, whatever words they used.
    if (opts.fresh && SEARCHY.test(t.server + ' ' + t.name) && !RISKY.test(t.name)) sc += 6
    if (sc > 0) sc += toolPrior(t.server) // tools the user relies on win ties (learned locally)
    return { t, sc }
  })
  const scored = all
    .filter((x) => x.sc > 0 && !disabled.includes(x.t.fullName) && !HARD_BLOCK.test(x.t.name) && (!RISKY.test(x.t.name) || writeOn.has(x.t.server)))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, MAX_MCP)
  // Tools that matched the request but were held back because they change state and the server has no write access.
  const lockedServers = new Set(
    all.filter((x) => x.sc > 0 && !disabled.includes(x.t.fullName) && !HARD_BLOCK.test(x.t.name) && RISKY.test(x.t.name) && !writeOn.has(x.t.server)).map((x) => x.t.server)
  )
  const notes: string[] = [...locNote]
  for (const n of neededConnectors(userInput, acc.connected, !!acc.googleEmail)) notes.push('the request needs the ' + n.title + ' connector, which is not connected; tell the user to connect it in Settings > Connectors (it needs his own sign-in, you cannot do it for him)')
  if (!projectPath) notes.push('no project is open, so the file tools readFile/listFiles are not available')
  if (!mcp.length) notes.push('no MCP server answered, so no MCP tools exist this turn')
  if (lockedServers.size) notes.push(`tools that write, create, send or run exist for [${[...lockedServers].join(', ')}] but are locked until the user enables write access for that server (Accounts page)`)
  if (!computerEnabled()) notes.push('PC control (pc_* tools: run commands, build, save files) is switched off')
  const byName = new Map<string, McpToolInfo>()
  for (const { t } of scored) {
    byName.set(t.fullName, t)
    // The Google account email is filled in automatically, so the model is not asked for it.
    let schema = t.schema
    if (t.server === 'google-workspace' && acc.googleEmail && schema?.properties?.user_google_email) {
      schema = JSON.parse(JSON.stringify(schema))
      delete schema.properties.user_google_email
      schema.required = (schema.required ?? []).filter((r: string) => r !== 'user_google_email')
    }
    defs.push({
      type: 'function',
      function: { name: t.fullName, description: `[${t.server}] ${t.description}`.slice(0, 500), parameters: schema }
    })
  }
  // find_tool: the model describes what it needs in English keywords (it translates Arabic itself) and gets the matching
  // tools made callable for the rest of this turn. Same safety filters as the shortlist: no deletes, no disabled tools,
  // and state-changing tools only for servers that have write access.
  if (mcp.length) {
    defs.push({
      type: 'function',
      function: {
        name: 'find_tool',
        description:
          'Look up more tools when the ones you already have do not cover the request. Describe the capability in ENGLISH keywords (translate the request first), e.g. "gmail search email", "slack send message", "jira create issue". Matching tools become callable right after.',
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'English keywords for the capability needed' } }, required: ['query'] }
      }
    })
    handlers.set('find_tool', async (a) => {
      const qw = new Set(String(a.query ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
      if (!qw.size) return 'Error: give English keywords, e.g. "gmail search email".'
      const hits = mcp
        .map((t) => {
          const hay = `${t.server} ${t.name.replace(/[-_]/g, ' ')} ${t.description}`.toLowerCase()
          let sc = 0
          for (const w of qw) if (hay.includes(w)) sc += t.name.toLowerCase().includes(w) || t.server.toLowerCase().includes(w) ? 3 : 1
          return { t, sc }
        })
        .filter((x) => x.sc > 0 && !disabled.includes(x.t.fullName) && !HARD_BLOCK.test(x.t.name))
        .sort((x, y) => y.sc - x.sc)
        .slice(0, 8)
      if (!hits.length) return 'No tool matches these keywords. Try other English words, or tell the user the capability is not connected.'
      const ok = hits.filter((x) => !RISKY.test(x.t.name) || writeOn.has(x.t.server))
      const locked = [...new Set(hits.filter((x) => RISKY.test(x.t.name) && !writeOn.has(x.t.server)).map((x) => x.t.server))]
      for (const { t } of ok) {
        if (byName.has(t.fullName)) continue
        byName.set(t.fullName, t)
        defs.push({ type: 'function', function: { name: t.fullName, description: `[${t.server}] ${t.description}`.slice(0, 500), parameters: t.schema } })
      }
      const lines = ok.map((x) => `- ${x.t.fullName}: ${x.t.description.slice(0, 120)}`)
      if (locked.length) lines.push(`(locked until the user enables write access for: ${locked.join(', ')} — tell him to switch it on in Settings > Connectors)`)
      return (ok.length ? 'These tools are now callable:\n' : 'Nothing callable.\n') + lines.join('\n')
    })
  }  return {
    defs,
    notes,
    call: async (name, args) => {
      const h = handlers.get(name)
      let out: string
      if (h) out = await h(args)
      else {
        const info = byName.get(name)
        if (!info) out = 'Error: unknown tool ' + name
        else {
          let a = args
          if (info.server === 'google-workspace' && acc.googleEmail && info.schema?.properties?.user_google_email && !a.user_google_email) {
            a = { ...a, user_google_email: acc.googleEmail }
          }
          if (RISKY.test(info.name) && writeOn.has(info.server) && !(await approveWrite(info.server, info.name, a))) {
            out = 'Error: المستخدم رفض هذا الإجراء. لا تعيد المحاولة، وأخبره أن الإجراء لم يُنفَّذ.'
          } else if (!(await approveNewTool(info.server, info.name))) {
            out = 'Error: المستخدم ما وافق يستعمل هالأداة. لا تعيد المحاولة، وأخبره أنها ما اشتغلت.'
          } else out = await callMcpTool(info, a)
        }
      }
      const cut = out.length > MAX_RESULT ? out.slice(0, MAX_RESULT) + '\n…[truncated]' : out
      // Our own refusals and the tool finder are trusted; everything else came from outside and is fenced as data.
      return name === 'find_tool' || /^Error: (المستخدم|unknown tool)/.test(out) ? cut : fenceUntrusted(name, cut)
    }
  }
}
