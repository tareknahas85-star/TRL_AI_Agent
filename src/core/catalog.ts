import { hostOf } from './hosts'
import { readJson, writeJson } from './json-store'
import { MODEL_TIERS } from './config'
import { getApiKey } from '../store/secure-store'

export type CatalogTier = 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'
export type CatalogModel = {
  id: string
  name: string
  tier: CatalogTier
  pricePerM: number // USD per 1M tokens (avg of prompt+completion); 0 = free
  context: number
  vision: boolean
  tools?: boolean
  reasoning?: boolean
  enabled: boolean
}
type CatalogFile = { fetchedAt: number; models: CatalogModel[] }

const FILE = 'openrouter-catalog.json'
const BUILTIN = new Set<string>([
  ...MODEL_TIERS.TIER_1_FREE,
  ...MODEL_TIERS.TIER_2_CHEAP,
  ...MODEL_TIERS.TIER_3_EXPENSIVE
])

const load = (): CatalogFile => readJson<CatalogFile>(FILE, { fetchedAt: 0, models: [] })

export function listCatalog(): CatalogFile {
  return load()
}

// Swap a model with the previous/next enabled model of the same tier (this is the try-order).
export function moveCatalogModel(id: string, dir: 'up' | 'down'): boolean {
  const c = load()
  const i = c.models.findIndex((m) => m.id === id)
  if (i < 0) return false
  const tier = c.models[i].tier
  const step = dir === 'up' ? -1 : 1
  for (let j = i + step; j >= 0 && j < c.models.length; j += step) {
    if (c.models[j].tier === tier && c.models[j].enabled) {
      ;[c.models[i], c.models[j]] = [c.models[j], c.models[i]]
      writeJson(FILE, c)
      return true
    }
  }
  return false
}

export function setCatalogEnabled(ids: string[], enabled: boolean): number {
  const c = load()
  const set = new Set(ids)
  let n = 0
  for (const m of c.models) {
    if (set.has(m.id) && m.enabled !== enabled) {
      m.enabled = enabled
      n++
    }
  }
  writeJson(FILE, c)
  return n
}

// Enabled OpenRouter models of a tier, or null when the user has never pulled a catalog
// (then the router falls back to the built-in lists in config.ts).
export function catalogModelsForTier(t: CatalogTier): string[] | null {
  const c = load()
  if (!c.models.length) return null
  return c.models.filter((m) => m.enabled && m.tier === t).map((m) => m.id)
}

export async function testOpenRouterKey(): Promise<{ ok: boolean; message: string }> {
  const key = getApiKey('OPENROUTER_API_KEY')
  if (!key) return { ok: false, message: 'ما في مفتاح OpenRouter محفوظ. ضيفو أول.' }
  try {
    const res = await fetch(`${hostOf('openrouter')}/auth/key`, {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (res.status === 401 || res.status === 403) return { ok: false, message: `المفتاح مرفوض (HTTP ${res.status})` }
    if (!res.ok) return { ok: false, message: `خطأ من السيرفر (HTTP ${res.status})` }
    const j = (await res.json()) as { data?: { label?: string; limit?: number | null; usage?: number; is_free_tier?: boolean } }
    const d = j.data ?? {}
    const parts = [`المفتاح شغّال${d.label ? ` (${d.label})` : ''}`]
    if (typeof d.usage === 'number') parts.push(`الاستهلاك: $${d.usage.toFixed(4)}`)
    if (d.limit != null) parts.push(`الحد: $${d.limit}`)
    if (d.is_free_tier) parts.push('حساب مجاني (بدون رصيد)')
    return { ok: true, message: parts.join(' · ') }
  } catch (e) {
    return { ok: false, message: 'ما قدرت اتصل: ' + (e instanceof Error ? e.message : String(e)) }
  }
}

type ApiModel = {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  supported_parameters?: string[]
}

export async function fetchOpenRouterModels(): Promise<{ ok: boolean; message: string; added: number; total: number }> {
  const key = getApiKey('OPENROUTER_API_KEY')
  try {
    const res = await fetch(hostOf('openrouter') + '/models', key ? { headers: { Authorization: `Bearer ${key}` } } : undefined)
    if (!res.ok) return { ok: false, message: `فشل السحب (HTTP ${res.status})`, added: 0, total: 0 }
    const j = (await res.json()) as { data?: ApiModel[] }
    const prev = load()
    const prevMap = new Map(prev.models.map((m) => [m.id, m]))
    const firstPull = prev.models.length === 0
    const out: CatalogModel[] = []
    let added = 0
    for (const m of j.data ?? []) {
      const outMods = m.architecture?.output_modalities ?? ['text']
      if (!outMods.includes('text') || outMods.length > 1) continue // chat/text models only
      const p = Number(m.pricing?.prompt ?? 0)
      const c = Number(m.pricing?.completion ?? 0)
      const pricePerM = m.id.endsWith(':free') ? 0 : ((p + c) / 2) * 1_000_000
      const tier: CatalogTier =
        pricePerM === 0 ? 'TIER_1_FREE' : pricePerM < 1.5 ? 'TIER_2_CHEAP' : 'TIER_3_EXPENSIVE'
      const old = prevMap.get(m.id)
      if (!old) added++
      out.push({
        id: m.id,
        name: m.name ?? m.id,
        tier,
        pricePerM: Number.isFinite(pricePerM) ? pricePerM : 0,
        context: m.context_length ?? 0,
        vision: (m.architecture?.input_modalities ?? []).includes('image'),
        tools: (m.supported_parameters ?? []).includes('tools'),
        reasoning: (m.supported_parameters ?? []).some((x) => x === 'reasoning' || x === 'include_reasoning'),
        // Manual control: keep the user's choice; brand-new models start disabled,
        // except that the very first pull enables the built-in defaults.
        enabled: old ? old.enabled : firstPull && BUILTIN.has(m.id)
      })
    }
    writeJson(FILE, { fetchedAt: Date.now(), models: out } satisfies CatalogFile)
    return { ok: true, message: `سحبت ${out.length} موديل (${added} جديد)`, added, total: out.length }
  } catch (e) {
    return { ok: false, message: 'ما قدرت اتصل: ' + (e instanceof Error ? e.message : String(e)), added: 0, total: 0 }
  }
}

// Back to the defaults: only the built-in models enabled, order untouched.
export function resetCatalogEnabled(): number {
  const c = load()
  let n = 0
  for (const m of c.models) {
    const want = BUILTIN.has(m.id)
    if (m.enabled !== want) { m.enabled = want; n++ }
  }
  writeJson(FILE, c)
  return n
}
