import fs from 'fs'
import os from 'os'
import path from 'path'
import { getSkillsDir } from '../core/paths'
import { addMCPServer, loadMCPConfig, type MCPServer } from './client'
import { parseAny } from './import'

// Plugins = bundles (skills + MCP servers) installed by ChatGPT (Codex) or Claude. We read them from disk and
// import their skills into our Skills folder and their local MCP servers (disabled until tested).
export type PluginInfo = { id: string; name: string; origin: string; dir: string; version: string; skills: string[]; mcp: MCPServer[]; remoteMcp: number }

const home = os.homedir()

function subdirs(p: string): string[] {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
  } catch {
    return []
  }
}

function vkey(v: string): number[] {
  return v.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
}
function newest(vers: string[]): string {
  return [...vers].sort((a, b) => {
    const x = vkey(a)
    const y = vkey(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
    return 0
  })[0]
}

function describe(dir: string, name: string, origin: string, version: string): PluginInfo | null {
  const skillsDir = path.join(dir, 'skills')
  const skills = subdirs(skillsDir).filter((s) => fs.existsSync(path.join(skillsDir, s, 'SKILL.md')))
  let mcp: MCPServer[] = []
  let total = 0
  for (const f of ['.mcp.json', 'mcp.json']) {
    try {
      const p = path.join(dir, f)
      if (!fs.existsSync(p)) continue
      const text = fs.readFileSync(p, 'utf8')
      mcp = parseAny(text)
      const j = JSON.parse(text)
      const obj = j.mcpServers ?? j
      total = Object.keys(obj ?? {}).length
      break
    } catch {
      /* bad file */
    }
  }
  if (!skills.length && !total) return null
  return { id: origin + '::' + name, name, origin, dir, version, skills, mcp, remoteMcp: Math.max(0, total - mcp.length) }
}

export function scanPlugins(): PluginInfo[] {
  const out: PluginInfo[] = []
  // ChatGPT / Codex: ~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/
  const cx = path.join(home, '.codex', 'plugins', 'cache')
  for (const mk of subdirs(cx)) {
    for (const pl of subdirs(path.join(cx, mk))) {
      const vers = subdirs(path.join(cx, mk, pl))
      const v = vers.length ? newest(vers) : ''
      const dir = v ? path.join(cx, mk, pl, v) : path.join(cx, mk, pl)
      const d = describe(dir, pl, 'ChatGPT (' + mk + ')', v)
      if (d) out.push(d)
    }
  }
  // Claude: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ (installed ones only)
  const cc = path.join(home, '.claude', 'plugins', 'cache')
  for (const mk of subdirs(cc)) {
    for (const pl of subdirs(path.join(cc, mk))) {
      const vers = subdirs(path.join(cc, mk, pl))
      const v = vers.length ? newest(vers) : ''
      const dir = v ? path.join(cc, mk, pl, v) : path.join(cc, mk, pl)
      const d = describe(dir, pl, 'Claude (' + mk + ')', v)
      if (d) out.push(d)
    }
  }
  return out
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const t = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, t)
    else fs.copyFileSync(s, t)
  }
}

export async function importPlugins(ids: string[]): Promise<{ skills: string[]; skippedSkills: string[]; mcp: string[]; skippedMcp: string[] }> {
  const all = scanPlugins().filter((p) => ids.includes(p.id))
  const res = { skills: [] as string[], skippedSkills: [] as string[], mcp: [] as string[], skippedMcp: [] as string[] }
  const sk = getSkillsDir()
  const have = new Set((await loadMCPConfig()).servers.map((s) => s.name))
  for (const p of all) {
    for (const s of p.skills) {
      const dst = path.join(sk, s)
      if (fs.existsSync(dst)) {
        res.skippedSkills.push(s)
        continue
      }
      try {
        copyDir(path.join(p.dir, 'skills', s), dst)
        res.skills.push(s)
      } catch {
        res.skippedSkills.push(s)
      }
    }
    for (const m of p.mcp) {
      if (have.has(m.name)) {
        res.skippedMcp.push(m.name)
        continue
      }
      try {
        await addMCPServer({ ...m, enabled: false })
        have.add(m.name)
        res.mcp.push(m.name)
      } catch {
        res.skippedMcp.push(m.name)
      }
    }
  }
  return res
}
