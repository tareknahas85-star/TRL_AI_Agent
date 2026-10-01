import { ipcMain, type WebContents } from 'electron'
import { analyzeRequest, warmLocalMaster, type Analysis } from '../core/master'
import { ensureOllama } from '../core/ollama'
import { calculateSavedCost } from '../core/fallback'
import { executeWithSkill } from '../skills/executor'
import { registerManagementHandlers } from './management'
import { listProjects } from '../core/workspace'
import { buildProjectContext } from '../core/project-context'
import { masterMemoryPrompt, recordTurn } from '../core/master-memory'
import { registerAccountsHandlers } from './accounts-ipc'
import { memoryPrompt } from '../core/memory'
import { runInContext, cancelRun, type RunMode } from '../core/progress'
import { listCatalog } from '../core/catalog'
import { CUSTOM_PREFIX, getCustomModel, listCustomModels } from '../core/custom-models'
import { getApiKey, setApiKey } from '../store/secure-store'

const KEY_NAMES = ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
type KeyName = (typeof KEY_NAMES)[number]

function isKeyName(k: unknown): k is KeyName {
  return typeof k === 'string' && (KEY_NAMES as readonly string[]).includes(k)
}

// The core logic reads keys from process.env, so keys saved in the secure store are copied there.
export function hydrateEnvFromStore(): void {
  for (const k of KEY_NAMES) {
    const v = getApiKey(k)
    if (v) process.env[k] = v
  }
}

