import { fetchRemoteModels, importRemoteModels, setCustomModelKey, setCustomModelPosition } from '../core/custom-models'
import { freeOnly, setFreeOnly } from '../core/spend'
import { freeUsage } from '../core/model-health'
import { moveCatalogModel } from '../core/catalog'
import { deleteMemoryEntry, importMemory, listMemory, memoryPrompt, saveMemoryEntry, toggleMemoryEntry } from '../core/memory'
import { fetchOpenRouterModels, listCatalog, setCatalogEnabled, testOpenRouterKey } from '../core/catalog'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { computerState, resetComputerSession, setAutoApprove, setComputerEnabled, setFullAccess } from '../computer/control'
import { addSchedule, listSchedules, removeSchedule, runScheduleNow, runningSchedules, updateSchedule } from '../core/scheduler'
import { importServers, parseAny, scanSources } from '../mcp/import'
import { importPlugins, scanPlugins } from '../mcp/plugins'
import { claudeCliStatus, claudePersonalLogin, getClaudeAcctCfg, setClaudeAcctCfg } from '../core/cli-models'
import fsp from 'fs/promises'
import {
  createSkill,
  deleteSkill,
  isValidSkillName,
  listSkillDetails,
  loadSkill
} from '../skills/loader'
import {
  addMCPServer,
  listMCPServers,
  loadMCPConfig,
  removeMCPServer,
  testMCPServer,
  toggleMCPServer
} from '../mcp/client'
import { AVAILABLE_TOOLS } from '../tools/file-tools'
import { readState, toggleIn } from '../core/state'
import {
  addCustomModel,
  detectLocalModels,
  listCustomModelViews,
  removeCustomModel,
  testCustomModel,
  toggleCustomModel
} from '../core/custom-models'
import { getEffort, setEffort } from '../core/effort'
import { clearGeneral, getMasterMemory, updateProjectMemory } from '../core/master-memory'
import {
  addCustomTool,
  addProject,
  deleteConversation,
  getConversation,
  setConversationProject,
  listConversations,
  listCustomTools,
  listProjects,
  removeCustomTool,
  removeProject,
  renameConversation,
  saveConversation,
  setActiveProject,
  setProjectConfidential,
  togglePinConversation
} from '../core/workspace'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const skillView = (s: NonNullable<Awaited<ReturnType<typeof loadSkill>>>) => ({
  name: s.name,
  description: s.description,
  content: s.content,
  enabled: s.enabled
})

