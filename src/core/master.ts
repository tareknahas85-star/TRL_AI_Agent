import { hostOf } from './hosts'
import OpenAI from 'openai'
import { MASTER_MODELS } from './config'
import { skillCatalog } from '../skills/loader'
import { emitProgress, currentSignal } from './progress'

// Small local maestro (Ollama). Used first when the model is installed; falls back to the OpenRouter maestros.
const LOCAL_MASTER = 'qwen3:1.7b'
const LOCAL_BASE = 'http://127.0.0.1:11434'
let localCheck: { at: number; ok: boolean } = { at: 0, ok: false }
async function localMasterAvailable(): Promise<boolean> {
  if (Date.now() - localCheck.at < 30000) return localCheck.ok
  let ok = false
  try {
    const r = await fetch(LOCAL_BASE + '/api/tags', { signal: AbortSignal.timeout(1500) })
    const j = (await r.json()) as { models?: { name: string }[] }
    ok = !!j.models?.some((m) => m.name === LOCAL_MASTER)
  } catch {
    ok = false
  }
  localCheck = { at: Date.now(), ok }
  return ok
}

// Keyword pre-filter so a small maestro only sees the few most relevant skills.
function topSkillsScored(input: string, all: { name: string; description: string }[], n = 8) {
  const words = new Set(input.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const scored = all
    .map((c) => {
      const hay = (c.name.replace(/[-_]/g, ' ') + ' ' + c.description).toLowerCase()
      let sc = 0
      for (const w of words) if (hay.includes(w)) sc += c.name.toLowerCase().includes(w) ? 3 : 1
      return { c, sc }
    })
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, n)
  return scored
}

export type Analysis = {
  complexity: 'simple' | 'medium' | 'complex'
  type: 'chat' | 'code' | 'research' | 'file_task'
  need_skill: 'none' | 'delegate-coding' | 'delegate-research' | 'delegate-file'
  need_tools: boolean
  reason: string
  skill?: string // optional imported skill picked by the maestro
  source?: string // which maestro answered: local | openrouter | fallback
  masterModel?: string
}


const SYSTEM_PROMPT =
  'You are a request classifier. Analyze the user request and return ONLY valid JSON without markdown. ' +
  'Format: {"complexity":"simple|medium|complex","type":"chat|code|research|file_task","need_skill":"none|delegate-coding|delegate-research|delegate-file","need_tools":true/false,"reason":"short reason"} ' +
  'Rules: simple=general chat/translation/summary, medium=simple code/explanation, complex=full project/file operations/multi-step. ' +
  'If request mentions code/programming/bug/fix/write function -> need_skill=delegate-coding and need_tools=true. ' +
  'If research/search -> delegate-research. ' +
  'Set need_tools=true also when the user asks for live/system data (CPU, memory, disk, processes), reading files, searching the web, or using an external service or connected app. Also set need_tools=true when the user asks to operate/control the computer: open or close a program, click, type, take a screenshot, run a system command, or manage files on the PC.'

const COMPLEXITIES: Analysis['complexity'][] = ['simple', 'medium', 'complex']
const TYPES: Analysis['type'][] = ['chat', 'code', 'research', 'file_task']
// need_skill values map to folders in src/skills/delegate-skills:
// delegate-coding -> coding/, delegate-research -> research/, delegate-file -> file/ (not created yet)
const SKILLS: Analysis['need_skill'][] = [
  'none',
  'delegate-coding',
  'delegate-research',
  'delegate-file'
]

function fallbackAnalysis(): Analysis {
  return {
    complexity: 'simple',
    type: 'chat',
    need_skill: 'none',
    need_tools: false,
    reason: 'fallback',
    source: 'fallback'
  }
}

let client: OpenAI | null = null
let clientKey: string | undefined

// Created lazily, and re-created if the key changes (e.g. saved from the Settings screen).
function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!client || clientKey !== apiKey + hostOf('openrouter')) {
    client = new OpenAI({
      baseURL: hostOf('openrouter'),
      apiKey,
      timeout: 25000, // fail fast so the next maestro model gets a turn
      maxRetries: 0
    })
    clientKey = apiKey + hostOf('openrouter')
  }
  return client
}