export function registerIpcHandlers(): void {
  registerManagementHandlers()
  registerAccountsHandlers()
  void ensureOllama().then(() => setTimeout(() => void warmLocalMaster(), 500))

  type Hist = { role: 'user' | 'assistant'; content: string }[]
  type LastRun = { userMsg: string; analysis: Analysis; tried: string[]; masterMs: number; history: Hist; projectId: string | null }
  const cleanHistory = (h: unknown): Hist => {
    if (!Array.isArray(h)) return []
    const out: Hist = []
    for (const m of h) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue
      const c = m.content.trim()
      if (!c || c.startsWith('Error:')) continue
      out.push({ role: m.role, content: c.length > 3000 ? c.slice(0, 3000) + '…' : c })
    }
    let tail = out.slice(-12)
    let total = 0
    const keep: Hist = []
    for (let i = tail.length - 1; i >= 0; i--) {
      total += tail[i].content.length
      if (total > 12000) break
      keep.unshift(tail[i])
    }
    tail = keep
    while (tail.length && tail[0].role !== 'user') tail.shift()
    return tail
  }
  // One "last run" per tab, so "retry with another model" works independently in each tab.
  const lastRuns = new Map<string, LastRun>()

  // Models the user may pick explicitly in a tab (enabled custom models + enabled catalog models).
  type PickerItem = { value: string; label: string; tier: string }
  const pickerModels = (): PickerItem[] => [
    ...listCustomModels()
      .filter((m) => m.enabled)
      .map((m) => ({ value: CUSTOM_PREFIX + m.id, label: m.name, tier: m.tier })),
    ...listCatalog()
      .models.filter((m) => m.enabled)
      .map((m) => ({ value: m.id, label: m.name || m.id, tier: m.tier }))
  ]
  const parseMode = (raw: unknown): RunMode => {
    const r = raw as { kind?: unknown; id?: unknown } | null
    if (r && r.kind === 'auto') return { kind: 'auto' }
    if (r && r.kind === 'model' && typeof r.id === 'string' && pickerModels().some((m) => m.value === r.id)) {
      return { kind: 'model', id: r.id }
    }
    return { kind: 'free' } // anything unknown falls back to the safe free-only mode
  }

  // At most 2 requests run at the same time; the rest wait their turn (protects the free quotas).
  const MAX_PARALLEL = 2
  let running = 0
  const waiters: (() => void)[] = []
  const acquire = async (): Promise<void> => {
    if (running < MAX_PARALLEL) {
      running++
      return
    }
    await new Promise<void>((res) => waiters.push(res))
  }
  const release = (): void => {
    const next = waiters.shift()
    if (next) next()
    else running--
  }

  type Opts = { tabId: string; projectId: string | null; mode: RunMode }

  const runChat = async (sender: WebContents, input: string, retry: boolean, rawHistory: unknown, o: Opts) => {
    if (o.mode.kind !== 'model' && !process.env.OPENROUTER_API_KEY) {
      return { content: 'Error: OPENROUTER_API_KEY is missing. Add it in Settings or in .env.', failed: true }
    }
    const prev = lastRuns.get(o.tabId)
    if (retry && !prev) return { content: 'لا يوجد طلب سابق لإعادته.', failed: true }
    const send = (ch: string, ...a: unknown[]): void => {
      try {
        sender.send(ch, o.tabId, ...a)
      } catch {
        /* window closed */
      }
    }
    return runInContext(
      o.tabId,
      o.mode,
      (t) => send('chat:progress', t),
      (k, t) => send('chat:stream', k, t),
      async (signal) => {
        if (running >= MAX_PARALLEL) send('chat:progress', 'بانتظار دوره (طلبين شغالين)…')
        await acquire()
        try {
          if (signal.aborted) return { content: '', cancelled: true }
          const started = Date.now()
          let userMsg = input
          let analysis: Analysis
          let masterMs = 0
          let exclude: string[] = []
          const history: Hist = retry && prev ? prev.history : cleanHistory(rawHistory)
          const projectId = retry && prev ? prev.projectId : o.projectId
          if (retry && prev) {
            analysis = prev.analysis
            // Picking an explicit model again is a fresh choice, so earlier failures do not exclude it.
            exclude = o.mode.kind === 'model' ? prev.tried.filter((t) => t !== (o.mode as { id: string }).id) : prev.tried
            userMsg = prev.userMsg
            masterMs = prev.masterMs
          } else {
            analysis = await analyzeRequest(userMsg)
            masterMs = Date.now() - started
          }
          if (signal.aborted) return { content: '', cancelled: true }
          console.log('[UI] Analysis:', analysis)
          const project = projectId ? (listProjects().projects.find((p) => p.id === projectId) ?? null) : null
          const projectCtx = project ? buildProjectContext(project) : undefined
          const mem = memoryPrompt()
          const mm = masterMemoryPrompt(projectId, userMsg)
          const extra = [projectCtx, mm?.text, mem?.text].filter(Boolean).join('\n\n') || undefined
          const execStart = Date.now()
          const result = await executeWithSkill(userMsg, analysis, extra, exclude, history, project)
          const execMs = Date.now() - execStart
          if (signal.aborted) return { content: '', cancelled: true }
          if (result.modelUsed === 'none' && retry) return { content: result.content, failed: true, needsChoice: true }
          lastRuns.set(o.tabId, { userMsg, analysis, tried: [...exclude, ...result.triedModels], masterMs, history, projectId })
          const isCustom = result.modelUsed.startsWith(CUSTOM_PREFIX)
          const shownModel = isCustom
            ? (getCustomModel(result.modelUsed.slice(CUSTOM_PREFIX.length))?.name ?? result.modelUsed)
            : result.modelUsed
          const saved = isCustom ? 'استخدمت موديلك المخصص' : calculateSavedCost(result.modelUsed, analysis)
          const u = result.usage
          const stats = {
            masterMs,
            execMs,
            totalMs: Date.now() - started,
            master: analysis.source ?? '',
            masterModel: analysis.masterModel ?? '',
            complexity: analysis.complexity,
            type: analysis.type,
            promptTokens: u?.promptTokens ?? 0,
            completionTokens: u?.completionTokens ?? 0,
            tps: u && u.genMs > 0 ? Math.round((u.completionTokens / (u.genMs / 1000)) * 10) / 10 : 0,
            est: u?.estimated ?? false,
            memory: mem?.count ?? 0,
            tools: result.toolsUsed ?? [],
            failures: result.failures ?? [],
            retried: retry
          }
          const meta = `Model: ${shownModel} | Memory: ${mem ? mem.count + (mem.truncated ? '+' : '') : 0} | Tools: ${result.toolsUsed?.length ? result.toolsUsed.join(',') : '-'} | Skill: ${analysis.skill ?? analysis.need_skill} | ${saved} | Tried: ${result.triedModels.join(' -> ')} | Stats: ${JSON.stringify(stats)}`
          if (result.modelUsed !== 'none') recordTurn(projectId, userMsg, result.content)
          // needsChoice: nothing answered (free chain exhausted or the picked model failed) -> the UI asks the user what to do.
          return { content: result.content, meta: result.modelUsed === 'none' ? undefined : meta, needsChoice: result.modelUsed === 'none' }
        } catch (e) {
          if (signal.aborted) return { content: '', cancelled: true }
          return { content: 'Error: ' + (e instanceof Error ? e.message : String(e)), failed: retry }
        } finally {
          release()
        }
      }
    )
  }

  const tabOf = (o: unknown): Opts => {
    const r = (o ?? {}) as { tabId?: unknown; projectId?: unknown; mode?: unknown }
    return {
      tabId: typeof r.tabId === 'string' && r.tabId ? r.tabId : 'default',
      projectId: typeof r.projectId === 'string' ? r.projectId : null,
      mode: parseMode(r.mode)
    }
  }

  ipcMain.handle('chat:send', (event, userMsg: unknown, history?: unknown, opts?: unknown) => {
    if (typeof userMsg !== 'string' || !userMsg.trim()) return { content: 'Error: empty message' }
    return runChat(event.sender, userMsg, false, history, tabOf(opts))
  })
  ipcMain.handle('chat:retry', (event, opts?: unknown) => runChat(event.sender, '', true, undefined, tabOf(opts)))
  ipcMain.handle('chat:cancel', (_e, tabId?: unknown) => {
    cancelRun(typeof tabId === 'string' && tabId ? tabId : 'default')
    return true
  })
  ipcMain.handle('models:picker', () => pickerModels())
  ipcMain.handle('keys:get', (_event, key: unknown) => (isKeyName(key) ? getApiKey(key) : ''))

  ipcMain.handle('keys:set', (_event, key: unknown, value: unknown) => {
    if (!isKeyName(key) || typeof value !== 'string') return false
    setApiKey(key, value)
    if (value) process.env[key] = value
    else delete process.env[key]
    return true
  })
}
