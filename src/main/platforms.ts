import { ipcMain } from 'electron'
import { listCatalog } from '../core/catalog'
import { apinexFreeIds, apinexRefreshNow, hasApinexKey } from '../core/apinex'
import { listAllCustomModelViews, addCustomModel, importRemoteModels, fetchRemoteModels } from '../core/custom-models'
import { estimateStrength, canonicalName } from '../core/model-rank'
import { hfFreeModels, hfFreeCached } from './hf'
import { getApiKey } from '../store/secure-store'

// 5.18.0: صفحة المنصات الموحدة. كل المنصات بموديلاتها المحمّلة + ترتيب عام من الأقوى للأضعف بغض النظر عن المنصة.
export type PModel = { id: string; label: string; platform: string; score: number; free: boolean; tools?: boolean; image?: boolean; enabled?: boolean }
export type Platform = { id: string; name: string; hasKey: boolean; note?: string; models: PModel[] }

const hostName = (u: string): string => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}

export function buildPlatforms(): Platform[] {
  const out: Platform[] = []
  const cat = listCatalog().models
  out.push({
    id: 'openrouter',
    name: 'OpenRouter',
    hasKey: !!process.env.OPENROUTER_API_KEY,
    models: cat.map((m) => ({ id: m.id, label: m.name || m.id, platform: 'openrouter', score: estimateStrength(m.id), free: m.tier === 'TIER_1_FREE' || /:free$/i.test(m.id), enabled: m.enabled }))
  })
  out.push({
    id: 'apinex',
    name: 'APInex',
    hasKey: hasApinexKey(),
    note: 'المجاني فقط وبدون اشتراك، وبيدعم الأدوات (حسب كتالوجو الحي).',
    models: apinexFreeIds().map((id) => ({ id, label: id.replace(/^apinex:/, ''), platform: 'apinex', score: estimateStrength(id), free: true, tools: true, enabled: true }))
  })
  const hf = hfFreeCached()
  out.push({
    id: 'huggingface',
    name: 'Hugging Face',
    hasKey: !!getApiKey('HUGGINGFACE_API_KEY'),
    note: hf.length ? undefined : 'اضغط «جرّب المفتاح + اسحب المجاني» لتحميل القائمة.',
    models: hf.map((m) => ({ id: 'hf:' + m.id, label: m.id, platform: 'huggingface', score: estimateStrength(m.id), free: true, tools: m.tools, image: m.image, enabled: true }))
  })
  // باقي المنصات: الموديلات المخصصة مجمّعة حسب الـ host (Gemini، OpenAI، Anthropic، محلي، أي منصة ضفتها).
  const groups = new Map<string, PModel[]>()
  const keyed = new Map<string, boolean>()
  for (const m of listAllCustomModelViews()) {
    if (m.kind && m.kind !== 'chat') continue
    const g = m.baseURL ? hostName(m.baseURL) : 'openrouter (مخصص)'
    const arr = groups.get(g) ?? []
    arr.push({ id: 'custom:' + m.id, label: m.name, platform: g, score: estimateStrength(m.model), free: m.tier === 'TIER_1_FREE', enabled: m.enabled })
    groups.set(g, arr)
    keyed.set(g, (keyed.get(g) ?? false) || m.hasKey)
  }
  for (const [g, models] of groups) out.push({ id: 'custom:' + g, name: g, hasKey: keyed.get(g) ?? false, models })
  return out
}

export type RankedRow = PModel & { platformName: string; dup: number }

export function globalRanking(platforms: Platform[], freeOnly: boolean): RankedRow[] {
  const rows: RankedRow[] = []
  for (const p of platforms) for (const m of p.models) if (!freeOnly || m.free) rows.push({ ...m, platformName: p.name, dup: 0 })
  rows.sort((a, b) => b.score - a.score || Number(!!b.tools) - Number(!!a.tools) || a.id.localeCompare(b.id))
  // نفس الموديل على أكثر من منصة: نبقي الأول بالترتيب (الأقوى/يلي بيدعم الأدوات) ونعد المكرر.
  const seen = new Map<string, RankedRow>()
  const out: RankedRow[] = []
  for (const r of rows) {
    const k = canonicalName(r.id)
    const f = seen.get(k)
    if (f) {
      f.dup++
      continue
    }
    seen.set(k, r)
    out.push(r)
  }
  return out
}

