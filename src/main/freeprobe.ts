import { hostOf } from '../core/hosts'
import { ipcMain } from 'electron'
import { getApiKey } from '../store/secure-store'
import { readJson, writeJson } from '../core/json-store'
import { applyPin, clearPin, lastFreeCheck, markFreeCheck, pinState, pinnedFree, setSuggestion, type Suggestion } from '../core/free-pin'
import { rankedFreeModels } from '../core/free-best'
import { freeUsage } from '../core/model-health'

// Free-model probe: lists OpenRouter models that are 100% free, then tests each one for real
// (valid tool call + Arabic answer + speed). Nothing is switched automatically.
export type FreeModel = { id: string; ctx: number; created: string }
export type ProbeResult = { id: string; ok: boolean; score: number; secs: number; tool: boolean; arabic: boolean | null; note: string; at: string }
const FILE = 'free-probe.json'

export async function listFree(): Promise<{ ok: boolean; error?: string; models: FreeModel[] }> {
  try {
    const r = await fetch(`${hostOf('openrouter')}/models`, { signal: AbortSignal.timeout(20000) })
    if (!r.ok) return { ok: false, error: 'خطأ ' + r.status, models: [] }
    const j = (await r.json()) as { data?: { id: string; context_length?: number; created?: number; pricing?: Record<string, string>; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; supported_parameters?: string[] }[] }
    const models = (j.data ?? [])
      .filter((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
      .filter((m) => m.architecture?.output_modalities?.length === 1 && m.architecture.output_modalities[0] === 'text')
      .filter((m) => m.supported_parameters?.includes('tools') && (m.context_length ?? 0) >= 32000)
      .map((m) => ({ id: m.id, ctx: m.context_length ?? 0, created: new Date((m.created ?? 0) * 1000).toISOString().slice(0, 10) }))
      .sort((a, b) => b.created.localeCompare(a.created) || b.ctx - a.ctx)
    return { ok: true, models }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), models: [] }
  }
}

