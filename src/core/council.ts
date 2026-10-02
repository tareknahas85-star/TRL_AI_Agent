import { executeWithFallback, type FallbackResult } from './fallback'
import { getTierForAnalysis } from './router'
import type { Analysis } from './master'
import { emitProgress, setStreamMuted } from './progress'

type Hist = { role: 'user' | 'assistant'; content: string }[]

// What happened in the council round; shown as a chip under the answer.
export type CouncilInfo = {
  ran: boolean
  skipped?: string // why the council did not run
  critic?: string
  reviser?: string
  revised?: boolean
  issues?: number
  ms?: number
}

const CRITIC_SYS =
  'You are a strict, fair reviewer. You receive a user request and a draft answer written by another AI model. ' +
  'Find REAL problems only: factual errors, bugs, missing requirements, unsafe or misleading advice, wrong numbers. ' +
  'Do not nitpick style. If the draft is correct and complete, reply with exactly: LGTM\n' +
  'Otherwise reply with a numbered list of at most 6 concrete issues, each with the specific fix. ' +
  'Do not rewrite the whole answer. Write in the same language as the user request.'

const REVISER_SYS =
  'You wrote a draft answer to the user request. A reviewer sent notes. Fix the issues that are valid, ignore notes that are wrong, ' +
  'and keep everything in the draft that was already good. Return ONLY the final improved answer, in the same language as the user request. ' +
  'Do not mention the reviewer, the notes, or that this is a revision.'

// A weak model sometimes answers the revision request with a review instead of the improved answer. Reject those.
function looksLikeRevision(draft: string, rev: string): boolean {
  const r = rev.trim()
  if (r.length < 20 || r.length < draft.trim().length * 0.5) return false
  if (draft.includes('```') && !r.includes('```')) return false
  if (/^[\s#*>\-_]*(التحليل|المراجعة|مراجعة|الملاحظات|review|analysis|reviewer|notes|the draft|the answer is|بعد مراجعة)/i.test(r)) return false
  if (/YOUR DRAFT:|REVIEWER NOTES:|DRAFT ANSWER:/.test(r)) return false
  return true
}

const provider = (m: string): string => (m.includes('/') ? m.split('/')[0] : m.split(':')[0])

// Round 1 of a "council": a second model critiques the draft, then the author revises it.
// Never throws and never makes the answer worse: any failure returns the original draft.
export async function runCouncil(userInput: string, analysis: Analysis, draft: FallbackResult, history: Hist, pick?: { critic?: string; manual?: boolean }): Promise<{ result: FallbackResult; info: CouncilInfo }> {
  const keep = (info: CouncilInfo): { result: FallbackResult; info: CouncilInfo } => ({ result: draft, info })
  if (!pick?.manual && analysis.complexity === 'simple') return keep({ ran: false, skipped: 'طلب بسيط' })
  if (draft.toolsUsed?.length) return keep({ ran: false, skipped: 'الجواب مبني على أدوات' })
  const t0 = Date.now()
  const pool = getTierForAnalysis(analysis).filter((m) => m !== draft.modelUsed)
  // Prefer a critic from a different provider than the author (less correlated mistakes).
  const auto = [...pool.filter((m) => provider(m) !== provider(draft.modelUsed)), ...pool.filter((m) => provider(m) === provider(draft.modelUsed))]
  // A critic picked by the user goes first (even if it is the same model as the author); the automatic ones stay as fallback.
  const candidates = [...(pick?.critic ? [pick.critic] : []), ...auto.filter((m) => m !== pick?.critic)].slice(0, 4)
  if (!candidates.length) return keep({ ran: false, skipped: 'ما في موديل تاني' })

  try {
    emitProgress('المجلس: الناقد يراجع المسودة…')
    setStreamMuted(true)
    const critic = await executeWithFallback(candidates, `REQUEST:\n${userInput}\n\nDRAFT ANSWER:\n${draft.content}`, analysis, CRITIC_SYS, null, [])
    if (!critic.success || !critic.content.trim()) return keep({ ran: false, skipped: 'الناقد ما رد' })
    const notes = critic.content.trim()
    if (/^[\W_]*LGTM[\W_]*$/i.test(notes) || notes.length < 12) {
      return keep({ ran: true, critic: critic.modelUsed, revised: false, issues: 0, ms: Date.now() - t0 })
    }
    const issues = (notes.match(/^\s*\d+[.)]/gm) ?? []).length || 1

    emitProgress('المجلس: الكاتب يصلّح حسب الملاحظات…')
    // author first, then the model that already proved it can follow instructions (the critic), then the rest
    const reviserModels = [draft.modelUsed, critic.modelUsed, ...candidates.filter((m) => m !== critic.modelUsed)]
    const revised = await executeWithFallback(
      reviserModels,
      `REQUEST:\n${userInput}\n\nYOUR DRAFT:\n${draft.content}\n\nREVIEWER NOTES:\n${notes}\n\nNow write the COMPLETE final answer to the REQUEST (not a review of the draft).`,
      analysis,
      REVISER_SYS,
      null,
      history
    )
    if (!revised.success || !looksLikeRevision(draft.content, revised.content)) {
      return keep({ ran: true, critic: critic.modelUsed, revised: false, issues, skipped: 'التصليح ما كان مناسب — بقيت المسودة', ms: Date.now() - t0 })
    }
    const sum = (a?: number, b?: number): number => (a ?? 0) + (b ?? 0)
    const result: FallbackResult = {
      ...revised,
      // critic attempts are not listed here, so the "tried before" chip and retry only reflect the author's models
      triedModels: [...new Set([...draft.triedModels, ...revised.triedModels])],
      toolsUsed: draft.toolsUsed,
      failures: [...(draft.failures ?? []), ...(critic.failures ?? []), ...(revised.failures ?? [])],
      usage: {
        promptTokens: sum(sum(draft.usage?.promptTokens, critic.usage?.promptTokens), revised.usage?.promptTokens),
        completionTokens: sum(sum(draft.usage?.completionTokens, critic.usage?.completionTokens), revised.usage?.completionTokens),
        genMs: sum(sum(draft.usage?.genMs, critic.usage?.genMs), revised.usage?.genMs),
        estimated: !!(draft.usage?.estimated || critic.usage?.estimated || revised.usage?.estimated)
      }
    }
    return { result, info: { ran: true, critic: critic.modelUsed, reviser: revised.modelUsed, revised: true, issues, ms: Date.now() - t0 } }
  } catch (e) {
    console.warn('[Council] failed, keeping draft:', e instanceof Error ? e.message : e)
    return keep({ ran: false, skipped: 'خطأ بالمجلس — بقيت المسودة' })
  } finally {
    setStreamMuted(false)
  }
}
