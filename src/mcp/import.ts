import fs from 'fs'
import os from 'os'
import path from 'path'
import { addMCPServer, loadMCPConfig, type MCPServer } from './client'

// Import MCP servers from other apps' local config files (or pasted JSON/TOML).
export type ImportSource = 'claude-desktop' | 'claude-code' | 'gemini' | 'codex' | 'paste'
export type Found = { source: string; file: string; servers: MCPServer[] }

const home = os.homedir()
const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')

const SOURCES: { id: Exclude<ImportSource, 'paste'>; label: string; files: string[] }[] = [
  { id: 'claude-desktop', label: 'Claude Desktop', files: [path.join(appdata, 'Claude', 'claude_desktop_config.json'), path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), path.join(home, '.config', 'Claude', 'claude_desktop_config.json')] },
  { id: 'claude-code', label: 'Claude Code', files: [path.join(home, '.claude.json'), path.join(home, '.claude', 'settings.json'), path.join(home, '.mcp.json')] },
  { id: 'gemini', label: 'Google (Gemini CLI)', files: [path.join(home, '.gemini', 'settings.json')] },
  { id: 'codex', label: 'ChatGPT (Codex CLI)', files: [path.join(home, '.codex', 'config.toml')] }
]

function fromObject(o: unknown): MCPServer[] {
  const out: MCPServer[] = []
  if (!o || typeof o !== 'object') return out
  for (const [name, v] of Object.entries(o as Record<string, any>)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.command !== 'string' || !v.command) continue // remote (url) servers are not supported here
    out.push({
      name,
      command: v.command,
      args: Array.isArray(v.args) ? v.args.map(String) : [],
      env: v.env && typeof v.env === 'object' ? Object.fromEntries(Object.entries(v.env).map(([k, x]) => [k, String(x)])) : {},
      enabled: v.disabled === true ? false : true
    })
  }
  return out
}

// Minimal TOML reader for [mcp_servers.NAME] tables (command, args = [...], [mcp_servers.NAME.env]).
function parseCodexToml(text: string): MCPServer[] {
  const servers: Record<string, any> = {}
  let cur: { name: string; env: boolean } | null = null
  const val = (raw: string): any => {
    const t = raw.trim()
    if (t.startsWith('[')) {
      try {
        return JSON.parse(t.replace(/'/g, '"'))
      } catch {
        return []
      }
    }
    return t.replace(/^["']|["']$/g, '')
  }
  for (const line0 of text.split(/\r?\n/)) {
    const line = line0.trim()
    if (!line || line.startsWith('#')) continue
    const h = line.match(/^\[mcp_servers\.([^.\]]+)(\.env)?\]$/)
    if (h) {
      cur = { name: h[1].replace(/^["']|["']$/g, ''), env: !!h[2] }
      servers[cur.name] ??= { env: {} }
      continue
    }
    if (line.startsWith('[')) {
      cur = null
      continue
    }
    const kv = line.match(/^([\w-]+)\s*=\s*(.+)$/)
    if (kv && cur) {
      if (cur.env) servers[cur.name].env[kv[1]] = String(val(kv[2]))
      else servers[cur.name][kv[1]] = val(kv[2])
    }
  }
  return fromObject(servers)
}

export function parseAny(text: string): MCPServer[] {
  const t = text.trim()
  if (!t) return []
  try {
    const j = JSON.parse(t)
    if (j.mcpServers) return fromObject(j.mcpServers)
    if (j.servers && !Array.isArray(j.servers)) return fromObject(j.servers)
    if (Array.isArray(j.servers)) return fromObject(Object.fromEntries(j.servers.map((s: any) => [s.name, s])))
    if (j.projects && typeof j.projects === 'object') {
      // ~/.claude.json keeps per-project servers too
      const all: MCPServer[] = []
      for (const p of Object.values<any>(j.projects)) all.push(...fromObject(p?.mcpServers))
      return all
    }
    return fromObject(j)
  } catch {
    return parseCodexToml(t)
  }
}

export function scanSources(): Found[] {
  const found: Found[] = []
  for (const src of SOURCES) {
    for (const f of src.files) {
      try {
        if (!fs.existsSync(f)) continue
        const text = fs.readFileSync(f, 'utf-8')
        let servers = parseAny(text)
        if (src.id === 'claude-code' && f.endsWith('.claude.json')) {
          const j = JSON.parse(text)
          servers = [...fromObject(j.mcpServers), ...servers]
        }
        const seen = new Set<string>()
        servers = servers.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
        if (servers.length) found.push({ source: src.label, file: f, servers })
      } catch {
        /* unreadable file */
      }
    }
  }
  return found
}

export async function importServers(servers: MCPServer[]): Promise<{ added: string[]; skipped: string[] }> {
  const have = new Set((await loadMCPConfig()).servers.map((s) => s.name))
  const added: string[] = []
  const skipped: string[] = []
  for (const s of servers) {
    if (have.has(s.name)) {
      skipped.push(s.name)
      continue
    }
    try {
      await addMCPServer({ ...s, enabled: false }) // imported servers start OFF until the user tests and enables them
      added.push(s.name)
    } catch {
      skipped.push(s.name)
    }
  }
  return { added, skipped }
}
