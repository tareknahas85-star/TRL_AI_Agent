import type { Analysis } from '../core/master'
import { getTierForAnalysis, strongPaidModels } from '../core/router'
import { isCliModel } from '../core/cli-models'
import { executeWithFallback, BUILD_REQ } from '../core/fallback'
import { loadSkill } from './loader'
import { buildToolset } from '../mcp/runtime'
import type { Project } from '../core/workspace'
import { currentMode } from '../core/progress'
import { computerEnabled } from '../computer/control'

export async function executeWithSkill(userInput: string, analysis: Analysis, extraSystem?: string, exclude: string[] = [], history: { role: 'user' | 'assistant'; content: string }[] = [], project: Project | null = null) {
  let systemPrompt = 'You are a helpful assistant.'

  let picked = false
  if (analysis.skill) {
    const s = await loadSkill(analysis.skill)
    if (s && s.enabled) {
      console.log(`[Skills] Maestro picked skill: ${s.name}`)
      systemPrompt = s.content.slice(0, 12000)
      picked = true
    }
  }

  if (!picked && analysis.need_skill !== 'none') {
    const skillName = analysis.need_skill.replace('delegate-', '') // coding, research, file
    const skill = await loadSkill(skillName)
    if (skill && !skill.enabled) {
      console.warn(`[Skills] Skill ${skillName} is disabled, using default`)
    } else if (skill) {
      console.log(`[Skills] Loaded skill: ${skill.name}`)
      // The skill content is used as the system prompt; the user input stays untouched.
      systemPrompt = skill.content
    } else {
      console.warn(`[Skills] Skill ${skillName} not found, using default`)
    }
  }

  if (extraSystem) systemPrompt += '\n\n' + extraSystem

  const mode = currentMode()
  const buildReq = BUILD_REQ.test(userInput)
  const picked1 = mode?.kind === 'model' ? [mode.id] : mode?.kind === 'council' && mode.author ? [mode.author] : null
  // Build/save/run requests: the picked model goes first, but the normal chain stays behind it so a model without tools is skipped, not trusted.
  const chain = picked1 ? (buildReq ? [...picked1, ...getTierForAnalysis(analysis).filter((m) => !picked1.includes(m))] : picked1) : getTierForAnalysis(analysis)
  let modelsToTry = chain.filter((m) => !exclude.includes(m))
  if (project?.confidential) {
    // Confidential project: only paid strong models, never the free tier / small or custom ones.
    const strong = strongPaidModels()
    if (mode?.kind === 'free') {
      return { content: '🔒 هاد مشروع سري: وضع "مجاني بس" ممنوع فيه. اختار "تلقائي — مع المدفوع" أو موديل قوي محدد.', modelUsed: 'none', success: false, triedModels: [] as string[] }
    }
    if (picked1 && !picked1.every((m) => strong.includes(m) || isCliModel(m))) {
      return { content: '🔒 هاد مشروع سري: الموديل المختار مو من الموديلات المدفوعة القوية المسموحة. اختار Claude/GPT مدفوع أو وضع تلقائي.', modelUsed: 'none', success: false, triedModels: [] as string[] }
    }
    modelsToTry = [...(picked1 ?? []), ...strong.filter((m) => !(picked1 ?? []).includes(m))].filter((m) => !exclude.includes(m))
    systemPrompt += '\n\nCONFIDENTIAL PROJECT: this is a confidential company project. Never copy its content to external websites, public services or other folders unless the user explicitly asks.'
    if (!modelsToTry.length) {
      return { content: '🔒 مشروع سري: ما في موديل مدفوع قوي متاح (تأكد من مفتاح OpenRouter/الرصيد).', modelUsed: 'none', success: false, triedModels: [] as string[] }
    }
  }
  if (exclude.length && !modelsToTry.length) {
    return { content: 'ما في موديل تاني بهالفئة لنجرّبه.', modelUsed: 'none', success: false, triedModels: [] as string[] }
  }
  let toolset: Awaited<ReturnType<typeof buildToolset>> = null
  // With an active project, file tools are offered whenever the request looks project/file related, even if the master did not flag tools.
  const PROJECT_TOOLISH = /ملف|ملفات|مجلد|مشروع|افتح|اقرأ|راجع|حلل|شوف|file|folder|project|readme|open|read|review|analy[sz]e|\.[a-z0-9]{1,5}\b/i
  // Agent mode: whenever a project is open or PC control is on, the tools (and skills) are always offered.
  if (analysis.need_tools || buildReq || project || computerEnabled() || PROJECT_TOOLISH.test(userInput) && !!project) {
    try {
      toolset = await buildToolset(userInput, project?.path)
    } catch (err) {
      console.warn('[Tools] toolset failed:', err)
    }
  }
  const canAct = !!toolset?.defs.some((d) => (d as { function?: { name?: string } }).function?.name?.startsWith('pc_'))
  if (buildReq && project && !canAct) {
    const why = toolset?.notes?.length ? '\nالسبب: ' + toolset.notes.join('؛ ') : ''
    return {
      content: '❌ ما بقدر نفّذ (بناء/حفظ/تشغيل) لأنو "التحكم بالجهاز" مطفي، وبدونو ما في ولا موديل بيقدر ينفّذ شي على جهازك.\nالحل: فعّل "التحكم بالجهاز" من الإعدادات وأعد الطلب.' + why,
      modelUsed: 'none',
      success: false,
      triedModels: [] as string[]
    }
  }
  return executeWithFallback(modelsToTry, userInput, analysis, systemPrompt, toolset, history, { requireTools: buildReq && !!toolset?.defs.length })
}
