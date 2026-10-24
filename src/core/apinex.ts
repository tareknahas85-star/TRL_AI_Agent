import OpenAI from 'openai'
import { getApiKey } from '../store/secure-store'

// APInex: a third-party OpenAI-compatible gateway. Its no-subscription free models are a second free source,
// used when OpenRouter is slow, out of quota, or chosen second. Model ids carry the prefix so the router can
// tell them apart from OpenRouter ids.
export const APINEX_PREFIX = 'apinex:'
const API_BASE = 'https://api.apinex.bond/v1'
const CATALOG_URL = 'https://apinex.bond/api/public/models'
const DAY_MS = 24 * 60 * 60 * 1000

// Listed as "Subscription only" on the site. The public catalog does not flag these, so they are excluded here.
// Keep this in sync with the site when it changes.
export const APINEX_SUB_ONLY = new Set<string>([
  'free/minimax-m3',
  'free/qwen-3.8-max',
  'free/deepseek-v4-flash-0731',
  'free/mimo-v2.6-flash',
  'free/claude-sonnet-4.6',
  'free/hy4',
  'free/kimi-k3',
  'free/claude-opus-4.6',
  'free/gemini-3.1-pro',
  'free/kimi-k2.8'
])

// Used when the live catalog cannot be reached. Verified against the catalog on 2026-10-23.
const FALLBACK_FREE = [
  'free/muse-spark-1.3',
  'free/deepseek-v4.1-flash',
  'free/glm-5.3-flash',
  'free/minimax-m3.1-flash',
  'free/glm-5.3',
  'free/gemini-3.8-flash',
  'free/deepseek-v4-pro-0813',
  'free/gpt-6-luna',
  'free/glm-5.3-flashx',
  'free/mimo-v2.6-pro',
  'free/jev-1.13'
]

type CatalogEntry = {
  id?: string
  allowFree?: boolean
  dollarsPer1M?: number
  outputDollarsPer1M?: number
  supportsTools?: boolean
  health?: string
}

let cache: { at: number; ids: string[] } | null = null
let refreshing: Promise<void> | null = null

export const apinexKey = (): string => getApiKey('APINEX_API_KEY').trim()
export const hasApinexKey = (): boolean => apinexKey().length > 0

export function apinexClient(): OpenAI {
  return new OpenAI({
    baseURL: API_BASE,
    apiKey: apinexKey(),
    dangerouslyAllowBrowser: true,
    timeout: 90000,
    maxRetries: 0
  })
}

// Pulls the public catalog and keeps the free, tool-capable, live, no-subscription models.
async function refreshCatalog(): Promise<void> {
  try {
    const r = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { models?: CatalogEntry[] }
    const ids = (j.models ?? [])
      .filter(
        (m) =>
          typeof m.id === 'string' &&
          m.allowFree !== false &&
          m.dollarsPer1M === 0 &&
          (m.outputDollarsPer1M ?? 0) === 0 &&
          m.supportsTools !== false &&
          m.health !== 'down' &&
          !APINEX_SUB_ONLY.has(m.id as string)
      )
      .map((m) => APINEX_PREFIX + (m.id as string))
    if (ids.length) cache = { at: Date.now(), ids }
  } catch (e) {
    // Keep the previous list (or the fallback) and try again on the next call.
    console.warn('[apinex] catalog refresh failed:', (e as Error).message)
  }
}

// Synchronous view for the router. Refreshes in the background once a day; never blocks a chat request.
export function apinexFreeIds(): string[] {
  const stale = !cache || Date.now() - cache.at > DAY_MS
  if (stale && !refreshing) {
    refreshing = refreshCatalog().finally(() => {
      refreshing = null
    })
  }
  return cache?.ids ?? FALLBACK_FREE.map((m) => APINEX_PREFIX + m)
}

// For the UI and the daily report: forces a fresh pull and returns the list.
export async function apinexRefreshNow(): Promise<string[]> {
  await refreshCatalog()
  return apinexFreeIds()
}

export const isApinexModel = (model: string): boolean => model.startsWith(APINEX_PREFIX)
export const apinexModelId = (model: string): string => model.slice(APINEX_PREFIX.length)