function parseAnalysis(text: string, skillNames: string[] = []): Analysis | null {
  const match = text.match(/\{.*\}/s)
  if (!match) return null

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0])
  } catch {
    return null
  }

  if (
    !COMPLEXITIES.includes(raw.complexity as Analysis['complexity']) ||
    !TYPES.includes(raw.type as Analysis['type']) ||
    !SKILLS.includes(raw.need_skill as Analysis['need_skill']) ||
    typeof raw.need_tools !== 'boolean'
  ) {
    return null
  }

  return {
    complexity: raw.complexity as Analysis['complexity'],
    type: raw.type as Analysis['type'],
    need_skill: raw.need_skill as Analysis['need_skill'],
    need_tools: raw.need_tools,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    skill: typeof raw.skill === 'string' && skillNames.includes(raw.skill) ? raw.skill : undefined
  }
}


const CODEISH =
  /\b(sql|select|function|code|bug|script|python|javascript|typescript|powershell|regex|query|api|docker|kubernetes|terraform|yaml|debug|refactor|compile)\b|كود|دالة|سكربت|سكريبت|استعلام|برمجة/i
const TOOLISH =
  /\b(cpu|ram|memory|disk|process|processes|file|files|folder|directory|search|web|url|github|gcloud|kubectl|terraform|database|table|tables|email|gmail|drive|calendar|canva|outlook|onedrive|onenote|design|miro|notion|box|deepgram|assemblyai|browser-use|filesystem|jira|confluence|gcloud|kubernetes|k8s|terraform|cluster|pod|pods)\b|ميرو|نوشن|جيرا|كلاستر|بورد|خريطة ذهنية|كانفا|تصميم|اوتلوك|ون درايف|مايكروسوفت|ملف|مجلد|ايميل|إيميل|بريد|تقويم|كلندر|موعد|مواعيد|اجتماع|مهام|مهمة|ملاحظ|درايف|جهات الاتصال|مستند|عرض تقديمي|ابحث|بحث|معالج|رام|قرص|جدول|قاعدة بيانات|افتح|شغّل|شغل|اضغط|كبس|اكتب لي على|لقطة شاشة|سكرين|الشاشة|نافذة|برنامج|جهازي|الكمبيوتر|open|click|screenshot|notepad|calc/i

// The small local maestro is lenient-parsed and corrected with a few deterministic rules,
// because a 1.7B model often mislabels the type or puts a skill name in the wrong field.
function parseLocal(text: string, skillNames: string[], input: string, boost?: string): Analysis | null {
  const m = text.match(/\{.*\}/s)
  if (!m) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(m[0])
  } catch {
    return null
  }
  let skill = typeof raw.skill === 'string' ? raw.skill : undefined
  if (typeof raw.need_skill === 'string' && skillNames.includes(raw.need_skill)) skill = raw.need_skill
  if (!skill || !skillNames.includes(skill)) skill = boost && skillNames.includes(boost) ? boost : undefined
  const code = CODEISH.test(input)
  const rawType = TYPES.includes(raw.type as Analysis['type']) ? (raw.type as Analysis['type']) : 'chat'
  const type: Analysis['type'] = code && rawType === 'chat' ? 'code' : rawType
  let complexity = COMPLEXITIES.includes(raw.complexity as Analysis['complexity'])
    ? (raw.complexity as Analysis['complexity'])
    : 'simple'
  if (code && complexity === 'simple' && input.length > 40) complexity = 'medium'
  const delegated = ['delegate-coding', 'delegate-research', 'delegate-file'].includes(String(raw.need_skill))
  const need_skill: Analysis['need_skill'] = code
    ? 'delegate-coding'
    : delegated
      ? (raw.need_skill as Analysis['need_skill'])
      : 'none'
  return {
    complexity,
    type,
    need_skill,
    need_tools: code || TOOLISH.test(input),
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    skill
  }
}

