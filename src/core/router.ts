import { MODEL_TIERS, OPENROUTER_MODELS_API } from './config'
import type { Analysis } from './master'
import { customModelsForTier } from './custom-models'
import { catalogModelsForTier } from './catalog'
import { freeOnly } from './spend'
import { currentMode } from './progress'
import { rankedFreeModels } from './free-best'
import { pinnedFree } from './free-pin'
import { CUSTOM_PREFIX } from './custom-models'

// Built-in tiers plus the user's enabled custom models (custom ones are tried first inside their tier).
const tier = (t: 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'): string[] => {
  const base = [...customModelsForTier(t, false), ...(catalogModelsForTier(t) ?? MODEL_TIERS[t]), ...customModelsForTier(t, true)]
  if (t !== 'TIER_1_FREE') return base
  // Free tier: the strongest free models OpenRouter currently offers go first (ranked automatically), then the rest.
  const pinned = pinnedFree()
  const best = [...(pinned ? [pinned] : []), ...rankedFreeModels(4).filter((m) => m !== pinned)]
  return [...best, ...base.filter((m) => !best.includes(m))]
}

// Confidential projects: paid strong models only (no free tier, no custom/local ones).
export const strongPaidModels = (): string[] => tier('TIER_3_EXPENSIVE').filter((m) => !m.includes(':free') && !m.startsWith(CUSTOM_PREFIX))

export function getTierForAnalysis(analysis: Analysis): string[] {
  // A chat run carries its own mode (free / auto / model); outside a run the global free-only guard applies.
  const mode = currentMode()
  if (mode ? mode.kind === 'free' || (mode.kind === 'council' && freeOnly()) : freeOnly()) return tier('TIER_1_FREE')
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
    const res = await fetch(OPENROUTER_MODELS_API)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id).filter((id) => id.endsWith(':free'))
  } catch (err) {
    console.warn('fetchFreeModels failed:', err)
    return []
  }
}
