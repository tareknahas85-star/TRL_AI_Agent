import { readJson, writeJson } from './json-store'
import { getPrefs } from './prefs'

// What the app has learned about its user, from use. Everything here is LOCAL (learning.json in the app data folder):
//  - only counters are stored, never message text, file names or client data;
//  - nothing from this file is ever sent to a model (it is only used on this device to rank tools and to draw the Memory page);
//  - confidential projects and scheduled/unattended runs are never recorded.

type ToolStat = { n: number; ok: number; last: number }
type Overrides = { lang?: string; length?: string; tone?: string }
type Profile = {
  v: 1
  since: number
  turns: number
  tools: Record<string, ToolStat>
  topics: Record<string, number>
  lang: Record<string, number>
  length: Record<string, number>
  tone: Record<string, number>
  hours: number[]
  forgotten: string[]
  overrides: Overrides
  corrections: number
  summary: { text: string; at: number }
  history: { at: number; level: number }[]
}

const FILE = 'learning.json'
const DAY = 24 * 3600 * 1000

const emptyProfile = (): Profile => ({
  v: 1,
  since: Date.now(),
  turns: 0,
  tools: {},
  topics: {},
  lang: {},
  length: {},
  tone: {},
  hours: Array(24).fill(0),
  forgotten: [],
  overrides: {},
  corrections: 0,
  summary: { text: '', at: 0 },
  history: []
})

function load(): Profile {
  const p = readJson<Partial<Profile>>(FILE, {})
  const e = emptyProfile()
  return {
    ...e,
    ...p,
    v: 1,
    tools: p.tools ?? {},
    topics: p.topics ?? {},
    lang: p.lang ?? {},
    length: p.length ?? {},
    tone: p.tone ?? {},
    hours: Array.isArray(p.hours) && p.hours.length === 24 ? p.hours : e.hours,
    forgotten: p.forgotten ?? [],
    overrides: p.overrides ?? {},
    history: p.history ?? []
  }
}
const save = (p: Profile): void => writeJson(FILE, p)

// Fixed interest taxonomy: a request counts toward a topic when it matches; the text itself is dropped.
export const TOPICS: { id: string; label: string; re: RegExp }[] = [
  { id: 'dev', label: 'برمجة وتطوير', re: /كود|برمج|\b(bug|function|typescript|javascript|python|git|github|api|repo|compile|npm|react|sql|regex|debug|refactor|code)\b/i },
  { id: 'cloud', label: 'سحابة وDevOps', re: /سحابة|\b(gcp|aws|azure|kubernetes|k8s|terraform|docker|helm|devops|ci\/cd|landing zone|vpc|iam|cloud|gke|cluster|pipeline)\b/i },
  { id: 'office', label: 'مكتب ووثائق', re: /مستند|جدول بيانات|عرض تقديمي|تقرير|بوربوينت|اكسل|إكسل|وورد|\b(word|excel|powerpoint|docx|xlsx|pptx|pdf|proposal|report|slides|spreadsheet)\b/i },
  { id: 'writing', label: 'كتابة وترجمة', re: /ترجم|صياغة|لخّص|لخص|اكتب لي|مقال|رسالة|بريد|\b(translate|rewrite|summari[sz]e|draft|email)\b/i },
  { id: 'research', label: 'بحث ومعلومات', re: /ابحث|دوّر|دور على|بحث|أخبار|اخبار|مصدر|\b(search|news|latest|research|compare|look up)\b/i },
  { id: 'design', label: 'تصميم ووسائط', re: /تصميم|شعار|صورة|فيديو|صوت|\b(design|logo|image|video|canva|figma|ui|ux|poster|audio)\b/i },
  { id: 'system', label: 'نظام وسكربتات', re: /سكربت|ويندوز|تسريع|تنظيف|بطء|\b(powershell|windows|script|registry|disk|cpu|ram|bat|bash|linux|driver)\b/i },
  { id: 'local', label: 'أماكن وطقس', re: /مطعم|صيدلية|قريب|أقرب|اقرب|طقس|خريطة|\b(near me|nearby|weather|map|restaurant|pharmacy)\b/i },
  { id: 'data', label: 'بيانات وتحليل', re: /بيانات|تحليل|رسم بياني|\b(database|csv|analysis|analytics|chart|dataset|query|dashboard)\b/i },
  { id: 'ai', label: 'ذكاء اصطناعي', re: /موديل|ذكاء اصطناعي|\b(prompt|llm|gpt|claude|gemini|agent|mcp|openrouter|model)\b/i },
  { id: 'study', label: 'شرح وتعلّم', re: /اشرح|شرح|تعلّم|تعلم|دورة|ليش|كيف بيشتغل|\b(explain|learn|tutorial|how does|why)\b/i }
]
const topicLabel = (id: string): string => TOPICS.find((t) => t.id === id)?.label ?? id

