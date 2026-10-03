import { readJson, writeJson } from './json-store'

// Session-wide thinking effort. One setting; the app translates it for whichever model runs.
export type Effort = 'auto' | 'low' | 'medium' | 'high' | 'max'
const FILE = 'effort.json'
const LEVELS: Effort[] = ['auto', 'low', 'medium', 'high', 'max']

export const getEffort = (): Effort => {
  const v = readJson<{ level?: string }>(FILE, {}).level
  return (LEVELS as string[]).includes(v ?? '') ? (v as Effort) : 'auto'
}
export const setEffort = (v: unknown): Effort => {
  const level = (LEVELS as string[]).includes(String(v)) ? (v as Effort) : 'auto'
  writeJson(FILE, { level })
  return level
}

export type EffortRoute = 'openrouter' | 'openai' | 'gemini' | 'custom'
// Extra request fields that carry the effort for this provider/model; {} when the model has no such knob (or is on auto).
export function effortExtra(model: string, route: EffortRoute): Record<string, unknown> {
  const e = getEffort()
  if (e === 'auto' || route === 'custom' || model.includes(':free')) return {}
  const lvl = e === 'max' ? 'high' : e
  if (route === 'openai') return /gpt-5|(^|[^a-z])o[134]([^0-9]|$)/.test(model) ? { reasoning_effort: lvl } : {}
  if (route === 'gemini') return /gemini-(2\.5|3)/.test(model) ? { reasoning_effort: lvl } : {}
  return /claude|gpt-5|gemini-(2\.5|3)|grok|deepseek|qwen3/.test(model) ? { reasoning: { effort: lvl } } : {}
}
