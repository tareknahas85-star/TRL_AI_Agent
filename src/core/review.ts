import { reviewVerdict } from './build-guards'
import { emitAgent } from './progress'
import { runClaudeAgent, runCodexAgent, runGeminiAgent, codexModelOf, CODEX_CLI, CODEX_MODEL_PREFIX, GEMINI_CLI, ENGINE_ORDER, type AgentResult } from './cli-agent'
import OpenAI from 'openai'
import { hostOf } from './hosts'
import { apinexClient, apinexModelId, hasApinexKey, isApinexModel } from './apinex'
import { listCatalog } from './catalog'
import { getRoles } from './roles'
import { CUSTOM_PREFIX, clientForCustomModel, getCustomModel, listCustomModelViews } from './custom-models'

// العيلة: نفس العيلة = ما نعتبر المراجعة مستقلة. الموديل المخصص يتصنّف حسب اسم موديله (claude / gemini / gpt).
const family = (e: string): string => {
  if (e.startsWith(CUSTOM_PREFIX)) {
    const n = (getCustomModel(e.slice(CUSTOM_PREFIX.length))?.model ?? e).toLowerCase()
    return /claude/.test(n) ? 'claude' : /gemini/.test(n) ? 'google' : /gpt|codex|openai|\bo[1-9]\b/.test(n) ? 'openai' : e
  }
  if (e.includes('/') && !e.startsWith('cli:')) { const n = e.toLowerCase(); return /claude|anthropic/.test(n) ? 'claude' : /gemini|google/.test(n) ? 'google' : /gpt|codex|openai|\bo[1-9]\b/.test(n) ? 'openai' : e }
  return e.startsWith('cli:claude') ? 'claude' : (e === CODEX_CLI || e.startsWith(CODEX_MODEL_PREFIX)) ? 'openai' : e === GEMINI_CLI ? 'google' : e
}

export type Ctx = { signal?: AbortSignal; emit: (t: string) => void; effort?: string; cwd?: string }

// المراجع عبر API ما عنده وصول للملفات. نقولها له صراحة عشان ما يدّعي إنه فحص شي ما فحصه.
const API_REVIEW_NOTE =
  '\n\nIMPORTANT: you have NO access to the project files in this review. Judge only the task and the author summary given to you. Say so in the CHECKS line, and never claim you ran or read anything.'