async function chat(key: string, body: unknown): Promise<{ status: number; json?: Record<string, unknown>; text: string; secs: number }> {
  const t0 = Date.now()
  const r = await fetch(`${hostOf('openrouter')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(75000)
  })
  const text = await r.text()
  let json: Record<string, unknown> | undefined
  try { json = JSON.parse(text) as Record<string, unknown> } catch { /* keep text */ }
  return { status: r.status, json, text, secs: (Date.now() - t0) / 1000 }
}

type Choice = { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }

async function probe(id: string): Promise<ProbeResult> {
  const at = new Date().toISOString()
  const fail = (note: string, secs = 0): ProbeResult => ({ id, ok: false, score: 0, secs, tool: false, arabic: null, note: note.slice(0, 220), at })
  const key = getApiKey('OPENROUTER_API_KEY')
  if (!key) return fail('ما في مفتاح OpenRouter')
  try {
    // 1) real tool call
    const a = await chat(key, {
      model: id,
      max_tokens: 600,
      messages: [{ role: 'user', content: 'Use the add tool to compute 17 + 25. Do not answer in text.' }],
      tools: [{ type: 'function', function: { name: 'add', description: 'Add two numbers', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } } }],
      tool_choice: 'auto'
    })
    if (a.status !== 200) return fail(a.status + ' ' + a.text.replace(/\s+/g, ' '), a.secs)
    const msg = ((a.json?.choices as Choice[] | undefined)?.[0])?.message
    let tool = false
    const call = msg?.tool_calls?.[0]?.function
    if (call?.name === 'add') {
      try {
        const args = JSON.parse(call.arguments ?? '{}') as { a?: number; b?: number }
        tool = Number(args.a) + Number(args.b) === 42
      } catch { /* invalid JSON */ }
    }
    if (!tool) return { ...fail('ما استدعى الأداة بشكل صحيح' + (msg?.content ? ' (رد نص: ' + String(msg.content).slice(0, 60) + ')' : ''), a.secs), arabic: null }
    // 2) Arabic answer
    await new Promise((r) => setTimeout(r, 3500))
    const b = await chat(key, { model: id, max_tokens: 600, messages: [{ role: 'user', content: 'ما هي عاصمة سوريا؟ جاوب بجملة عربية قصيرة.' }] })
    if (b.status !== 200) return { ...fail('الأداة اشتغلت لكن العربي فشل: ' + b.status, a.secs + b.secs), tool: true, score: 50 }
    const reply = String(((b.json?.choices as Choice[] | undefined)?.[0])?.message?.content ?? '')
    const arabic = reply.includes('دمشق')
    const secs = Number(((a.secs + b.secs) / 2).toFixed(1))
    const speed = secs <= 6 ? 20 : secs <= 15 ? 10 : 0
    const score = 50 + (arabic ? 30 : 0) + speed
    return { id, ok: true, score, secs, tool: true, arabic, note: arabic ? 'أداة ✅ عربي ✅' : 'أداة ✅ بس العربي ضعيف/فاضي', at }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

const MIN_GAIN = 15 // a different model must beat the current first choice by this many points (out of 100)

// Compares the stored probe results with the current first choice and records a suggestion (never applies it).
export function evaluate(): Suggestion | null {
  const results = readJson<ProbeResult[]>(FILE, [])
  const ok = results.filter((r) => r.ok).sort((a, b) => b.score - a.score || a.secs - b.secs)
  const best = ok[0]
  if (!best) return null
  const current = pinnedFree() ?? rankedFreeModels(1)[0] ?? ''
  if (!current || best.id === current) {
    setSuggestionQuiet(null)
    return null
  }
  const cur = results.find((r) => r.id === current)
  const oldScore = cur?.ok ? cur.score : 0
  if (cur && cur.ok && best.score - oldScore < MIN_GAIN) {
    setSuggestionQuiet(null)
    return null
  }
  const prev = pinState().suggestion
  const s: Suggestion = { model: best.id, current, newScore: best.score, oldScore, at: new Date().toISOString() }
  if (prev && prev.model === s.model && prev.current === s.current) return prev // already suggested, do not nag
  setSuggestion(s)
  return s
}
const setSuggestionQuiet = (s: null): void => {
  if (pinState().suggestion) setSuggestion(s)
}

// Weekly background check: probes the 6 strongest-looking free models plus the current first choice (~14 requests),
// then records a suggestion and sends a Telegram message if something clearly better exists.
let checking = false
export async function weeklyCheck(): Promise<void> {
  if (checking) return
  checking = true
  try {
    const u = freeUsage()
    if (u.limited || u.count > 30) return // keep today's free quota for real work
    const list = await listFree()
    if (!list.ok) return
    const current = pinnedFree() ?? rankedFreeModels(1)[0]
    const ids = [...new Set([...(current ? [current] : []), ...list.models.slice(0, 6).map((m) => m.id)])].filter((id) => id.endsWith(':free'))
    for (const id of ids) {
      const res = await probe(id)
      const all = readJson<ProbeResult[]>(FILE, []).filter((r) => r.id !== id)
      writeJson(FILE, [res, ...all].slice(0, 100))
      await new Promise((r) => setTimeout(r, 3500))
    }
    markFreeCheck()
    evaluate()
  } finally {
    checking = false
  }
}

export function startFreeWatch(): void {
  const tick = (): void => {
    if (Date.now() - lastFreeCheck() > 7 * 24 * 3600 * 1000) void weeklyCheck()
  }
  setTimeout(tick, 5 * 60 * 1000) // 5 min after start, so it never slows the launch
  setInterval(tick, 6 * 3600 * 1000)
}

export function registerFreeProbeHandlers(): void {
  ipcMain.handle('freeprobe:list', () => listFree())
  ipcMain.handle('freeprobe:results', () => readJson<ProbeResult[]>(FILE, []))
  ipcMain.handle('freeprobe:test', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.endsWith(':free')) return null
    const res = await probe(id)
    const all = readJson<ProbeResult[]>(FILE, []).filter((r) => r.id !== id)
    writeJson(FILE, [res, ...all].slice(0, 100))
    return res
  })
  ipcMain.handle('freeprobe:status', () => {
    const s = pinState()
    return { pinned: s.pinned ?? null, since: s.since ?? null, suggestion: s.suggestion ?? null, lastCheck: s.lastCheck, current: pinnedFree() ?? rankedFreeModels(1)[0] ?? '' }
  })
  ipcMain.handle('freeprobe:evaluate', () => evaluate())
  ipcMain.handle('freeprobe:apply', (_e, id: unknown) => {
    if (typeof id === 'string' && id.endsWith(':free')) applyPin(id)
    return true
  })
  ipcMain.handle('freeprobe:dismiss', () => {
    setSuggestionQuiet(null)
    return true
  })
  ipcMain.handle('freeprobe:unpin', () => {
    clearPin()
    return true
  })
  ipcMain.handle('freeprobe:checkNow', async () => {
    await weeklyCheck()
    return true
  })
}