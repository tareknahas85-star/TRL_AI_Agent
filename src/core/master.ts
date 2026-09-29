import OpenAI from 'openai'

export type Analysis = {
  complexity: 'simple' | 'medium' | 'complex'
  type: 'chat' | 'code' | 'research' | 'file_task'
  need_skill: 'none' | 'delegate-coding' | 'delegate-research' | 'delegate-file'
  need_tools: boolean
  reason: string
}

const MASTER_MODEL = 'google/gemini-2.0-flash-exp:free'

const SYSTEM_PROMPT =
  'You are a request classifier. Analyze the user request and return ONLY valid JSON without markdown. ' +
  'Format: {"complexity":"simple|medium|complex","type":"chat|code|research|file_task","need_skill":"none|delegate-coding|delegate-research|delegate-file","need_tools":true/false,"reason":"short reason"} ' +
  'Rules: simple=general chat/translation/summary, medium=simple code/explanation, complex=full project/file operations/multi-step. ' +
  'If request mentions code/programming/bug/fix/write function -> need_skill=delegate-coding and need_tools=true. ' +
  'If research/search -> delegate-research.'

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
    reason: 'fallback'
  }
}

let client: OpenAI | null = null
let clientKey: string | undefined

// Created lazily, and re-created if the key changes (e.g. saved from the Settings screen).
function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey
    })
    clientKey = apiKey
  }
  return client
}

function parseAnalysis(text: string): Analysis | null {
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
    reason: typeof raw.reason === 'string' ? raw.reason : ''
  }
}

export async function analyzeRequest(userInput: string): Promise<Analysis> {
  try {
    const completion = await getClient().chat.completions.create({
      model: MASTER_MODEL,
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userInput }
      ]
    })

    const text = completion.choices[0]?.message?.content ?? ''
    return parseAnalysis(text) ?? fallbackAnalysis()
  } catch (error) {
    console.warn('[Master] Fallback triggered:', error)
    return fallbackAnalysis()
  }
}

// --- Simple test (uncomment to try; needs OPENROUTER_API_KEY in the environment) ---
// import 'dotenv/config'
//
// analyzeRequest('اكتبلي function بالـ TypeScript بتعمل sort لمصفوفة أرقام')
//   .then((analysis) => console.log(analysis))
//   .catch(console.error)