async function runApiReview(eng: string, prompt: string, system: string, c: Ctx): Promise<AgentResult> {
  const m = getCustomModel(eng.slice(CUSTOM_PREFIX.length))
  if (!m) throw new Error('موديل المراجعة مو موجود')
  const { client, modelId } = clientForCustomModel(m)
  c.emit('مراجعة نصية (بدون وصول للملفات)')
  const res = await client.chat.completions.create({ model: modelId, messages: [{ role: 'system', content: system + API_REVIEW_NOTE }, { role: 'user', content: prompt }] }, { signal: c.signal })
  const text = res.choices[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('المراجع رجّع رد فاضي')
  return { text, tools: [] } as unknown as AgentResult
}

// مراجع من apinex: نفس المراجعة النصية بدون ملفات.
async function runApinexReview(eng: string, prompt: string, system: string, c: Ctx): Promise<AgentResult> {
  if (!hasApinexKey()) throw new Error('ما في مفتاح apinex للمراجع')
  c.emit('مراجعة نصية (بدون وصول للملفات)')
  const res = await apinexClient().chat.completions.create({ model: apinexModelId(eng), messages: [{ role: 'system', content: system + API_REVIEW_NOTE }, { role: 'user', content: prompt }] }, { signal: c.signal })
  const text = res.choices[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('المراجع رجّع رد فاضي')
  return { text, tools: [] } as unknown as AgentResult
}

// مراجع من كتالوج OpenRouter (Claude/GPT...) مختار من قائمة المراجع: نفس المراجعة النصية بدون ملفات.
async function runOpenRouterReview(eng: string, prompt: string, system: string, c: Ctx): Promise<AgentResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('ما في مفتاح OpenRouter للمراجع')
  const client = new OpenAI({ baseURL: hostOf('openrouter'), apiKey: process.env.OPENROUTER_API_KEY, dangerouslyAllowBrowser: true, timeout: 120000, maxRetries: 0 })
  c.emit('مراجعة نصية (بدون وصول للملفات)')
  const res = await client.chat.completions.create({ model: eng, messages: [{ role: 'system', content: system + API_REVIEW_NOTE }, { role: 'user', content: prompt }] }, { signal: c.signal })
  const text = res.choices[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('المراجع رجّع رد فاضي')
  return { text, tools: [] } as unknown as AgentResult
}

function runOn(eng: string, prompt: string, system: string, c: Ctx, role: string): Promise<AgentResult> {
  if (eng.startsWith(CUSTOM_PREFIX)) return runApiReview(eng, prompt, system, c)
  if (isApinexModel(eng)) return runApinexReview(eng, prompt, system, c)
  if (eng.includes('/') && !eng.startsWith('cli:')) return runOpenRouterReview(eng, prompt, system, c)
  const base = { signal: c.signal, system, cwd: c.cwd, onProgress: (t: string): void => emitAgent(eng, role, t) }
  return eng === CODEX_CLI || codexModelOf(eng) ? runCodexAgent(prompt, { ...base, model: codexModelOf(eng) }) : eng === GEMINI_CLI ? runGeminiAgent(prompt, base) : runClaudeAgent(prompt, { ...base, effort: c.effort })
}

const REVIEW_SYS =
  'You are an INDEPENDENT adversarial reviewer. You did NOT write this work. SCOPE: stay strictly inside the project folder (your working directory); never scan or read outside it (no recursive searches of the user home or drives). Also check that every file the author mentions really lives inside the project folder; a file outside it is a high finding. Be efficient: a small task (up to 3 files) needs at most ~8 commands, then answer. Never take the author\'s claims on trust: verify against the real files and real command output (run the project\'s typecheck/tests/build if they exist; read the docs and code). ' +
  'If the project has UI screenshots (png/jpg, e.g. in reports/ or screenshots/), open and LOOK at them: flag raw template placeholders such as {{...}}, overlapping elements, cut-off or wrong-language text. If you cannot view images say so explicitly. ' +
  'Do not modify any file except a new REVIEW-AUTO.md. If any screen or page file is a stub (contains "stub", "TODO", "placeholder", "coming soon", or is nearly empty), the work is INCOMPLETE: report it as a high finding. Also, if the project has a test or e2e suite, run it TWICE: if the pass count differs between the two runs, report it as a medium finding (flaky). Output format, strictly: one line per issue as "FINDING [high|medium|low]: <issue> | evidence: <file/command/output>", then a line "CHECKS: <what you actually ran/read>", then a final line "VERDICT: PASS" or "VERDICT: FAIL". A review with no findings is suspicious: look harder before concluding. Answer in simple Levantine Arabic, technical terms in English.'

export type ReviewOutcome = { reviewer: string; independent: boolean; text: string; findings: number; high: number; medium: number; verdict: 'PASS' | 'FAIL' | 'UNKNOWN' }

function parse(text: string): { findings: number; high: number; medium: number; verdict: 'PASS' | 'FAIL' | 'UNKNOWN' } {
  return reviewVerdict(text)
}

export async function independentReview(author: string, task: string, authorSummary: string, c: Ctx): Promise<ReviewOutcome | null> {
  // مراجعين: محركات الاشتراك (لو مفعّلة) + الموديلات المخصصة اللي عندها مفتاح. الأقوى أولاً.
  const rank = (t: string): number => (t === 'TIER_3_EXPENSIVE' ? 0 : t === 'TIER_2_CHEAP' ? 1 : 2)
  const apiReviewers = listCustomModelViews()
    .filter((m) => m.enabled && m.hasKey)
    .sort((a, b) => rank(a.tier) - rank(b.tier))
    .map((m) => CUSTOM_PREFIX + m.id)
  // 5.17.8: احتياط تلقائي: Claude/GPT من كتالوج OpenRouter (الأرخص أولاً، واحد من كل عيلة)، بيجي بعد الموديلات المخصصة، فبيشتغل بس لما مراجع من عيلة غير المنفّذ مو متاح (مثلاً المنفّذ Google).
  const orPick = (re: RegExp): string[] =>
    process.env.OPENROUTER_API_KEY
      ? listCatalog()
          .models.filter((m) => re.test(m.id) && m.tier !== 'TIER_1_FREE' && !/:free$/i.test(m.id))
          .sort((a, b) => rank(b.tier) - rank(a.tier) || a.id.localeCompare(b.id))
          .slice(0, 1)
          .map((m) => m.id)
      : []
  const orReviewers = [...orPick(/^anthropic\/claude/i), ...orPick(/^openai\/gpt/i)]
  const others = [...ENGINE_ORDER, ...apiReviewers, ...orReviewers].filter((e) => family(e) !== family(author))
  // Reviewer preference (Settings > roles). It is used only when it comes from a different family than the author.
  const pref = getRoles().reviewer
  if (pref !== 'auto' && family(pref) === family(author)) c.emit('المراجع المفضّل من نفس عيلة المنفّذ، بنختار مراجع من عيلة تانية')
  const preferred: string[] = pref !== 'auto' && family(pref) !== family(author) ? [pref] : []
  const candidates = [...preferred, ...others.filter((e) => !preferred.includes(e)), author]
  const body = 'TASK GIVEN TO THE AUTHOR:\n' + task.slice(0, 3000) + '\n\nAUTHOR\'S OWN FINAL SUMMARY (unverified claims):\n' + authorSummary.slice(0, 4000) + '\n\nReview the actual project folder now.' + (c.cwd ? '\n\nPROJECT FOLDER (your working directory; write REVIEW-AUTO.md ONLY inside this exact folder, never in any other folder): ' + c.cwd : '')
  for (const eng of candidates) {
    try {
      c.emit('مراجعة مستقلة بواسطة: ' + eng)
      let r = await runOn(eng, body, REVIEW_SYS, c, 'مراجع')
      let p = parse(r.text)
      if (p.findings === 0 && p.verdict !== 'FAIL' && authorSummary.length > 900) {
        c.emit('المراجع ما لقى ملاحظات — بنطلب منو يدقّق أكتر')
        r = await runOn(eng, body + '\n\nYour first pass found nothing, which is statistically unlikely. List at least 3 real weaknesses, risks or unverified claims with evidence (or state exactly what you checked that proves there are none).', REVIEW_SYS, c, 'مراجع')
        p = parse(r.text)
      }
      return { reviewer: eng, independent: family(eng) !== family(author), text: r.text, ...p }
    } catch (e) {
      if (c.signal?.aborted) throw e
    }
  }
  return null
}

export async function repairFromReview(author: string, task: string, review: ReviewOutcome, c: Ctx): Promise<AgentResult | null> {
  try {
    c.emit('إصلاح الملاحظات بعد المراجعة')
    const prompt = 'An independent reviewer found problems in your work on this task:\n' + task.slice(0, 2000) + '\n\nREVIEW:\n' + review.text.slice(0, 5000) + '\n\nFix every real finding in the project (edit existing files, do not rewrite or shrink documents), re-run the verification (typecheck/tests/build/screenshots) and update STATE.md. Finish with an honest summary: what you fixed, what you could not, with command output as proof.'
    return await runOn(author, prompt, '', c, 'منفّذ (إصلاح)')
  } catch (e) {
    if (c.signal?.aborted) throw e
    return null
  }
}
