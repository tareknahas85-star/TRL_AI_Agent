import { hostOf } from './hosts'
import { MODEL_TIERS } from './config'
import type { Analysis } from './master'
import { customModelsForTier } from './custom-models'
import { catalogModelsForTier } from './catalog'
import { freeOnly } from './spend'
import { currentMode } from './progress'
import { rankedFreeModels } from './free-best'
import { pinnedFree } from './free-pin'
import { CUSTOM_PREFIX } from './custom-models'
import { apinexFreeIds, hasApinexKey } from './apinex'
import { freeFirst } from './free-provider'

// Built-in tiers plus the user's enabled custom models (custom ones are tried first inside their tier).
const tier = (t: 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'): string[] => {
  const base = [...customModelsForTier(t, false), ...(catalogModelsForTier(t) ?? MODEL_TIERS[t]), ...customModelsForTier(t, true)]
  if (t !== 'TIER_1_FREE') return base
  // Free tier: the strongest free models OpenRouter currently offers go first (ranked automatically), then the rest.
  const pinned = pinnedFree()
  const openRouterBest = [...(pinned ? [pinned] : []), ...rankedFreeModels(4).filter((m) => m !== pinned)]
  // APInex free models join the free tier when a key is set. The user chooses which source goes first.
  const apinexBest = hasApinexKey() ? apinexFreeIds().slice(0, 4) : []
  const best = freeFirst() === 'apinex' ? [...apinexBest, ...openRouterBest] : [...openRouterBest, ...apinexBest]
  return [...best, ...base.filter((m) => !best.includes(m))]
}

// Confidential projects: paid strong models only (no free tier, no custom/local ones).
export const strongPaidModels = (): string[] => tier('TIER_3_EXPENSIVE').filter((m) => !m.includes(':free') && !m.startsWith(CUSTOM_PREFIX))
// المدفوع فقط: الأقوى أولاً (TIER_3 ثم TIER_2)، من غير أي موديل مجاني.
const paidTiers = (): string[] => [...tier('TIER_3_EXPENSIVE'), ...tier('TIER_2_CHEAP')].filter((m) => !m.includes(':free'))

export function getTierForAnalysis(analysis: Analysis): string[] {
  // A chat run carries its own mode (free / auto / model); outside a run the global free-only guard applies.
  const mode = currentMode()
  // وضع "المجلس" بدون كاتب/ناقد محدد: مدفوع فقط (المجاني ما يدخل). حارس الصرف العام له الأولوية.
  if (mode?.kind === 'council' && !mode.author && !mode.critic && !freeOnly()) return paidTiers()
  // المحادثة العادية: المجاني أولاً، وإذا فشل كله بينتقل للمدفوع تلقائياً (بيتجاوز حارس freeOnly، بقرار المستخدم).
  if (mode?.kind === 'free') return [...tier('TIER_1_FREE'), ...tier('TIER_2_CHEAP'), ...tier('TIER_3_EXPENSIVE')]
  // المجلس بدون كاتب/ناقد: المجاني ما يدخل إذا الحارس مفعّل.
  const lockedFree = mode ? mode.kind === 'council' && freeOnly() : freeOnly()
  if (lockedFree) return tier('TIER_1_FREE')
  switch (analysis.complexity) {
    case 'simple':
      return [...tier('TIER_1_FREE'), ...tier('TIER_2_CHEAP')]
    case 'medium':
      return [
        ...tier('TIER_1_FREE'),
        ...tier('TIER_2_CHEAP'),
        ...tier('TIER_3_EXPENSIVE')
      ]
    case 'complex':
      return [
        ...tier('TIER_3_EXPENSIVE'),
        ...tier('TIER_2_CHEAP'),
        ...tier('TIER_1_FREE')
      ]
  }
}

export async function fetchFreeModels(): Promise<string[]> {
  try {
    const res = await fetch(hostOf('openrouter') + '/models')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id).filter((id) => id.endsWith(':free'))
  } catch (err) {
    console.warn('fetchFreeModels failed:', err)
    return []
  }
}
