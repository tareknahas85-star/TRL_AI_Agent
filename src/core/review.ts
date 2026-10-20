import { emitAgent } from './progress'
import { runClaudeAgent, runCodexAgent, runGeminiAgent, codexModelOf, CODEX_CLI, CODEX_MODEL_PREFIX, GEMINI_CLI, ENGINE_ORDER, type AgentResult } from './cli-agent'
import { getRoles } from './roles'

const family = (e: string): string => (e.startsWith('cli:claude') ? 'claude' : (e === CODEX_CLI || e.startsWith(CODEX_MODEL_PREFIX)) ? 'openai' : e === GEMINI_CLI ? 'google' : e)

export type Ctx = { signal?: AbortSignal; emit: (t: string) => void; effort?: string }

function runOn(eng: string, prompt: string, system: string, c: Ctx, role: string): Promise<AgentResult> {
  const base = { signal: c.signal, system, onProgress: (t: string): void => emitAgent(eng, role, t) }
  return eng === CODEX_CLI || codexModelOf(eng) ? runCodexAgent(prompt, { ...base, model: codexModelOf(eng) }) : eng === GEMINI_CLI ? runGeminiAgent(prompt, base) : runClaudeAgent(prompt, { ...base, effort: c.effort })
}

const REVIEW_SYS =
  'You are an INDEPENDENT adversarial reviewer. You did NOT write this work. Never take the author\'s claims on trust: verify against the real files and real command output (run the project\'s typecheck/tests/build if they exist; read the docs and code). ' +
  'If the project has UI screenshots (png/jpg, e.g. in reports/ or screenshots/), open and LOOK at them: flag raw template placeholders such as {{...}}, overlapping elements, cut-off or wrong-language text. If you cannot view images say so explicitly. ' +
  'Do not modify any file except a new REVIEW-AUTO.md. If any screen or page file is a stub (contains "stub", "TODO", "placeholder", "coming soon", or is nearly empty), the work is INCOMPLETE: report it as a high finding. Output format, strictly: one line per issue as "FINDING [high|medium|low]: <issue> | evidence: <file/command/output>", then a line "CHECKS: <what you actually ran/read>", then a final line "VERDICT: PASS" or "VERDICT: FAIL". A review with no findings is suspicious: look harder before concluding. Answer in simple Levantine Arabic, technical terms in English.'

export type ReviewOutcome = { reviewer: string; independent: boolean; text: string; findings: number; high: number; verdict: 'PASS' | 'FAIL' | 'UNKNOWN' }

function parse(text: string): { findings: number; high: number; verdict: 'PASS' | 'FAIL' | 'UNKNOWN' } {
  const f = text.match(/^\s*FINDING\s*\[/gim)?.length ?? 0
  const h = text.match(/^\s*FINDING\s*\[high\]/gim)?.length ?? 0
  const v = /VERDICT:\s*FAIL/i.test(text) ? 'FAIL' : /VERDICT:\s*PASS/i.test(text) ? 'PASS' : 'UNKNOWN'
  return { findings: f, high: h, verdict: v }
}

export async function independentReview(author: string, task: string, authorSummary: string, c: Ctx): Promise<ReviewOutcome | null> {
  const others = ENGINE_ORDER.filter((e) => family(e) !== family(author))
  // Reviewer preference (Settings > roles). It is used only when it comes from a different family than the author.
  const pref = getRoles().reviewer
  if (pref !== 'auto' && family(pref) === family(author)) c.emit('المراجع المفضّل من نفس عيلة المنفّذ، بنختار مراجع من عيلة تانية')
  const preferred: string[] = pref !== 'auto' && family(pref) !== family(author) ? [pref] : []
  const candidates = [...preferred, ...others.filter((e) => !preferred.includes(e)), author]
  const body = 'TASK GIVEN TO THE AUTHOR:\n' + task.slice(0, 3000) + '\n\nAUTHOR\'S OWN FINAL SUMMARY (unverified claims):\n' + authorSummary.slice(0, 4000) + '\n\nReview the actual project folder now.'
  for (const eng of candidates) {
    try {
      c.emit('مراجعة مستقلة بواسطة: ' + eng)
      let r = await runOn(eng, body, REVIEW_SYS, c, 'مراجع')
      let p = parse(r.text)
      if (p.findings === 0 && p.verdict !== 'FAIL') {
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