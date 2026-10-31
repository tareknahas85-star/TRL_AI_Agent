// فحوصات جودة الرد (بدون أي اعتماد على electron حتى تنختبر بسهولة).

// حلقة تكرار: الموديل المنهار بيعيد نفس الجملة بصيغ متقاربة. بنطبّع الجمل ونقارن أول 30 حرف.
export function looksLooping(text: string): boolean {
  const norm = (s: string): string => s.replace(/[*_#>`\-—:،,.!؟?()\[\]😊🚀\d]+/g, ' ').replace(/\s+/g, ' ').trim()
  const sents = text.split(/[\n.!؟?]+/).map(norm).filter((s) => s.length > 14)
  if (sents.length < 5) return false
  const count = new Map<string, number>()
  for (const s of sents) {
    const k = s.slice(0, 30)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const maxRep = Math.max(...count.values())
  return maxRep >= 4 || (sents.length >= 8 && count.size / sents.length < 0.45)
}

// رد مهمة تنفيذ بينتهي بسؤال "هل تريد أن أبدأ؟/هل عندك مشكلة؟" بدل ما ينفّذ: مو إنجاز.
export const ENDS_WITH_STALL = /(هل\s*(تريد|تبي|بدك)\s*(مني\s*)?(أن\s*)?(أبدأ|ابدأ|أكمل|اكمل)|هل\s*عندك\s*أي\s*مشكل|أبدأ\s*الآن\s*في\s*تنفيذ)[^\n]{0,60}$/

// الموديل بيدّعي إنو ما عنده أدوات/صلاحية.
export const REFUSES_TOOLS = /ما\s*(عندي|معي|لدي)\s*((أي|اي|ولا)\s*)?(أدوات|ادوات|صلاحية)|ما\s*(أقدر|اقدر)\s*(أنفّذ|أنفذ|انفذ|انفّذ|أرفع|ارفع)|no tools available|i (do not|don't|cannot|can't) (have|run|execute|access|upload)/i

// رد مو صالح كمثال/سكيل: رفض، وقوف عند سؤال، تكرار، أو تحذير من البرنامج.
export function badReplyReason(text: string): string | null {
  const t = text.trim()
  if (!t) return 'فاضي'
  if (t.includes('⚠️ تنبيه من البرنامج')) return 'فيه تحذير من البرنامج'
  if (looksLooping(t)) return 'تكرار'
  if (REFUSES_TOOLS.test(t)) return 'ادّعاء ما عندي أدوات'
  if (ENDS_WITH_STALL.test(t.slice(-220))) return 'وقف عند سؤال'
  return null
}

// ادّعاء نجاح بناء/اختبار.
export const BUILD_TEST_CLAIM = /(✅|تمّ?|نجح|ناجح|اشتغل|passed|success)[^\n]{0,50}(build|بناء|tsc|typecheck|lint|اختبار|test)|(build|بناء|tsc|typecheck|اختبار|tests?)[^\n]{0,40}(✅|نجح|ناجح|passed|success)/i

// هل في بين استدعاءات الأدوات أمر build/test/tsc فعلي ناتجو بدون أخطاء؟
export function hasBuildProof(calls: { key: string; out: string }[]): boolean {
  return calls.some((c) => /build|tsc|vitest|jest|pytest|npm\s+(run\s+)?test|lint|typecheck|dotnet\s+(build|test)|go\s+(build|test)|cargo\s+(build|test)/i.test(c.key) && !/error\s+TS\d+|ERR!|\bFAIL(ED)?\b|exit code:?\s*[1-9]|Exit:?\s*[1-9]/i.test(c.out))
}

// موديلات خفيفة: ما بتنفّذ مهام بناء بأدوات الجهاز بثقة (وضع بناء مشروع).
export const WEAK_MODEL = /(?:^|[-_/.:\s])(?:flash|lite|mini|nano|free)(?:$|[-_/.:\s])/i

// بورتات localhost يلي الرد بيدّعي إنها شغّالة (بنتحقق منها فعلياً بعدين).
export function claimedPorts(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})\b/gi)) {
    const p = Number(m[1])
    if (p >= 1024 && p <= 65535 && !out.includes(p)) out.push(p)
  }
  return out.slice(0, 3)
}
