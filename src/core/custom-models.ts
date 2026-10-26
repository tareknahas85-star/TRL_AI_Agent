import { hostOf } from './hosts'
import OpenAI from 'openai'
import { readJson, writeJson, newId } from './json-store'
import { getSecret, setSecret } from '../store/secure-store'
import { knownPrice, type Price } from './pricing'
import { isChatKind, normKind } from './media-custom'

export type Tier = 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'
export type CustomModel = {
  id: string
  name: string
  model: string // provider model id, e.g. "gpt-4o-mini" or "meta-llama/llama-3.3-70b-instruct"
  baseURL: string // empty => OpenRouter
  tier: Tier
  enabled: boolean
  kind?: 'chat' | 'image' | 'audio' // missing = chat. image/audio models only appear under the generation buttons.
  desc?: string // what it is best at (shown next to it in the generation list)
  limit?: string // daily limit text (shown next to it)
  last?: boolean // true => tried after the OpenRouter models of its tier
  priceIn?: number // USD per 1M input tokens (manual; wins over the built-in table)
  priceOut?: number // USD per 1M output tokens
}
export type CustomModelView = CustomModel & { hasKey: boolean; autoPrice: Price | null }

const FILE = 'custom-models.json'
const TIERS: Tier[] = ['TIER_1_FREE', 'TIER_2_CHEAP', 'TIER_3_EXPENSIVE']
export const CUSTOM_PREFIX = 'custom:'

// النماذج اللي اسمها "free/..." أو ينتهي معرّفها بـ ":free" مجانية بالتعريف.
// نصحّح التصنيف عند القراءة، وهكذا النماذج القديمة المصنّفة TIER_2 تدخل المجاني تلقائياً.
const isFreeByName = (model: string): boolean => /^free\//i.test(model) || /:free$/i.test(model)
export const listCustomModels = (): CustomModel[] =>
  readJson<CustomModel[]>(FILE, []).map((m) => (m.tier !== 'TIER_1_FREE' && isFreeByName(m.model) ? { ...m, tier: 'TIER_1_FREE' as Tier } : m))
export const getCustomModel = (id: string): CustomModel | undefined =>
  listCustomModels().find((m) => m.id === id)

const toView = (m: CustomModel): CustomModelView => ({ ...m, hasKey: !!getSecret(`model:${m.id}`), autoPrice: knownPrice(m.model) })
// Chat routing (picker, tiers, reviewers) only ever sees chat models; the Models page sees everything.
export const listCustomModelViews = (): CustomModelView[] => listCustomModels().filter((m) => isChatKind(m.kind)).map(toView)
export const listAllCustomModelViews = (): CustomModelView[] => listCustomModels().map(toView)

export function customModelsForTier(tier: Tier, last = false): string[] {
  return listCustomModels()
    .filter((m) => m.enabled && isChatKind(m.kind) && m.tier === tier && !!m.last === last)
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
  kind?: string
  desc?: string
  limit?: string
}): CustomModelView {
  const name = String(input.name ?? '').trim()
  const model = String(input.model ?? '').trim()
  const baseURL = String(input.baseURL ?? '').trim().replace(/\/+$/, '')
  if (!name || !model) throw new Error('الاسم ومعرّف الموديل مطلوبين')
  if (!validBaseURL(baseURL)) throw new Error('Base URL مو صالح')
  const tier = TIERS.includes(input.tier as Tier) ? (input.tier as Tier) : 'TIER_2_CHEAP'
  const kind = normKind(input.kind)
  const m: CustomModel = { id: newId(), name, model, baseURL, tier, enabled: true }
  if (kind !== 'chat') m.kind = kind
  const desc = String(input.desc ?? '').trim().slice(0, 200)
  const limit = String(input.limit ?? '').trim().slice(0, 120)
  if (desc) m.desc = desc
  if (limit) m.limit = limit
  writeJson(FILE, [...listCustomModels(), m])
  if (input.apiKey) setSecret(`model:${m.id}`, String(input.apiKey))
  return { ...m, hasKey: !!input.apiKey, autoPrice: knownPrice(m.model) }
}

// Manual price per 1M tokens; null/empty clears it (then the built-in table / OpenRouter catalog is used).
export function setCustomModelPrice(id: string, priceIn: unknown, priceOut: unknown): boolean {
  const all = listCustomModels()
  const m = all.find((x) => x.id === id)
  if (!m) return false
  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  const a = num(priceIn)
  const b = num(priceOut)
  if (a === undefined || b === undefined) {
    delete m.priceIn
    delete m.priceOut
  } else {
    m.priceIn = a
    m.priceOut = b
  }
  writeJson(FILE, all)
  return true
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

/** Endpoint + key of a custom model, for the image/speech calls that the OpenAI SDK wrapper does not cover. */
export function customEndpoint(m: CustomModel): { base: string; key: string } {
  return { base: m.baseURL || hostOf('openrouter'), key: getSecret(`model:${m.id}`) || (m.baseURL ? '' : process.env.OPENROUTER_API_KEY || '') }
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
