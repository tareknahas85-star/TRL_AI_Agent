import { MODEL_TIERS, OPENROUTER_MODELS_API } from './config'
import type { Analysis } from './master'

export function getTierForAnalysis(analysis: Analysis): string[] {
  switch (analysis.complexity) {
    case 'simple':
      return [...MODEL_TIERS.TIER_1_FREE, ...MODEL_TIERS.TIER_2_CHEAP]
    case 'medium':
      return [
        ...MODEL_TIERS.TIER_1_FREE,
        ...MODEL_TIERS.TIER_2_CHEAP,
        ...MODEL_TIERS.TIER_3_EXPENSIVE
      ]
    case 'complex':
      return [
        ...MODEL_TIERS.TIER_3_EXPENSIVE,
        ...MODEL_TIERS.TIER_2_CHEAP,
        ...MODEL_TIERS.TIER_1_FREE
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
