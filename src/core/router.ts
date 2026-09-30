import { MODEL_TIERS, OPENROUTER_MODELS_API } from './config'
import type { Analysis } from './master'
import { customModelsForTier } from './custom-models'
import { catalogModelsForTier } from './catalog'
import { freeOnly } from './spend'
import { currentMode } from './progress'

// Built-in tiers plus the user's enabled custom models (custom ones are tried first inside their tier).
const tier = (t: 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'): string[] => [
  ...customModelsForTier(t, false),
  ...(catalogModelsForTier(t) ?? MODEL_TIERS[t]),
  ...customModelsForTier(t, true)
]

export function getTierForAnalysis(analysis: Analysis): string[] {
  // A chat run carries its own mode (free / auto / model); outside a run the global free-only guard applies.
  const mode = currentMode()
  if (mode ? mode.kind === 'free' : freeOnly()) return tier('TIER_1_FREE')
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
