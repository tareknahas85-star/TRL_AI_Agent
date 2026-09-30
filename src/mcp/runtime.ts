import { addComputerTools, computerEnabled } from '../computer/control'
import { currentSignal } from '../core/progress'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import type OpenAI from 'openai'
import { loadMCPConfig, type MCPServer } from './client'
import { readFile, listFiles } from '../tools/file-tools'
import { readState } from '../core/state'

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
        25000
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
let toolCache: { at: number; tools: McpToolInfo[] } | null = null
const TTL = 10 * 60 * 1000

const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_')

export async function listMcpTools(): Promise<McpToolInfo[]> {
  const cfg = await loadMCPConfig()
  const active = cfg.servers.filter((s) => s.enabled !== false)
  if (!toolCache || Date.now() - toolCache.at > TTL) {
    const lists = await Promise.all(
      active.map(async (s) => {
        try {
          const c = await getConn(s)
          const r = await c.request('tools/list', {}, 20000)
          return ((r?.tools ?? []) as any[]).map(
            (t): McpToolInfo => ({
              fullName: `${safe(s.name)}__${safe(String(t.name))}`.slice(0, 64),
              server: s.name,
              name: String(t.name),
              description: String(t.description ?? ''),
              schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }
            })
          )
        } catch (e) {
          console.warn('[MCP] tools/list failed for', s.name, e instanceof Error ? e.message : e)
          return []
        }
      })
    )
    toolCache = { at: Date.now(), tools: lists.flat() }
  }
  const names = new Set(active.map((s) => s.name))
  return toolCache.tools.filter((t) => names.has(t.server))
}

export async function callMcpTool(info: McpToolInfo, args: Record<string, unknown>): Promise<string> {
  const cfg = await loadMCPConfig()
  const server = cfg.servers.find((s) => s.name === info.server && s.enabled !== false)
  if (!server) return 'Error: MCP server is disabled or removed'
  try {
    const c = await getConn(server)
    const r = await c.request('tools/call', { name: info.name, arguments: args }, 60000)
    const text = ((r?.content ?? []) as any[])
      .map((x) => (x?.type === 'text' ? String(x.text) : `[${x?.type ?? 'content'}]`))
      .join('\n')
    return (r?.isError ? 'Error: ' : '') + text
  } catch (e) {
    return 'Error: ' + (e instanceof Error ? e.message : String(e))
  }
}

export function closeAllMcp(): void {
  for (const p of pool.values()) p.then((c) => c.kill()).catch(() => undefined)
  pool.clear()
}

export type Toolset = {
  defs: OpenAI.Chat.ChatCompletionTool[]
  call: (name: string, args: Record<string, unknown>) => Promise<string>
}

const MAX_MCP = 10
// Safety: tools that look like they change state (send/delete/write/run...) are never offered to the model automatically.
const RISKY = /(send|delete|remove|create|write|update|modify|manage|set[_-]|push|merge|apply|execut|exec[_-]|run[_-]|kubectl|terminate|drop|insert|upload|post[_-]|reply|draft|import|copy|move|install|uninstall|spawn|start|stop|kill|reset|patch|scale|rollout|cleanup|shutdown|store|save|add[_-]|register|train|deploy|claim|assign|handoff|steal|cancel|retry|complete)/i
const MAX_RESULT = 6000

// Builds the tool list for one request: a keyword-shortlisted slice of the MCP tools, plus read-only file tools
// confined to the active project folder (only when a project is active).
export async function buildToolset(userInput: string, projectPath?: string): Promise<Toolset | null> {
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

  if (computerEnabled()) addComputerTools(defs, handlers, currentSignal)

  let mcp: McpToolInfo[] = []
  try {
    mcp = await listMcpTools()
  } catch {
    mcp = []
  }
  const words = new Set(userInput.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const scored = mcp
    .map((t) => {
      const hay = `${t.server} ${t.name.replace(/[-_]/g, ' ')} ${t.description}`.toLowerCase()
      let sc = 0
      for (const w of words) if (hay.includes(w)) sc += t.name.toLowerCase().includes(w) || t.server.toLowerCase().includes(w) ? 3 : 1
      return { t, sc }
    })
    .filter((x) => x.sc > 0 && !disabled.includes(x.t.fullName) && !RISKY.test(x.t.name))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, MAX_MCP)
  const byName = new Map<string, McpToolInfo>()
  for (const { t } of scored) {
    byName.set(t.fullName, t)
    defs.push({
      type: 'function',
      function: { name: t.fullName, description: `[${t.server}] ${t.description}`.slice(0, 500), parameters: t.schema }
    })
  }
  if (!defs.length) return null
  return {
    defs,
    call: async (name, args) => {
      const h = handlers.get(name)
      let out: string
      if (h) out = await h(args)
      else {
        const info = byName.get(name)
        out = info ? await callMcpTool(info, args) : 'Error: unknown tool ' + name
      }
      return out.length > MAX_RESULT ? out.slice(0, MAX_RESULT) + '\n…[truncated]' : out
    }
  }
}
