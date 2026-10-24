// Direct-provider prices (USD per 1M tokens, standard paid tier) for models that are not in the OpenRouter catalog.
// Source: Google's public Gemini API pricing page (ai.google.dev/gemini-api/docs/pricing), checked 2026-10-13.
// Notes: gemini-3.6/3.8-flash are scheduled to rise to 1.50/7.50 on 2027-01-01; Pro prompts over 200k tokens cost more
// than listed here. A price the user types on a custom model always wins over this table.
export type Price = { in: number; out: number }

const TABLE: [RegExp, Price][] = [
  [/gemini-3\.[678]-flash(?!-)/, { in: 0.75, out: 3.75 }],
  [/gemini-3\.5-flash(?!-)/, { in: 1.5, out: 9 }],
  [/gemini-3\.5-flash-lite/, { in: 0.3, out: 2.5 }],
  [/gemini-3\.1-flash-lite/, { in: 0.25, out: 1.5 }],
  [/gemini-3-flash/, { in: 0.5, out: 3 }],
  [/gemini-3\.1-pro/, { in: 2, out: 12 }],
  [/gemini-2\.5-pro/, { in: 1.25, out: 10 }],
  [/gemini-2\.5-flash-lite/, { in: 0.1, out: 0.4 }],
  [/gemini-2\.5-flash(?!-)/, { in: 0.3, out: 2.5 }]
]
const NOT_TEXT = /image|tts|live|transcribe|omni|translate|embedding/i

export function knownPrice(modelId: string): Price | null {
  const id = String(modelId || '').toLowerCase().replace(/^models\//, '')
  if (!id || NOT_TEXT.test(id)) return null
  for (const [re, p] of TABLE) if (re.test(id)) return p
  return null
}

export const costOf = (p: Price, promptTokens: number, completionTokens: number): number =>
  (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out