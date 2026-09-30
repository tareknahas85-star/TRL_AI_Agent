import { ipcMain, type WebContents } from 'electron'
import { analyzeRequest, warmLocalMaster, type Analysis } from '../core/master'
import { ensureOllama } from '../core/ollama'
import { calculateSavedCost } from '../core/fallback'
import { executeWithSkill } from '../skills/executor'
import { registerManagementHandlers } from './management'
import { activeProject } from '../core/workspace'
import { memoryPrompt } from '../core/memory'
import { setProgressSink, setStreamSink, beginRun, cancelRun } from '../core/progress'
import { CUSTOM_PREFIX, getCustomModel } from '../core/custom-models'
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
  void ensureOllama().then(() => setTimeout(() => void warmLocalMaster(), 500))

  type Hist = { role: 'user' | 'assistant'; content: string }[]
  type LastRun = { userMsg: string; analysis: Analysis; tried: string[]; masterMs: number; history: Hist }
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
  let lastRun: LastRun | null = null

  const runChat = async (sender: WebContents, input: string, retry: boolean, rawHistory?: unknown) => {
    if (!process.env.OPENROUTER_API_KEY) {
      return { content: 'Error: OPENROUTER_API_KEY is missing. Add it in Settings or in .env.', failed: true }
    }
    if (retry && !lastRun) return { content: 'لا يوجد طلب سابق لإعادته.', failed: true }
    const signal = beginRun()
    const started = Date.now()
    const send = (ch: string, ...a: unknown[]): void => {
      try {
        sender.send(ch, ...a)
      } catch {
        /* window closed */
      }
    }
    setProgressSink((t) => send('chat:progress', t))
    setStreamSink((k, t) => send('chat:stream', k, t))
    try {
      let userMsg = input
      let analysis: Analysis
      let masterMs = 0
      let exclude: string[] = []
      let history: Hist = retry && lastRun ? lastRun.history : cleanHistory(rawHistory)
      if (retry && lastRun) {
        analysis = lastRun.analysis
        exclude = lastRun.tried
        userMsg = lastRun.userMsg
        masterMs = lastRun.masterMs
      } else {
        analysis = await analyzeRequest(userMsg)
        masterMs = Date.now() - started
      }
      if (signal.aborted) return { content: '', cancelled: true }
      console.log('[UI] Analysis:', analysis)
      const project = activeProject()
      const projectCtx = project
        ? `The user's active project folder is: ${project.path} (name: ${project.name}). Use it as the working directory when relevant.`
        : undefined
      const mem = memoryPrompt()
      const extra = [projectCtx, mem?.text].filter(Boolean).join('\n\n') || undefined
      const execStart = Date.now()
      const result = await executeWithSkill(userMsg, analysis, extra, exclude, history)
      const execMs = Date.now() - execStart
      if (signal.aborted) return { content: '', cancelled: true }
      if (result.modelUsed === 'none' && retry) return { content: result.content, failed: true }
      lastRun = { userMsg, analysis, tried: [...exclude, ...result.triedModels], masterMs, history }
      const isCustom = result.modelUsed.startsWith(CUSTOM_PREFIX)
      const shownModel = isCustom
        ? (getCustomModel(result.modelUsed.slice(CUSTOM_PREFIX.length))?.name ?? result.modelUsed)
        : result.modelUsed
      const saved = isCustom ? 'استخدمت موديلك المخصص' : calculateSavedCost(result.modelUsed, analysis)
      const u = result.usage
      const stats = {
        masterMs,
        execMs,
        totalMs: Date.now() - started + (retry ? 0 : 0),
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
      return { content: result.content, meta }
    } catch (e) {
      if (signal.aborted) return { content: '', cancelled: true }
      return { content: 'Error: ' + (e instanceof Error ? e.message : String(e)), failed: retry }
    } finally {
      setProgressSink(null)
      setStreamSink(null)
    }
  }

  ipcMain.handle('chat:send', (event, userMsg: unknown, history?: unknown) => {
    if (typeof userMsg !== 'string' || !userMsg.trim()) return { content: 'Error: empty message' }
    return runChat(event.sender, userMsg, false, history)
  })
  ipcMain.handle('chat:retry', (event) => runChat(event.sender, '', true))
  ipcMain.handle('chat:cancel', () => {
    cancelRun()
    return true
  })

  ipcMain.handle('keys:get', (_event, key: unknown) => (isKeyName(key) ? getApiKey(key) : ''))

  ipcMain.handle('keys:set', (_event, key: unknown, value: unknown) => {
    if (!isKeyName(key) || typeof value !== 'string') return false
    setApiKey(key, value)
    if (value) process.env[key] = value
    else delete process.env[key]
    return true
  })
}
