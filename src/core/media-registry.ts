// Registry of every way the app can make an image / video / audio: the user's own API keys, free no-key
// endpoints, the Gemini web account (driven over Chrome), local voices, and websites that are only opened.
// Pure data + helpers (no electron) so it can be unit-tested. The UI renders this list; the generator walks it.

export type MediaKind = 'image' | 'video' | 'audio'
export type MediaRoute = 'chrome' | 'api' | 'http' | 'local' | 'site' | 'custom'
export type KeyName = 'GEMINI_API_KEY' | 'HUGGINGFACE_API_KEY' | 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY'

export interface MediaModel {
  id: string
  kind: MediaKind
  label: string
  /** What it is best at (one line, Shami). */
  best: string
  /** Daily limit in words, shown next to the model. */
  limitText: string
  /** Numeric daily cap used by the local counter; 0 = no fixed cap we can know. */
  dailyCap: number
  route: MediaRoute
  /** Lower = tried first in "auto". */
  priority: number
  key?: KeyName
  /** Needs the "free only" guard OFF (the key may be a paid one). */
  paidRisk?: boolean
  /** Why it cannot be used right now (custom models decide this themselves). */
  blocked?: string
  /** For route 'custom': id of the user-added model. */
  customId?: string
  /** For route 'site': the page to open. */
  url?: string
  /** Brand color for the little badge. */
  color: string
}

export const MEDIA_MODELS: MediaModel[] = [
  {
    id: 'gemini-web-image', kind: 'image', label: 'Gemini Nano Banana', route: 'chrome', priority: 1, color: '#4285f4', dailyCap: 0,
    best: 'الأقوى: واقعية، تعديل على صورة، نص جوا الصورة، ثبات الشخصية',
    limitText: 'حسب اشتراك Google AI تبعك (حسابك المدفوع)'
  },
  {
    id: 'hf-flux', kind: 'image', label: 'FLUX.1 schnell (Hugging Face)', route: 'api', priority: 2, color: '#ffb000', dailyCap: 0, key: 'HUGGINGFACE_API_KEY',
    best: 'سريع وجودة ممتازة بالصور العامة والواقعية',
    limitText: 'رصيد HF المجاني الشهري (بيخلص وبيرجع بالشهر الجاي)'
  },
  {
    id: 'pollinations', kind: 'image', label: 'Pollinations (بدون مفتاح)', route: 'http', priority: 3, color: '#7c4dff', dailyCap: 0,
    best: 'ما بده حساب ولا مفتاح، مناسب للتجارب السريعة. الجودة متوسطة وممكن يتأخر',
    limitText: 'مجاني بحدود غير معلنة (ممكن يرفض بعد كم صورة ورا بعض)'
  },
  {
    id: 'gemini-api-image', kind: 'image', label: 'Gemini API (flash image)', route: 'api', priority: 4, color: '#34a853', dailyCap: 0, key: 'GEMINI_API_KEY', paidRisk: true,
    best: 'نفس عيلة Nano Banana بدون Chrome. مفعّل بس لما "مجاني فقط" مطفي (المفتاح ممكن يكون مدفوع)',
    limitText: 'حسب كوتا مفتاحك'
  },
  { id: 'site-leonardo', kind: 'image', label: 'Leonardo.ai', route: 'site', priority: 20, color: '#8e24aa', dailyCap: 0, url: 'https://app.leonardo.ai/', best: 'ستايلات فنية وشخصيات وألعاب', limitText: '150 token باليوم (حوالي 10-15 صورة)' },
  { id: 'site-ideogram', kind: 'image', label: 'Ideogram', route: 'site', priority: 21, color: '#00acc1', dailyCap: 0, url: 'https://ideogram.ai/', best: 'نص جوا الصور: شعارات وبوسترات', limitText: '30 credit بالأسبوع (مو باليوم)' },
  { id: 'site-designer', kind: 'image', label: 'Microsoft Designer', route: 'site', priority: 22, color: '#0078d4', dailyCap: 0, url: 'https://designer.microsoft.com/', best: 'تصميم سريع وسوشال ميديا وقوالب', limitText: 'boosts يومية (العدد بيظهر جوا حسابك)' },
  { id: 'site-canva', kind: 'image', label: 'Canva', route: 'site', priority: 23, color: '#00c4cc', dailyCap: 0, url: 'https://www.canva.com/ai-image-generator/', best: 'تصميم كامل (بوستر، عرض، ريلز). الصورة جزء منو', limitText: '50 استخدام Magic Studio بالشهر' },
  {
    id: 'gemini-web-video', kind: 'video', label: 'Gemini Veo', route: 'chrome', priority: 1, color: '#4285f4', dailyCap: 0,
    best: 'فيديو قصير بجودة عالية من وصف نصي (بياخد من دقيقة لـ 8 دقايق)',
    limitText: 'حسب كوتا اشتراك Google AI اليومية'
  },
  { id: 'site-leonardo-video', kind: 'video', label: 'Leonardo (فيديو)', route: 'site', priority: 20, color: '#8e24aa', dailyCap: 0, url: 'https://app.leonardo.ai/', best: 'تحريك صور وفيديو قصير', limitText: 'بياكل من tokens اليومية (150)' },
  { id: 'site-morphic', kind: 'video', label: 'Morphic Studio', route: 'site', priority: 21, color: '#e91e63', dailyCap: 0, url: 'https://studio.morphic.com/', best: 'أفلام وورك فلو فيديو بمراجع', limitText: 'ما لقيت رقم موثّق' },
  {
    id: 'windows-voice', kind: 'audio', label: 'أصوات ويندوز (محلي)', route: 'local', priority: 1, color: '#607d8b', dailyCap: 0,
    best: 'تحويل نص لصوت بدون إنترنت وبدون حدود (صوت عربي ذكوري Naayf + أصوات إنجليزي)',
    limitText: 'بلا حدود (بيشتغل على جهازك)'
  },
  {
    id: 'hf-mms-ara', kind: 'audio', label: 'MMS عربي (Hugging Face)', route: 'api', priority: 2, color: '#ffb000', dailyCap: 0, key: 'HUGGINGFACE_API_KEY',
    best: 'نطق عربي من موديل Meta MMS. أوضح من صوت ويندوز، بس رتيب',
    limitText: 'رصيد HF المجاني الشهري'
  }
]

