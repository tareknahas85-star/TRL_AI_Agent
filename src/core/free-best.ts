import { hostOf } from './hosts'
import { readJson, writeJson } from './json-store'

// OpenRouter keeps adding strong experimental free models. This ranks the currently available ":free" models
// (size, context, tool support, freshness, family) so the free tier always starts with the strongest one.
type ApiModel = {
  id: string
  created?: number
  context_length?: number
  supported_parameters?: string[]
  architecture?: { output_modalities?: string[] }
}
type Ranking = { fetchedAt: number; ids: string[]; scores?: Record<string, number> }
const FILE = 'free-ranking.json'
const TTL = 12 * 3600 * 1000

// Rough parameter counts (billions) for well-known families whose id carries no size.
const KNOWN: [RegExp, number][] = [
  [/kimi-k2/, 1000],
  [/deepseek.*(r1|v3|v4)/, 600],
  [/qwen3-coder/, 480],
  [/llama-4-maverick/, 400],
  [/glm-4\.[5-9]|glm-[5-9]/, 355],
  [/minimax-m/, 230],
  [/gpt-oss-120b/, 120],
  [/mistral-(large|medium)/, 120],
  [/llama-3\.3-70b/, 70],
  [/gemini.*(pro)/, 200],
  [/gemini.*(flash)/, 60],
  [/hermes-3-llama-3\.1-405b/, 405]
]

function sizeB(id: string): number {
  const low = id.toLowerCase()
  for (const [re, n] of KNOWN) if (re.test(low)) return n
  // "120b-a12b" -> total 120; "31b" -> 31; "e4b" etc. ignored when absent
  const m = [...low.matchAll(/(\d+(?:\.\d+)?)b(?![a-z])/g)].map((x) => Number(x[1]))
  if (m.length) return Math.max(...m)
  if (/super|ultra|large|max|pro/.test(low)) return 100
  if (/lightning|mini|small|lite|nano|tiny|flash/.test(low)) return 15
  return 30
}

export function scoreFree(m: ApiModel): number {
  const ctx = Math.max(m.context_length ?? 8000, 4000)
  const ageDays = m.created ? Math.max(0, (Date.now() / 1000 - m.created) / 86400) : 365
  const tools = (m.supported_parameters ?? []).includes('tools') ? 18 : 0
  const reasoning = (m.supported_parameters ?? []).some((p) => p === 'reasoning' || p === 'include_reasoning') ? 6 : 0
  return Math.log2(sizeB(m.id) + 1) * 12 + Math.log2(ctx) * 2 + tools + reasoning + Math.max(0, 14 - ageDays / 30)
}

export function rankedFreeModels(limit = 6): string[] {
  const r = readJson<Ranking>(FILE, { fetchedAt: 0, ids: [] })
  if (Date.now() - r.fetchedAt > TTL) void refreshFreeRanking()
  return r.ids.slice(0, limit)
}

let busy = false
export async function refreshFreeRanking(): Promise<{ ok: boolean; top: string[] }> {
  if (busy) return { ok: false, top: [] }
  busy = true
  try {
    const res = await fetch(hostOf('openrouter') + '/models', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { ok: false, top: [] }
    const j = (await res.json()) as { data?: ApiModel[] }
    const free = (j.data ?? []).filter((m) => m.id.endsWith(':free') && (m.architecture?.output_modalities ?? ['text']).join() === 'text')
    const scored = free.map((m) => [m.id, scoreFree(m)] as const).sort((a, b) => b[1] - a[1])
    const scores: Record<string, number> = {}
    for (const [id, sc] of scored) scores[id] = Math.round(sc * 10) / 10
    const ids = scored.map(([id]) => id)
    if (ids.length) writeJson(FILE, { fetchedAt: Date.now(), ids, scores } satisfies Ranking)
    return { ok: ids.length > 0, top: ids.slice(0, 6) }
  } catch {
    return { ok: false, top: [] }
  } finally {
    busy = false
  }
}