export function registerManagementHandlers(): void {
  // ---- Skills
  ipcMain.handle('computer:get', () => computerState())
  ipcMain.handle('computer:set', (_e, on: unknown) => {
    setComputerEnabled(on === true)
    return computerState()
  })
  ipcMain.handle('computer:setFull', (_e, on: unknown) => {
    setFullAccess(on === true)
    return computerState()
  })
  ipcMain.handle('spend:get', () => freeOnly())
  ipcMain.handle('spend:set', (_e, on: unknown) => setFreeOnly(on !== false))
  ipcMain.handle('computer:reset', () => {
    resetComputerSession()
    return computerState()
  })
  ipcMain.handle('skills:list', async () => (await listSkillDetails()).map(skillView))
  ipcMain.handle('skills:get', async (_e, name: unknown) => {
    const s = isValidSkillName(name) ? await loadSkill(name) : null
    return s ? skillView(s) : null
  })
  ipcMain.handle('skills:create', async (_e, name: unknown, content: unknown) => {
    try {
      return { ok: true, skill: skillView(await createSkill(String(name ?? '').trim(), String(content ?? ''))) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('skills:delete', async (_e, name: unknown) => isValidSkillName(name) && deleteSkill(name))
  ipcMain.handle('skills:toggle', (_e, name: unknown) => (isValidSkillName(name) ? toggleIn('disabledSkills', name) : null))

  // ---- MCP
  ipcMain.handle('mcp:list', () => listMCPServers())
  ipcMain.handle('mcp:get', async (_e, name: unknown) => (await listMCPServers()).find((s) => s.name === name) ?? null)
  ipcMain.handle('mcp:add', async (_e, server: unknown) => {
    try {
      return { ok: true, server: await addMCPServer(server as never) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('mcp:remove', (_e, name: unknown) => typeof name === 'string' && removeMCPServer(name))
  ipcMain.handle('mcp:toggle', (_e, name: unknown) => (typeof name === 'string' ? toggleMCPServer(name) : null))
  ipcMain.handle('mcp:test', async (_e, name: unknown) => {
    const s = (await loadMCPConfig()).servers.find((x) => x.name === name)
    return s ? testMCPServer(s) : { ok: false, message: 'السيرفر مو موجود' }
  })

  // ---- Tools (built-in + user-defined)
  ipcMain.handle('tools:list', () => {
    const disabled = readState().disabledTools
    return [
      ...AVAILABLE_TOOLS.map((t) => ({ ...t, custom: false, enabled: !disabled.includes(t.name) })),
      ...listCustomTools().map((t) => ({ ...t, custom: true, enabled: !disabled.includes(t.name) }))
    ]
  })
  ipcMain.handle('tools:toggle', (_e, name: unknown) =>
    typeof name === 'string' &&
    (AVAILABLE_TOOLS.some((t) => t.name === name) || listCustomTools().some((t) => t.name === name))
      ? toggleIn('disabledTools', name)
      : null
  )
  ipcMain.handle('tools:add', (_e, tool: unknown) => {
    try {
      return { ok: true, tool: addCustomTool(tool as never, AVAILABLE_TOOLS.map((t) => t.name)) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('tools:remove', (_e, name: unknown) => typeof name === 'string' && removeCustomTool(name))

  // ---- Custom models
  ipcMain.handle('models:list', () => listCustomModelViews())
  ipcMain.handle('models:detectLocal', () => detectLocalModels())
  ipcMain.handle('models:fetchRemote', (_e, id: unknown, all: unknown) =>
    typeof id === 'string' ? fetchRemoteModels(id, all === true) : { ok: false, error: 'bad id' }
  )
  ipcMain.handle('models:importRemote', (_e, id: unknown, ids: unknown) =>
    typeof id === 'string' && Array.isArray(ids)
      ? importRemoteModels(id, ids.filter((x): x is string | { id: string; free: boolean } => typeof x === 'string' || (!!x && typeof (x as { id?: unknown }).id === 'string')))
      : 0
  )
  ipcMain.handle('catalog:list', () => listCatalog())
  ipcMain.handle('catalog:move', (_e, id: unknown, dir: unknown) =>
    typeof id === 'string' && (dir === 'up' || dir === 'down') ? moveCatalogModel(id, dir) : false
  )
  ipcMain.handle('models:setPosition', (_e, id: unknown, last: unknown) =>
    typeof id === 'string' && typeof last === 'boolean' ? setCustomModelPosition(id, last) : false
  )
  ipcMain.handle('models:setKey', (_e, id: unknown, key: unknown) =>
    typeof id === 'string' && typeof key === 'string' ? setCustomModelKey(id, key) : false
  )
  ipcMain.handle('catalog:test', () => testOpenRouterKey())
  ipcMain.handle('catalog:fetch', () => fetchOpenRouterModels())
  ipcMain.handle('catalog:setEnabled', (_e, ids: unknown, on: unknown) =>
    Array.isArray(ids) && typeof on === 'boolean' ? setCatalogEnabled(ids.filter((x): x is string => typeof x === 'string'), on) : 0
  )
  ipcMain.handle('models:add', (_e, m: unknown) => {
    try {
      return { ok: true, model: addCustomModel((m ?? {}) as never) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('models:remove', (_e, id: unknown) => typeof id === 'string' && removeCustomModel(id))
  ipcMain.handle('models:toggle', (_e, id: unknown) => (typeof id === 'string' ? toggleCustomModel(id) : null))
  ipcMain.handle('models:test', (_e, id: unknown) =>
    typeof id === 'string' ? testCustomModel(id) : { ok: false, message: 'id مو صالح' }
  )

  // ---- Master memory (overview of all projects)
  ipcMain.handle('mm:get', () => getMasterMemory())
  ipcMain.handle('mm:update', (_e, id: unknown, patch: unknown) =>
    typeof id === 'string' && patch && typeof patch === 'object' ? updateProjectMemory(id, patch as never) : false
  )
  ipcMain.handle('mm:clearGeneral', () => {
    clearGeneral()
    return true
  })

  // ---- Memory
  ipcMain.handle('memory:list', () => listMemory())
  ipcMain.handle('memory:save', (_e, e: unknown) => {
    try {
      return { ok: true, entry: saveMemoryEntry((e ?? {}) as never) }
    } catch (err) {
      return { ok: false, error: msg(err) }
    }
  })
  ipcMain.handle('memory:delete', (_e, id: unknown) => typeof id === 'string' && deleteMemoryEntry(id))
  ipcMain.handle('memory:toggle', (_e, id: unknown) => (typeof id === 'string' ? toggleMemoryEntry(id) : null))
  ipcMain.handle('memory:import', (_e, entries: unknown, source: unknown) =>
    Array.isArray(entries) ? importMemory(entries as never, typeof source === 'string' ? source : 'import') : 0
  )
  ipcMain.handle('memory:preview', () => memoryPrompt() ?? { text: '', count: 0, truncated: false })

  // ---- Conversation search / export, and connection status
  ipcMain.handle('conv:search', (_e, q: unknown) => {
    const needle = typeof q === 'string' ? q.trim().toLowerCase() : ''
    if (!needle) return []
    const out: { id: string; snippet: string }[] = []
    for (const s of listConversations()) {
      const c = getConversation(s.id)
      if (!c) continue
      if (c.title.toLowerCase().includes(needle)) {
        out.push({ id: s.id, snippet: c.title })
        continue
      }
      const hit = c.messages.find((m) => m.content.toLowerCase().includes(needle))
      if (hit) {
        const i = hit.content.toLowerCase().indexOf(needle)
        out.push({ id: s.id, snippet: hit.content.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, ' ') })
      }
    }
    return out
  })
  ipcMain.handle('conv:export', async (event, id: unknown) => {
    const c = typeof id === 'string' ? getConversation(id) : null
    if (!c) return { ok: false, error: 'المحادثة مو موجودة' }
    const win = BrowserWindow.fromWebContents(event.sender)
    const safe = c.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'conversation'
    const opts = { defaultPath: safe + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }
    const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
    const body = c.messages
      .map((m) => (m.role === 'user' ? '## 🧑 أنت\n\n' : '## 🤖 المساعد\n\n') + m.content)
      .join('\n\n---\n\n')
    await fsp.writeFile(r.filePath, `# ${c.title}\n\n${body}\n`, 'utf-8')
    return { ok: true, path: r.filePath }
  })
  ipcMain.handle('status:get', async () => {
    let ollama = false
    let localMaster = false
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })
      const j = (await r.json()) as { models?: { name: string }[] }
      ollama = true
      localMaster = !!j.models?.some((m) => m.name === 'qwen3:1.7b')
    } catch {
      /* ollama not running */
    }
    const servers = await listMCPServers()
    return {
      key: !!process.env.OPENROUTER_API_KEY,
      ollama,
      localMaster,
      mcpOn: servers.filter((s) => s.enabled !== false).length,
      mcpTotal: servers.length,
      free: freeUsage()
    }
  })

  // ---- Projects
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:add', (_e, dir: unknown) => {
    try {
      return { ok: true, project: addProject(String(dir ?? '')) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('projects:pick', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await (win
      ? dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' }
    try {
      return { ok: true, project: addProject(r.filePaths[0]) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('projects:setConfidential', (_e, id: unknown, on: unknown) => typeof id === 'string' && setProjectConfidential(id, !!on))
  ipcMain.handle('schedules:list', () => ({ tasks: listSchedules(), running: runningSchedules() }))
  ipcMain.handle('schedules:add', (_e, t: unknown) => {
    try {
      return { ok: true, task: addSchedule((t ?? {}) as never) }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('schedules:update', (_e, id: unknown, p: unknown) => {
    try {
      return typeof id === 'string' ? { ok: !!updateSchedule(id, (p ?? {}) as never) } : { ok: false }
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
  })
  ipcMain.handle('schedules:remove', (_e, id: unknown) => typeof id === 'string' && removeSchedule(id))
  ipcMain.handle('schedules:run', (_e, id: unknown) => {
    if (typeof id === 'string') void runScheduleNow(id)
    return typeof id === 'string'
  })
  ipcMain.handle('claudeAcct:get', async () => ({ cfg: getClaudeAcctCfg(), work: await claudeCliStatus('work'), personal: await claudeCliStatus('personal') }))
  ipcMain.handle('claudeAcct:set', (_e, p: unknown) => {
    const o = (p ?? {}) as { active?: string; auto?: boolean }
    return setClaudeAcctCfg({ ...(o.active === 'work' || o.active === 'personal' ? { active: o.active } : {}), ...(typeof o.auto === 'boolean' ? { auto: o.auto } : {}) })
  })
  ipcMain.handle('claudeAcct:login', () => claudePersonalLogin())
  ipcMain.handle('mcp:scan', () => scanSources())
  ipcMain.handle('plugins:scan', () => scanPlugins().map((p) => ({ id: p.id, name: p.name, origin: p.origin, version: p.version, skills: p.skills, mcp: p.mcp.map((m) => m.name), remoteMcp: p.remoteMcp })))
  ipcMain.handle('plugins:import', (_e, ids: unknown) => importPlugins(Array.isArray(ids) ? ids.map(String) : []))
  ipcMain.handle('mcp:parse', (_e, text: unknown) => parseAny(String(text ?? '')))
  ipcMain.handle('mcp:import', (_e, servers: unknown) => importServers(Array.isArray(servers) ? (servers as never[]) : []))
  ipcMain.handle('computer:setAuto', (_e, on: unknown) => {
    setAutoApprove(on === true)
    return computerState()
  })
  ipcMain.handle('effort:get', () => getEffort())
  ipcMain.handle('effort:set', (_e, v: unknown) => setEffort(v))
  ipcMain.handle('projects:remove', (_e, id: unknown) => typeof id === 'string' && removeProject(id))
  ipcMain.handle('projects:setActive', (_e, id: unknown) =>
    id === null || typeof id === 'string' ? setActiveProject(id) : false
  )

  // ---- Conversations
  ipcMain.handle('conv:list', () => listConversations())
  ipcMain.handle('conv:get', (_e, id: unknown) => (typeof id === 'string' ? getConversation(id) : null))
  ipcMain.handle('conv:save', (_e, conv: unknown) => saveConversation((conv ?? {}) as never))
  ipcMain.handle('conv:delete', (_e, id: unknown) => typeof id === 'string' && deleteConversation(id))
  ipcMain.handle('conv:setProject', (_e, id: unknown, pid: unknown) =>
    typeof id === 'string' && (pid === null || typeof pid === 'string') ? setConversationProject(id, pid) : false
  )
  ipcMain.handle('conv:pin', (_e, id: unknown) => (typeof id === 'string' ? togglePinConversation(id) : null))
  ipcMain.handle('conv:rename', (_e, id: unknown, t: unknown) =>
    typeof id === 'string' && typeof t === 'string' && renameConversation(id, t)
  )
}