export interface Usage {
  day: string
  counts: Record<string, number>
}

export const dayStamp = (d = new Date()): string => d.toISOString().slice(0, 10)

/** Usage resets when the day changes. */
export function rollUsage(u: Usage | undefined, today = dayStamp()): Usage {
  return u && u.day === today && u.counts && typeof u.counts === 'object' ? u : { day: today, counts: {} }
}

export function bumpUsage(u: Usage, id: string, today = dayStamp()): Usage {
  const r = rollUsage(u, today)
  return { day: r.day, counts: { ...r.counts, [id]: (r.counts[id] ?? 0) + 1 } }
}

export interface ModelStatus extends MediaModel {
  available: boolean
  /** Why it is unavailable (Shami), empty when available. */
  reason: string
  usedToday: number
}

export function describeModels(kind: MediaKind, ctx: { hasKey: (k: KeyName) => boolean; freeOnly: boolean; usage: Usage; extra?: MediaModel[] }): ModelStatus[] {
  const u = rollUsage(ctx.usage)
  return [...MEDIA_MODELS, ...(ctx.extra ?? [])]
    .filter((m) => m.kind === kind)
    .map((m): ModelStatus => {
      let reason = m.blocked ?? ''
      if (reason) {
        /* custom model decided */
      } else if (m.key && !ctx.hasKey(m.key)) reason = 'ما في مفتاح ' + m.key
      else if (m.paidRisk && ctx.freeOnly) reason = 'وضع "مجاني فقط" شغّال (المفتاح ممكن يكون مدفوع)'
      else if (m.dailyCap > 0 && (u.counts[m.id] ?? 0) >= m.dailyCap) reason = 'خلص حدّ اليوم'
      return { ...m, available: !reason, reason, usedToday: u.counts[m.id] ?? 0 }
    })
    .sort((a, b) => a.priority - b.priority)
}

/** Auto mode order: available, non-site models by priority. */
export function autoOrder(list: ModelStatus[]): ModelStatus[] {
  return list.filter((m) => m.available && m.route !== 'site')
}
