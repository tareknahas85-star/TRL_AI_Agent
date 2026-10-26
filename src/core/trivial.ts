// 5.17.3: الطلبات الصغيرة (تحية، سؤال قصير، تاريخ اليوم، الطقس) ما بتحتاج أدوات ولا تفكير.
// بتروح: المحلي (Ollama) أولاً، وإذا ما رد بسرعة أول موديل مجاني شغّال. التاريخ والطقس بيجيبهم البرنامج بنفسو.
import { needsFreshInfo, needsLocation } from './guidance'
import { listOllamaModelsDetailed, ollamaState, OLLAMA_BASE } from './ollama'
import { localChatModel, LOCAL_AUTO } from './local-chat'

export const TRIVIAL_MAX_CHARS = 100
export const LOCAL_TIMEOUT_MS = 12000
export const BAD_COOLDOWN_MS = 10 * 60 * 1000
export const GOOD_TTL_MS = 30 * 60 * 1000
export const DEFAULT_CITY = 'Damascus'

// أي إشارة لملف/مشروع/تنفيذ/كتابة كود = مو بسيط، بيضل على المسار الكامل (أدوات).
const ACTION_RE =
  /ملف|ملفات|مجلد|مشروع|افتح|اقرأ|راجع|حلل|ولّد|ولد|بني|ابني|بناء|احفظ|انقل|انسخ|شغّل|شغل|نفّذ|نفذ|ثبّت|اعمل|عدّل|عدل|اكتب|كود|سكريبت|ابحث|دوّر|ارسم|رسم|صورة|صور|لوحة|شعار|لوغو|فيديو|كولاب|كومبوزيو|\.[a-z0-9]{1,5}\b|\b(file|folder|project|readme|open|read|review|analy[sz]e|build|compile|save|install|deploy|execute|run|code|script|search|fix|write|image|images|picture|draw|logo|video|colab|composio|huggingface|hfspace)\b/i
