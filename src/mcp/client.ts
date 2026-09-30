import fs from 'fs/promises'
import { spawn } from 'child_process'
import { getMCPConfigPath } from '../core/paths'

export type MCPServer = {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}
export type MCPConfig = { servers: MCPServer[] }

export async function loadMCPConfig(): Promise<MCPConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(getMCPConfigPath(), 'utf-8'))
    return { servers: Array.isArray(parsed.servers) ? parsed.servers : [] }
  } catch {
    return { servers: [] }
  }
}

export async function saveMCPConfig(config: MCPConfig): Promise<void> {
  await fs.writeFile(getMCPConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export async function listMCPServers(): Promise<MCPServer[]> {
  return (await loadMCPConfig()).servers
}

export async function addMCPServer(server: MCPServer): Promise<MCPServer> {
  const name = String(server.name ?? '').trim()
  const command = String(server.command ?? '').trim()
  if (!name || !command) throw new Error('الاسم والأمر مطلوبين')
  const cfg = await loadMCPConfig()
  if (cfg.servers.some((s) => s.name === name)) throw new Error('يوجد سيرفر بنفس الاسم')
  const clean: MCPServer = {
    name,
    command,
    args: Array.isArray(server.args) ? server.args.map(String).filter(Boolean) : [],
    env: server.env && typeof server.env === 'object' ? server.env : {},
    enabled: server.enabled !== false
  }
  cfg.servers.push(clean)
  await saveMCPConfig(cfg)
  return clean
}

export async function removeMCPServer(name: string): Promise<boolean> {
  const cfg = await loadMCPConfig()
  const next = cfg.servers.filter((s) => s.name !== name)
  if (next.length === cfg.servers.length) return false
  await saveMCPConfig({ servers: next })
  return true
}

export async function toggleMCPServer(name: string): Promise<boolean | null> {
  const cfg = await loadMCPConfig()
  const s = cfg.servers.find((x) => x.name === name)
  if (!s) return null
  s.enabled = s.enabled === false
  await saveMCPConfig(cfg)
  return s.enabled
}

// Spawn the server and perform an MCP `initialize` handshake over stdio.
export function testMCPServer(server: MCPServer, timeoutMs = 30000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let done = false
    let buf = ''
    let stderr = ''
    // With shell:true on Windows, paths containing spaces (e.g. Program Files) must be quoted.
    const win = process.platform === 'win32'
    const q = (v: string): string => (win && /[\s&()^%!<>|]/.test(v) && !/^".*"$/.test(v) ? `"${v}"` : v)
    const child = spawn(q(server.command), (server.args ?? []).map(q), {
      env: { ...process.env, ...(server.env ?? {}) },
      shell: win,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const finish = (ok: boolean, message: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } else child.kill()
      } catch {
        /* ignore */
      }
      resolve({ ok, message })
    }
    const timer = setTimeout(() => finish(false, 'انتهت المهلة (30 ثانية) بدون رد من السيرفر'), timeoutMs)
    child.on('error', (e) => finish(false, 'تعذر تشغيل الأمر: ' + e.message))
    child.on('exit', (code) => finish(false, `السيرفر أغلق (code ${code}) ${stderr.trim().slice(0, 200)}`))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.stdout.on('data', (d) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id === 1 && msg.result) {
            const info = msg.result.serverInfo
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
            finish(true, info ? `متصل: ${info.name ?? ''} ${info.version ?? ''}`.trim() : 'متصل')
          } else if (msg.id === 1 && msg.error) finish(false, 'خطأ من السيرفر: ' + (msg.error.message ?? ''))
        } catch {
          /* non-JSON line */
        }
      }
    })
    child.stdin.on('error', () => undefined)
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ai-router-os', version: '0.1.0' }
        }
      }) + '\n'
    )
  })
}

export function buildMCPSystemPrompt(servers: MCPServer[]): string {
  const active = servers.filter((s) => s.enabled !== false)
  if (!active.length) return ''
  return `\nAvailable MCP Servers: ${active.map((s) => s.name).join(', ')}`
}