export async function warmLocalMaster(): Promise<void> {
  if (!(await localMasterAvailable())) return
  try {
    await fetch(LOCAL_BASE + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: LOCAL_MASTER, prompt: '', keep_alive: '5m' }),
      signal: AbortSignal.timeout(90000)
    })
  } catch {
    /* ollama busy */
  }
}

export async function analyzeRequest(userInput: string, localOnly = false): Promise<Analysis> {
  let catalog: { name: string; description: string }[] = []
  try {
    catalog = await skillCatalog()
  } catch {
    catalog = []
  }
  const names = catalog.map((c) => c.name)
  emitProgress('الماستر يحلل الطلب…')
  const useLocal = await localMasterAvailable()
  if (useLocal) {
    const scored = topSkillsScored(userInput, catalog)
    const shortlist = scored.map((x) => x.c)
    // Strong keyword match with a clear lead => hint the skill even if the small model misses it.
    const boost = scored[0] && scored[0].sc >= 4 && scored[0].sc >= 1.5 * (scored[1]?.sc ?? 0) ? scored[0].c.name : undefined
    const sys = shortlist.length
      ? SYSTEM_PROMPT +
        ' Add an optional field "skill": the EXACT name of ONE skill from AVAILABLE_SKILLS only if it clearly fits the request, otherwise omit it. AVAILABLE_SKILLS:\n' +
        shortlist.map((c) => `- ${c.name}: ${c.description}`).join('\n')
      : SYSTEM_PROMPT
    try {
      const cs = currentSignal()
      const r = await fetch(LOCAL_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(40000), ...(cs ? [cs] : [])]),
        body: JSON.stringify({
          model: LOCAL_MASTER,
          stream: false,
          think: false,
          format: 'json',
          keep_alive: '5m',
          options: { temperature: 0, num_predict: 300 },
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userInput }
          ]
        })
      })
      const j = (await r.json()) as { message?: { content?: string } }
      const parsed = parseLocal(j.message?.content ?? '', names, userInput, boost)
      if (parsed) {
        console.log('[Master] local maestro answered')
        return { ...parsed, source: 'local', masterModel: LOCAL_MASTER }
      }
      console.warn('[Master] local maestro unparseable')
    } catch (error) {
      console.warn('[Master] local maestro failed, using OpenRouter:', error)
    }
  }
  if (localOnly) {
    // Confidential project: the request text never goes to a cloud maestro.
    emitProgress('مشروع سري: التحليل محلي بس')
    return { ...fallbackAnalysis(), complexity: 'complex' }
  }
  const system = catalog.length
    ? SYSTEM_PROMPT +
      ' Add an optional field "skill": the EXACT name of ONE skill from AVAILABLE_SKILLS only if it clearly fits the request, otherwise omit it or use null. ' +
      'AVAILABLE_SKILLS:\n' +
      catalog.map((c) => `- ${c.name}: ${c.description}`).join('\n')
    : SYSTEM_PROMPT
  for (const model of MASTER_MODELS) {
    if (currentSignal()?.aborted) break
    try {
      emitProgress('الماستر (OpenRouter): ' + model)
      const completion = await getClient().chat.completions.create({
        model,
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userInput }
        ]
      }, { signal: currentSignal() })
      const text = completion.choices[0]?.message?.content ?? ''
      const parsed = parseAnalysis(text, names)
      if (parsed) return { ...parsed, source: 'openrouter', masterModel: model }
      console.warn('[Master] unparseable answer from', model)
    } catch (error) {
      console.warn('[Master] model failed, trying next:', model, error)
    }
  }
  return fallbackAnalysis()
}

// --- Simple test (uncomment to try; needs OPENROUTER_API_KEY in the environment) ---
// import 'dotenv/config'
//
// analyzeRequest('اكتبلي function بالـ TypeScript بتعمل sort لمصفوفة أرقام')
//   .then((analysis) => console.log(analysis))
//   .catch(console.error)
