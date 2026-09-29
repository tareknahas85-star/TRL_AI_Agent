import { ipcMain } from 'electron'
import { analyzeRequest } from '../core/master'
import { calculateSavedCost } from '../core/fallback'
import { executeWithSkill } from '../skills/executor'
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
  ipcMain.handle('chat:send', async (_event, userMsg: unknown) => {
    if (typeof userMsg !== 'string' || !userMsg.trim()) {
      return { content: 'Error: empty message' }
    }
    if (!process.env.OPENROUTER_API_KEY) {
      return { content: 'Error: OPENROUTER_API_KEY is missing. Add it in Settings or in .env.' }
    }
    try {
      const analysis = await analyzeRequest(userMsg)
      console.log('[UI] Analysis:', analysis)
      const result = await executeWithSkill(userMsg, analysis)
      const saved = calculateSavedCost(result.modelUsed, analysis)
      const meta = `Model: ${result.modelUsed} | Skill: ${analysis.need_skill} | ${saved} | Tried: ${result.triedModels.join(' -> ')}`
      return { content: result.content, meta }
    } catch (e) {
      return { content: 'Error: ' + (e instanceof Error ? e.message : String(e)) }
    }
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