export const DATE_RE = /تاريخ اليوم|تاريخ هلق|شو اليوم|أي يوم|اي يوم|كم الساعة|الساعة كم|الوقت هلق|what('s| is) (the )?(date|time|day)|today'?s date|what time/i
export const WEATHER_RE = /طقس|الجو |الجو$|درجة الحرارة|حرارة|weather|temperature/i

const GREETING_RE = /^(كيفك|كيف حالك|شلونك|شو أخبارك|شو اخبارك|مرحبا|هلا|أهلين|اهلين|صباح|مساء|how are you|hello|hi\b)/i

export function isTrivialChat(input: string): boolean {
  const s = (input ?? '').trim()
  if (!s || s.length > TRIVIAL_MAX_CHARS) return false
  if (s.includes('[ملفات مرفقة')) return false
  if (ACTION_RE.test(s)) return false
  const handled = DATE_RE.test(s) || WEATHER_RE.test(s) || GREETING_RE.test(s)
  if (!handled && (needsFreshInfo(s) || needsLocation(s))) return false
  return true
}

// المحلي بس لمحادثة خفيفة (تحية/تاريخ/طقس جاهز من البرنامج): الموديل الصغير بيغلط بالمعلومات العامة، فالأسئلة التانية بتروح للمجاني.
export function localSuitable(input: string): boolean {
  return GREETING_RE.test(input.trim()) || DATE_RE.test(input) || WEATHER_RE.test(input)
}

// اختيار الموديل المحلي بدون أي ترتيب ثابت حسب الاسم. المبدأ:
//  1) اللي اختاره المستخدم من الإعدادات (دايماً بيتجرّب).
//  2) تلقائي: بنستبعد اللي فشل/تأخّر مؤخراً (تبريد 10 دقايق)، وبنفضّل الأسرع حسب قياسنا الفعلي،
//     وإذا ما في قياس بعد، الأصغر حجماً (الأصغر غالباً الأسرع). ما بنعتمد على الاسم.
export type LocalModelInfo = { name: string; size: number }
const localOk = new Map<string, { ms: number; t: number }>()
const localBad = new Map<string, number>()

export function noteLocal(model: string, ok: boolean, ms: number, now = Date.now()): void {
  if (ok) {
    localOk.set(model, { ms, t: now })
    localBad.delete(model)
  } else {
    localBad.set(model, now)
  }
}

export function pickLocalModel(models: LocalModelInfo[], opts: { chosen?: string | null; now?: number } = {}): string | null {
  const now = opts.now ?? Date.now()
  const chat = models.filter((m) => !/embed|rerank/i.test(m.name))
  if (opts.chosen && chat.some((m) => m.name === opts.chosen)) return opts.chosen
  const live = chat.filter((m) => now - (localBad.get(m.name) ?? -Infinity) > BAD_COOLDOWN_MS)
  if (!live.length) return null
  const measured = live.filter((m) => {
    const o = localOk.get(m.name)
    return o && now - o.t <= GOOD_TTL_MS
  })
  if (measured.length) return measured.sort((a, b) => localOk.get(a.name)!.ms - localOk.get(b.name)!.ms)[0].name
  return [...live].sort((a, b) => a.size - b.size)[0].name
}

// موديلات عائلة qwen3 بتفكّر بصوت عالي إلا إذا انطلب منها بالنص. باقي الموديلات ما بتحتاج.
export const needsNoThink = (model: string): boolean => /qwen3/i.test(model)

// الموديلات الصغيرة أحياناً بتدخّل صيني/ياباني/كوري بنص الجواب العربي: رد هيك ما منعتمده.
export function hasCjk(text: string): boolean {
  return /[぀-ヿ㐀-鿿가-힯]/.test(text)
}

export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

// ذاكرة قصيرة المدى (بالذاكرة فقط): آخر موديل نجح بيتقدّم، واللي فشل بيتأجّل 10 دقايق.
const good = new Map<string, number>()
const bad = new Map<string, number>()

export function resetTrivialState(): void {
  good.clear()
  bad.clear()
  localOk.clear()
  localBad.clear()
}

export function noteResult(failed: string[], ok: string | undefined, now = Date.now()): void {
  for (const m of failed) bad.set(m, now)
  if (ok) {
    good.set(ok, now)
    bad.delete(ok)
  }
}

export function preferGood(models: string[], now = Date.now()): string[] {
  const live = models.filter((m) => now - (bad.get(m) ?? -Infinity) > BAD_COOLDOWN_MS)
  const list = live.length ? live : models
  let best: string | null = null
  let bestT = -Infinity
  for (const m of list) {
    const t = good.get(m)
    if (t !== undefined && now - t <= GOOD_TTL_MS && t > bestT) {
      best = m
      bestT = t
    }
  }
  return best ? [best, ...list.filter((m) => m !== best)] : list
}

export type LocalAnswer = { content: string; model: string; ms: number }

export async function tryLocalChat(
  input: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  system: string,
  signal?: AbortSignal
): Promise<LocalAnswer | null> {
  let lastModel: string | null = null
  try {
    // ما منشغّل Ollama تلقائياً هون: إذا مطفي بننزل للمجاني فوراً.
    if ((await ollamaState()) !== 'running') return null
    // الافتراضي: بدون محلي (المجاني أنضف وأسرع على الأجهزة العادية). المحلي بس إذا المستخدم فعّلو من الإعدادات:
    // اسم موديل = ثابت، 'auto' = البرنامج بيقيس وبيختار.
    const sel = localChatModel()
    if (!sel) return null
    const model = pickLocalModel(await listOllamaModelsDetailed(), { chosen: sel === LOCAL_AUTO ? null : sel })
    if (!model) return null
    lastModel = model
    const t0 = Date.now()
    const timeout = AbortSignal.timeout(LOCAL_TIMEOUT_MS)
    const r = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        reasoning_effort: 'none',
        max_tokens: 700,
        messages: [{ role: 'system', content: system }, ...history.slice(-6), { role: 'user', content: needsNoThink(model) ? input + ' /no_think' : input }]
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    if (!r.ok) {
      noteLocal(model, false, Date.now() - t0)
      return null
    }
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const content = stripThink(j.choices?.[0]?.message?.content ?? '')
    const ms = Date.now() - t0
    const good = !!content && !hasCjk(content)
    noteLocal(model, good, ms)
    return good ? { content, model, ms } : null
  } catch (e) {
    // إلغاء المستخدم مو ذنب الموديل؛ المهلة/الخطأ بيأجّلوه 10 دقايق (إلا إذا هو اختيار المستخدم، بيتجرّب كل مرة).
    if (!signal?.aborted) {
      const m = lastModel
      if (m) noteLocal(m, false, Date.now())
    }
    void e
    return null
  }
}

// ---- معلومات حيّة بتجيبها الـapp بنفسها (بدون أدوات ولا موديل) ----

export function dateContext(now = new Date()): string {
  const ar = now.toLocaleString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return 'التاريخ والوقت الحاليين (من ساعة الجهاز): ' + ar + ' | ' + now.toString()
}

const WMO: Record<number, string> = {
  0: 'صافي', 1: 'غالباً صافي', 2: 'غيوم متفرقة', 3: 'غائم', 45: 'ضباب', 48: 'ضباب كثيف',
  51: 'رذاذ خفيف', 53: 'رذاذ', 55: 'رذاذ كثيف', 61: 'مطر خفيف', 63: 'مطر', 65: 'مطر غزير',
  71: 'ثلج خفيف', 73: 'ثلج', 75: 'ثلج كثيف', 80: 'زخات مطر', 81: 'زخات مطر قوية', 82: 'زخات عنيفة',
  95: 'عاصفة رعدية', 96: 'عاصفة رعدية مع برد', 99: 'عاصفة رعدية قوية'
}

export function cityFrom(input: string): string {
  const m = input.match(/(?:\bin\s+|في\s+|عن\s+)([؀-ۿA-Za-z]{3,})|(?:^|\s)(ب[؀-ۿ]{3,})/i)
  return m ? cityAlias(m[1] ?? m[2]) : DEFAULT_CITY
}

// أسماء محكية شائعة بتتحوّل للاسم اللي بيفهمو محرّك البحث عن المدن.
const CITY_ALIAS: Record<string, string> = { الشام: 'دمشق', بالشام: 'دمشق', شام: 'دمشق', بشام: 'دمشق' }
export function cityAlias(name: string): string {
  return CITY_ALIAS[name] ?? name
}

async function geocode(name: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const q = async (n: string) => {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=ar&name=' + encodeURIComponent(n), { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const j = (await r.json()) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] }
    const x = j.results?.[0]
    return x ? { lat: x.latitude, lon: x.longitude, label: x.name + (x.country ? '، ' + x.country : '') } : null
  }
  const full = await q(name)
  if (!name.startsWith('ب') || name.length <= 3 || full?.label.split('،')[0] === name) return full
  // "بدمشق" = ب + دمشق: نفضّل النتيجة اللي اسمها بيطابق بالضبط.
  const stripped = await q(name.slice(1))
  return stripped && stripped.label.split('،')[0] === name.slice(1) ? stripped : (full ?? stripped)
}

export async function weatherContext(input: string): Promise<string> {
  try {
    const place = await geocode(cityFrom(input))
    if (!place) return 'تعذّر تحديد المدينة المطلوبة للطقس، اسأل المستخدم عن اسمها.'
    const u =
      'https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lon +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7'
    const r = await fetch(u, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return 'تعذّر جلب الطقس (خدمة الطقس ما ردّت).'
    const j = (await r.json()) as {
      current?: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number }
      daily?: { time?: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] }
    }
    const c = j.current
    const d = j.daily
    if (!c || !d) return 'تعذّر جلب الطقس.'
    return (
      'الطقس الحالي بـ' + place.label + ' (من Open-Meteo): ' + (WMO[c.weather_code] ?? 'غير محدد') + '، الحرارة ' + c.temperature_2m + '° (الإحساس ' + c.apparent_temperature +
      '°)، الرطوبة ' + c.relative_humidity_2m + '%، الرياح ' + c.wind_speed_10m + ' كم/س. اليوم: ' + d.temperature_2m_min[0] + '° إلى ' + d.temperature_2m_max[0] +
      '°، احتمال المطر ' + d.precipitation_probability_max[0] + '%. بكرا: ' + d.temperature_2m_min[1] + '° إلى ' + d.temperature_2m_max[1] + '°.' +
      '\nتوقع الأيام السبعة الجاية (تاريخ: أدنى–أعلى، احتمال المطر): ' +
      d.temperature_2m_max.map((hi, i) => (d.time?.[i] ?? 'يوم ' + (i + 1)) + ': ' + d.temperature_2m_min[i] + '–' + hi + '°، ' + d.precipitation_probability_max[i] + '%').join(' | ')
    )
  } catch {
    return 'تعذّر جلب الطقس (ما في اتصال بخدمة الطقس).'
  }
}

// نص بيتضاف للـprompt بالمسار البسيط: التاريخ دايماً (رخيص)، والطقس بس إذا انطلب.
export async function liveContext(input: string): Promise<string> {
  const parts = [dateContext()]
  if (WEATHER_RE.test(input)) parts.push(await weatherContext(input))
  return (
    '\n\nمعلومات حيّة جابها البرنامج (موثوقة):\n' + parts.join('\n') +
    '\nقواعد الرد: جاوب بالشامي المحكي بجمل قصيرة وبدون مقدمات أو إيموجي زايدة. اعتمد على الأرقام اللي فوق بس، ولا تخترع معلومات أو أسماء أو أماكن مو مذكورة. إذا السؤال ما إلو علاقة بالمعلومات اللي فوق ما تقحمها.'
  )
}