export function registerPlatformHandlers(): void {
  ipcMain.handle('platforms:overview', (_e, freeOnly: unknown) => {
    const platforms = buildPlatforms()
    return { platforms, ranking: globalRanking(platforms, freeOnly !== false).slice(0, 400) }
  })
  // «اختبر المفتاح واسحب المجاني» لمنصة محددة.
  ipcMain.handle('platforms:pull', async (_e, id: unknown) => {
    try {
      if (id === 'apinex') {
        if (!hasApinexKey()) return { ok: false, message: 'ما في مفتاح APInex' }
        const ids = await apinexRefreshNow()
        return { ok: true, message: `✅ ${ids.length} موديل مجاني`, count: ids.length }
      }
      if (id === 'huggingface') {
        const r = await hfFreeModels(true)
        if (!r.ok) return { ok: false, message: '❌ ' + (r.error ?? 'فشل') }
        return { ok: true, message: `✅ المفتاح شغّال — ${r.models.length} موديل مجاني من ${r.total}` + (r.pricingKnown ? '' : ' (ما في بيانات أسعار: القائمة مو مفلترة)'), count: r.models.length }
      }
      if (id === 'openrouter') return { ok: true, message: 'من صفحة الموديلات: «اسحب قائمة OpenRouter».', count: 0 }
      if (typeof id === 'string' && id.startsWith('custom:')) {
        const host = id.slice(7)
        const src = listAllCustomModelViews().find((m) => m.baseURL && hostName(m.baseURL) === host && m.hasKey)
        if (!src) return { ok: false, message: 'ما في مفتاح محفوظ لهالمنصة' }
        const r = await fetchRemoteModels(src.id, false)
        if (!r.ok) return { ok: false, message: '❌ ' + (r.error ?? 'فشل') }
        const free = (r.models ?? []).filter((m) => m.free && !m.added)
        const n = importRemoteModels(src.id, free.map((m) => ({ id: m.id, free: true })))
        return { ok: true, message: `✅ المفتاح شغّال — ${r.models?.length ?? 0} مجاني، انضاف ${n} جديد`, count: n }
      }
      return { ok: false, message: 'منصة غير معروفة' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message.slice(0, 160) : String(e) }
    }
  })
  // «إضافة منصة»: أي منصة متوافقة مع OpenAI (Base URL + مفتاح)، بتتختبر وبتنسحب موديلاتها المجانية.
  ipcMain.handle('platforms:add', async (_e, name: unknown, baseURL: unknown, apiKey: unknown) => {
    try {
      const n = String(name ?? '').trim()
      const base = String(baseURL ?? '').trim().replace(/\/+$/, '')
      const key = String(apiKey ?? '').trim()
      if (!n || !/^https?:\/\//i.test(base) || !key) return { ok: false, message: 'الاسم وعنوان الـ API والمفتاح مطلوبين (العنوان بيبدأ بـ https://)' }
      // موديل «مصدر» مؤقت لحمل المفتاح، بيتحول بعدها لأول موديل مجاني مسحوب أو بيتشال إذا ما لقينا.
      const seed = addCustomModel({ name: n + ' (مصدر)', model: 'seed', baseURL: base, apiKey: key, tier: 'TIER_2_CHEAP' })
      const r = await fetchRemoteModels(seed.id, false)
      if (!r.ok) {
        const { removeCustomModel } = await import('../core/custom-models')
        removeCustomModel(seed.id)
        return { ok: false, message: '❌ فشل الاتصال: ' + (r.error ?? '') }
      }
      const free = (r.models ?? []).filter((m) => m.free)
      const added = importRemoteModels(seed.id, free.map((m) => ({ id: m.id, free: true })))
      const { removeCustomModel } = await import('../core/custom-models')
      removeCustomModel(seed.id)
      return { ok: true, message: `✅ انضافت المنصة ${n}: ${free.length} موديل مجاني، انضاف ${added}.`, count: added }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message.slice(0, 160) : String(e) }
    }
  })
}