const SHAMI = /(^|\s)(شو|هلأ|هلق|كتير|بدي|ليش|هيك|منيح|يلا|مشان|عم|لسا|إيمتى|ايمتى|شلون|هاد|هيدا|هيدي|مو|فيني|بدك|حطلي|عطيني|قلي|خبرني)(\s|$)/
const MSA = /(ماذا|الآن|لماذا|كيف يمكن|أريد|يرجى|لا يمكن|هذا|هذه|سوف|نرجو)/
const FORMAL = /(يرجى|حضرتك|مع الاحترام|نرجو|\bplease\b|\bkindly\b|\bregards\b|\bdear\b)/i

export const LANG_LABEL: Record<string, string> = { shami: 'عربي شامي', msa: 'عربي فصيح', en: 'إنكليزي', mixed: 'عربي + إنكليزي' }
export const LENGTH_LABEL: Record<string, string> = { short: 'قصيرة', medium: 'متوسطة', long: 'طويلة ومفصّلة' }
export const TONE_LABEL: Record<string, string> = { casual: 'عادي وودّي', formal: 'رسمي' }

const bump = (o: Record<string, number>, k: string, n = 1): void => {
  o[k] = (o[k] ?? 0) + n
}
const isForgotten = (p: Profile, kind: string, key: string): boolean => p.forgotten.includes(kind + ':' + key)

// Group a tool name: "live-search__search" -> "live-search", pc_* -> pc_control, everything else as is.
export function toolGroup(name: string): string {
  if (name.includes('__')) return name.split('__')[0]
  if (name.startsWith('pc_')) return 'pc_control'
  return name
}

export function recordTurn(a: { userMsg: string; toolsUsed: string[]; ok: boolean; confidential: boolean; unattended: boolean }): void {
  const pr = getPrefs()
  if (!pr.learningEnabled || pr.learningPaused || a.confidential || a.unattended || !a.ok) return
  const p = load()
  const text = a.userMsg.split('\n[ملفات مرفقة')[0]
  p.turns++
  // language / length / tone of what the user wrote
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length
  const la = (text.match(/[A-Za-z]/g) ?? []).length
  if (ar + la >= 4) {
    const lang = ar > la * 2 ? (SHAMI.test(text) && !MSA.test(text) ? 'shami' : MSA.test(text) && !SHAMI.test(text) ? 'msa' : 'shami') : la > ar * 2 ? 'en' : 'mixed'
    if (!isForgotten(p, 'style', 'lang')) bump(p.lang, lang)
  }
  if (!isForgotten(p, 'style', 'length')) bump(p.length, text.length < 60 ? 'short' : text.length < 300 ? 'medium' : 'long')
  if (!isForgotten(p, 'style', 'tone')) bump(p.tone, FORMAL.test(text) ? 'formal' : 'casual')
  if (!isForgotten(p, 'style', 'hours')) p.hours[new Date().getHours()]++
  for (const t of TOPICS) if (t.re.test(text) && !isForgotten(p, 'topic', t.id)) bump(p.topics, t.id)
  for (const g of new Set(a.toolsUsed.map(toolGroup))) {
    if (isForgotten(p, 'tool', g)) continue
    const s = p.tools[g] ?? { n: 0, ok: 0, last: 0 }
    s.n++
    s.ok++
    s.last = Date.now()
    p.tools[g] = s
  }
  const lv = levelOf(p)
  const lastSnap = p.history[p.history.length - 1]
  if (!lastSnap || Date.now() - lastSnap.at > DAY) p.history.push({ at: Date.now(), level: lv })
  else lastSnap.level = lv
  if (p.history.length > 120) p.history = p.history.slice(-120)
  if (Date.now() - p.summary.at > 7 * DAY && p.turns >= 3) p.summary = { text: buildSummary(p), at: Date.now() }
  save(p)
}

