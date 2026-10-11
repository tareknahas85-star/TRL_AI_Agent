import { hostOf } from './hosts'
import OpenAI from 'openai'
import { readJson, writeJson, newId } from './json-store'
import { getSecret, setSecret } from '../store/secure-store'

export type Tier = 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'
export type CustomModel = {
  id: string
  name: string
  model: string // provider model id, e.g. "gpt-4o-mini" or "meta-llama/llama-3.3-70b-instruct"
  baseURL: string // empty => OpenRouter
  tier: Tier
  enabled: boolean
  last?: boolean // true => tried after the OpenRouter models of its tier
}
export type CustomModelView = CustomModel & { hasKey: boolean }

const FILE = 'custom-models.json'
const TIERS: Tier[] = ['TIER_1_FREE', 'TIER_2_CHEAP', 'TIER_3_EXPENSIVE']
export const CUSTOM_PREFIX = 'custom:'

export const listCustomModels = (): CustomModel[] => readJson<CustomModel[]>(FILE, [])
export const getCustomModel = (id: string): CustomModel | undefined =>
  listCustomModels().find((m) => m.id === id)

export const listCustomModelViews = (): CustomModelView[] =>
  listCustomModels().map((m) => ({ ...m, hasKey: !!getSecret(`model:${m.id}`) }))

export function customModelsForTier(tier: Tier, last = false): string[] {
  return listCustomModels()
    .filter((m) => m.enabled && m.tier === tier && !!m.last === last)
    .map((m) => CUSTOM_PREFIX + m.id)
}

function validBaseURL(u: string): boolean {
  if (!u) return true
  try {
    const p = new URL(u)
    return p.protocol === 'https:' || p.protocol === 'http:'
  } catch {
    return false
  }
}

export function addCustomModel(input: {
  name: string
  model: string
  baseURL?: string
  apiKey?: string
  tier?: string
}): CustomModelView {
  const name = String(input.name ?? '').trim()
  const model = String(input.model ?? '').trim()
  const baseURL = String(input.baseURL ?? '').trim().replace(/\/+$/, '')
  if (!name || !model) throw new Error('الاسم ومعرّف الموديل مطلوبين')
  if (!validBaseURL(baseURL)) throw new Error('Base URL مو صالح')
  const tier = TIERS.includes(input.tier as Tier) ? (input.tier as Tier) : 'TIER_2_CHEAP'
  const m: CustomModel = { id: newId(), name, model, baseURL, tier, enabled: true }
  writeJson(FILE, [...listCustomModels(), m])
  if (input.apiKey) setSecret(`model:${m.id}`, String(input.apiKey))
  return { ...m, hasKey: !!input.apiKey }
}

export function removeCustomModel(id: string): boolean {
  const all = listCustomModels()
  const next = all.filter((m) => m.id !== id)
  if (next.length === all.length) return false
  writeJson(FILE, next)
  setSecret(`model:${id}`, '')
  return true
}

export function toggleCustomModel(id: string): boolean | null {
  const all = listCustomModels()
  const m = all.find((x) => x.id === id)
  if (!m) return null
  m.enabled = !m.enabled
  writeJson(FILE, all)
  return m.enabled
}

export function clientForCustomModel(m: CustomModel): { client: OpenAI; modelId: string } {
  const key = getSecret(`model:${m.id}`) || (m.baseURL ? '' : process.env.OPENROUTER_API_KEY || '')
  return {
    client: new OpenAI({
      baseURL: m.baseURL || hostOf('openrouter'),
      // Some local/OpenAI-compatible servers need no key; the SDK still requires a non-empty string.
      apiKey: key || 'not-needed'
    }),
    modelId: m.model
  }
}

export async function testCustomModel(id: string): Promise<{ ok: boolean; message: string }> {
  const m = getCustomModel(id)
  if (!m) return { ok: false, message: 'الموديل مو موجود' }
  try {
    const { client, modelId } = clientForCustomModel(m)
    const r = await client.chat.completions.create(
      { model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 },
      { timeout: 15000, maxRetries: 0 }
    )
    const txt = r.choices[0]?.message?.content ?? ''
    if (txt.length < 400 && /to prevent abuse|free resource|too many requests|rate.?limit|quota (exceeded|exhausted)|insufficient (balance|quota|credit)|usage limit/i.test(txt)) return { ok: false, message: 'رفض: ' + txt.slice(0, 100) }
    return { ok: true, message: 'اشتغل: ' + txt.slice(0, 40) }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 160) : String(e) }
  }
}

