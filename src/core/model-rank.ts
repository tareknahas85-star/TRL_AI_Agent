// 5.18.0: ترتيب الموديلات بالقوة بغض النظر عن المنصة (OpenRouter / APInex / Hugging Face / ...).
// الدرجة = جدول مُصانة يدوياً للعائلات المعروفة + تقدير تلقائي من الاسم (الحجم، الإصدار، كلمات مثل flash/mini).
// هي تقدير مو قياس حقيقي؛ القياس الفعلي (probe) اختياري ومحفوظ بملف منفصل.

type Rule = { re: RegExp; score: number }

// الأعلى أقوى. أول تطابق بيربح (الأخص أولاً).
const FAMILY: Rule[] = [
  { re: /claude[-_. ]?opus/i, score: 98 },
  { re: /gpt[-_. ]?6(?![-_. ]?(luna|mini|nano))/i, score: 97 },
  { re: /gpt[-_. ]?5(?![-_. ]?(mini|nano))/i, score: 94 },
  { re: /gemini[-_. ]?3(\.\d+)?[-_. ]?pro/i, score: 95 },
  { re: /gemini[-_. ]?2\.5[-_. ]?pro/i, score: 90 },
  { re: /claude[-_. ]?sonnet/i, score: 93 },
  { re: /grok[-_. ]?[4-9]/i, score: 91 },
  { re: /kimi[-_. ]?k[23]/i, score: 90 },
  { re: /qwen[-_. ]?3\.\d+[-_. ]?max/i, score: 90 },
  { re: /deepseek[-_. ]?v4[-_. ]?pro/i, score: 90 },
  { re: /deepseek[-_. ]?(r1|v3)/i, score: 86 },
  { re: /glm[-_. ]?5(\.\d+)?[-_. ]?flash/i, score: 66 },
  { re: /minimax[-_. ]?m3(\.\d+)?[-_. ]?flash/i, score: 66 },
  { re: /glm[-_. ]?5(\.\d+)?/i, score: 88 },
  { re: /minimax[-_. ]?m3/i, score: 87 },
  { re: /mimo[-_. ]?v2(\.\d+)?[-_. ]?pro/i, score: 84 },
  { re: /llama[-_. ]?4[-_. ]?maverick/i, score: 82 },
  { re: /gpt[-_. ]?oss[-_. ]?120b/i, score: 80 },
  { re: /qwen[-_. ]?3[-_. ]?coder/i, score: 80 },
  { re: /muse[-_. ]?spark/i, score: 70 },
  { re: /gemini[-_. ]?\d(\.\d+)?[-_. ]?flash/i, score: 70 },
  { re: /deepseek[-_. ]?v4/i, score: 74 },
  { re: /llama[-_. ]?3\.3/i, score: 62 },
  { re: /gemma[-_. ]?[34]/i, score: 58 },
  { re: /qwen/i, score: 60 },
  { re: /mistral|mixtral/i, score: 56 },
  { re: /llama/i, score: 52 }
]

const WEAK = /(?:^|[-_/.: ])(flash|lite|mini|nano|luna|small|tiny|haiku|air|instruct-?0|distill)(?:$|[-_/.: x0-9])/i

export function estimateStrength(id: string): number {
  const s = id.replace(/^(apinex:|custom:)/i, '')
  let base = 45
  for (const r of FAMILY) {
    if (r.re.test(s)) {
      base = r.score
      break
    }
  }
  // الحجم بالمليار (مثلاً 70b، 235b-a22b ناخد الأول)
  const sz = s.match(/(\d{1,4}(?:\.\d+)?)\s?b(?![a-z])/i)
  if (sz) {
    const b = parseFloat(sz[1])
    if (b > 0) base += Math.max(-12, Math.min(10, (Math.log2(b) - 5) * 2.2))
  }
  if (WEAK.test(s) && !/flash/i.test(s)) base -= 6
  if (/pro\b/i.test(s)) base += 2
  if (/max\b/i.test(s)) base += 2
  if (/:free$/i.test(s)) base -= 1
  return Math.round(Math.max(1, Math.min(100, base)) * 10) / 10
}

export type RankedModel = { id: string; platform: string; score: number; tools?: boolean; free?: boolean }

export function rankModels<T extends { id: string }>(items: T[]): (T & { score: number })[] {
  return items.map((m) => ({ ...m, score: estimateStrength(m.id) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

// نفس الموديل على أكثر من منصة (بعد شيل البادئة والـ :free والـ free/) — بنخلي الأول حسب الترتيب المعطى.
export function canonicalName(id: string): string {
  return id
    .replace(/^(apinex:|custom:)/i, '')
    .replace(/^[a-z0-9-]+\//i, '')
    .replace(/:free$/i, '')
    .toLowerCase()
}