/** How many times a tool group was used so far (0 when learning is off). */
export function toolUses(group: string): number {
  return load().tools[group]?.n ?? 0
}

// Used by the tool ranking: a small bonus for tool groups the user relies on. Never adds a tool on its own, only breaks ties.
export function toolPrior(group: string): number {
  const pr = getPrefs()
  if (!pr.learningEnabled || pr.learningPaused) return 0
  const s = load().tools[group]
  if (!s || s.n < 3) return 0
  return Math.min(3, Math.log2(s.n + 1) / 2)
}

function levelOf(p: Profile): number {
  const distinctTools = Object.keys(p.tools).length
  const distinctTopics = Object.keys(p.topics).length
  const score = p.turns + distinctTools * 3 + distinctTopics * 2 + p.corrections * 5
  return Math.min(95, Math.round(95 * (1 - Math.exp(-score / 120))))
}

const top = (o: Record<string, number>): [string, number][] => Object.entries(o).sort((a, b) => b[1] - a[1])
const pct = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0)

function dominant(o: Record<string, number>, override?: string): { key: string; share: number; overridden: boolean } | null {
  if (override) return { key: override, share: 100, overridden: true }
  const t = top(o)
  const total = t.reduce((a, [, n]) => a + n, 0)
  return t.length ? { key: t[0][0], share: pct(t[0][1], total), overridden: false } : null
}

function peakTime(hours: number[]): string {
  const total = hours.reduce((a, b) => a + b, 0)
  if (total < 5) return ''
  const buckets: [string, number][] = [
    ['الصبح', hours.slice(5, 12).reduce((a, b) => a + b, 0)],
    ['بعد الظهر', hours.slice(12, 18).reduce((a, b) => a + b, 0)],
    ['المسا', hours.slice(18, 24).reduce((a, b) => a + b, 0)],
    ['الليل', hours.slice(0, 5).reduce((a, b) => a + b, 0)]
  ]
  return buckets.sort((a, b) => b[1] - a[1])[0][0]
}

function buildSummary(p: Profile): string {
  const tp = top(p.topics)
    .slice(0, 3)
    .map(([k]) => topicLabel(k))
  const lang = dominant(p.lang, p.overrides.lang)
  const len = dominant(p.length, p.overrides.length)
  const tone = dominant(p.tone, p.overrides.tone)
  const tools = top(Object.fromEntries(Object.entries(p.tools).map(([k, v]) => [k, v.n])))
    .slice(0, 3)
    .map(([k]) => k)
  const pt = peakTime(p.hours)
  const parts: string[] = []
  if (tp.length) parts.push('بفهم إنك مهتم أكتر بـ ' + tp.join(' و'))
  const style: string[] = []
  if (lang) style.push('بتكتب ' + (LANG_LABEL[lang.key] ?? lang.key))
  if (len) style.push('برسائل ' + (LENGTH_LABEL[len.key] ?? len.key))
  if (tone) style.push('وبأسلوب ' + (TONE_LABEL[tone.key] ?? tone.key))
  if (style.length) parts.push(style.join(' '))
  if (pt) parts.push('وغالباً بتشتغل ' + pt)
  if (tools.length) parts.push('والأدوات يلي بتعتمد عليها: ' + tools.join('، '))
  return parts.length ? parts.join('، ') + '.' : 'لسا عم أتعرّف عليك — كل ما استعملتني أكتر بفهمك أحسن.'
}

export type LearnView = {
  enabled: boolean
  paused: boolean
  turns: number
  since: number
  level: number
  rings: { id: string; label: string; pct: number; detail: string; editable?: { kind: 'lang' | 'length' | 'tone'; options: { value: string; label: string }[]; current: string } }[]
  tools: { key: string; n: number }[]
  topics: { id: string; label: string; n: number; pct: number }[]
  summary: { text: string; at: number }
  history: { at: number; level: number }[]
}