// ---- Local runtimes (Ollama / LM Studio): detect what is running and which models they serve.
export type LocalRuntime = { runtime: string; baseURL: string; models: string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function probe(url: string, pick: (j: any) => string[]): Promise<string[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    return pick(await res.json())
  } catch {
    return null
  }
}

export async function detectLocalModels(): Promise<LocalRuntime[]> {
  const [ollama, lmstudio] = await Promise.all([
    probe('http://127.0.0.1:11434/api/tags', (j) => (j.models ?? []).map((m: { name: string }) => m.name)),
    probe('http://127.0.0.1:1234/v1/models', (j) => (j.data ?? []).map((m: { id: string }) => m.id))
  ])
  const out: LocalRuntime[] = []
  if (ollama) out.push({ runtime: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', models: ollama })
  if (lmstudio) out.push({ runtime: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1', models: lmstudio })
  return out
}

export function setCustomModelPosition(id: string, last: boolean): boolean {
  const all = listCustomModels()
  const m = all.find((x) => x.id === id)
  if (!m) return false
  m.last = last
  writeJson(FILE, all)
  return true
}

export function setCustomModelKey(id: string, key: string): boolean {
  if (!getCustomModel(id)) return false
  setSecret(`model:${id}`, key)
  return true
}

// ---- Bulk import of a provider's free models, using a key already stored for one of its models.
export type RemoteModel = { id: string; recommended: boolean; added: boolean; free: boolean }
const NON_CHAT = /ocr|embed|rerank|safety|guard|moderation|whisper|tts|speech|image|flux|diffusion|video|sora|dall|transcri/i
const NOT_RECOMMENDED = /^coding-|^kimi-for-coding|code-preview/i

export async function fetchRemoteModels(
  sourceId: string,
  all = false
): Promise<{ ok: boolean; models?: RemoteModel[]; error?: string }> {
  const src = getCustomModel(sourceId)
  if (!src || !src.baseURL) return { ok: false, error: 'اختار موديل له Base URL' }
  const key = getSecret(`model:${src.id}`)
  try {
    const res = await fetch(src.baseURL + '/models', {
      headers: key ? { Authorization: 'Bearer ' + key } : {},
      signal: AbortSignal.timeout(20000)
    })
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
    const j = (await res.json()) as { data?: { id?: string; pricing?: Record<string, unknown> }[] }
    const have = listCustomModels()
    const out: RemoteModel[] = []
    for (const m of j.data ?? []) {
      const id = String(m.id ?? '')
      if (!id || NON_CHAT.test(id)) continue
      const p = m.pricing
      const zero = !!p && ['input', 'output', 'prompt', 'completion'].some((k) => k in p) &&
        ['input', 'output', 'prompt', 'completion'].every((k) => !(k in p) || Number(p[k]) === 0)
      const free = /[-:]free$/i.test(id) || zero
      if (!all && !free) continue
      out.push({
        id,
        free,
        recommended: !NOT_RECOMMENDED.test(id),
        added: have.some((x) => x.model === id && x.baseURL === src.baseURL)
      })
    }
    out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.id.localeCompare(b.id))
    return { ok: true, models: out }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e) }
  }
}

export function importRemoteModels(sourceId: string, items: (string | { id: string; free: boolean })[]): number {
  const src = getCustomModel(sourceId)
  if (!src || !src.baseURL) return 0
  const key = getSecret(`model:${src.id}`)
  const all = listCustomModels()
  const added: CustomModel[] = []
  for (const it of items.slice(0, 80)) {
    const id = typeof it === 'string' ? it : it.id
    const free = typeof it === 'string' ? true : !!it.free
    if (all.some((x) => x.model === id && x.baseURL === src.baseURL) || added.some((x) => x.model === id)) continue
    added.push({ id: newId(), name: id, model: id, baseURL: src.baseURL, tier: free ? 'TIER_1_FREE' : 'TIER_2_CHEAP', enabled: true, last: true })
  }
  if (!added.length) return 0
  writeJson(FILE, [...all, ...added])
  if (key) for (const m of added) setSecret(`model:${m.id}`, key)
  return added.length
}