export function learnView(): LearnView {
  const pr = getPrefs()
  const p = load()
  const lang = dominant(p.lang, p.overrides.lang)
  const len = dominant(p.length, p.overrides.length)
  const tone = dominant(p.tone, p.overrides.tone)
  const topicTotal = Object.values(p.topics).reduce((a, b) => a + b, 0)
  const distinctTools = Object.keys(p.tools).length
  const styleN = Object.values(p.lang).reduce((a, b) => a + b, 0)
  const pt = peakTime(p.hours)
  const hoursN = p.hours.reduce((a, b) => a + b, 0)
  const opts = (m: Record<string, string>): { value: string; label: string }[] => Object.entries(m).map(([value, label]) => ({ value, label }))
  const styleDetail = [lang ? LANG_LABEL[lang.key] : '', len ? LENGTH_LABEL[len.key] : '', tone ? TONE_LABEL[tone.key] : ''].filter(Boolean).join(' · ')
  const summaryNow = p.summary.text || (p.turns >= 1 ? buildSummary(p) : '')
  return {
    enabled: pr.learningEnabled,
    paused: pr.learningPaused,
    turns: p.turns,
    since: p.since,
    level: levelOf(p),
    rings: [
      { id: 'tools', label: 'الأدوات المفضّلة', pct: Math.min(95, Math.round((Math.min(distinctTools, 5) / 5) * 60 + Math.min(p.turns, 40) / 40 * 35)), detail: top(Object.fromEntries(Object.entries(p.tools).map(([k, v]) => [k, v.n]))).slice(0, 3).map(([k]) => k).join('، ') || 'لسا ما في' },
      { id: 'style', label: 'أسلوب الكتابة', pct: Math.min(95, Math.round(Math.min(styleN, 30) / 30 * 95)), detail: styleDetail || 'لسا ما في', editable: { kind: 'lang', options: opts(LANG_LABEL), current: lang?.key ?? '' } },
      { id: 'interests', label: 'مجالات الاهتمام', pct: Math.min(95, Math.round(Math.min(topicTotal, 25) / 25 * 95)), detail: top(p.topics).slice(0, 3).map(([k]) => topicLabel(k)).join('، ') || 'لسا ما في' },
      { id: 'times', label: 'أوقات الاستخدام', pct: Math.min(95, Math.round(Math.min(hoursN, 40) / 40 * 95)), detail: pt ? 'غالباً ' + pt : 'لسا ما في' }
    ],
    tools: top(Object.fromEntries(Object.entries(p.tools).map(([k, v]) => [k, v.n]))).slice(0, 12).map(([key, n]) => ({ key, n })),
    topics: top(p.topics).slice(0, 12).map(([id, n]) => ({ id, label: topicLabel(id), n, pct: pct(n, topicTotal) })),
    summary: { text: summaryNow, at: p.summary.at },
    history: p.history
  }
}

// ---- Controls ("wrong, fix it" / "forget this" / "start over") ----
export function forgetItem(kind: string, key: string): boolean {
  const p = load()
  if (kind === 'tool') delete p.tools[key]
  else if (kind === 'topic') delete p.topics[key]
  else return false
  const tag = kind + ':' + key
  if (!p.forgotten.includes(tag)) p.forgotten.push(tag)
  p.summary = { text: buildSummary(p), at: Date.now() }
  save(p)
  return true
}

export function correctStyle(kind: string, value: string): boolean {
  if (kind !== 'lang' && kind !== 'length' && kind !== 'tone') return false
  const p = load()
  if (value) p.overrides[kind] = value
  else delete p.overrides[kind]
  p.corrections++
  p.summary = { text: buildSummary(p), at: Date.now() }
  save(p)
  return true
}

export function resetLearning(): void {
  save(emptyProfile())
}

export function refreshSummary(): string {
  const p = load()
  p.summary = { text: buildSummary(p), at: Date.now() }
  save(p)
  return p.summary.text
}
