import type { Analysis } from '../core/master'
import { getTierForAnalysis } from '../core/router'
import { executeWithFallback } from '../core/fallback'
import { loadSkill } from './loader'
import { buildToolset } from '../mcp/runtime'
import { activeProject } from '../core/workspace'

export async function executeWithSkill(userInput: string, analysis: Analysis, extraSystem?: string, exclude: string[] = [], history: { role: 'user' | 'assistant'; content: string }[] = []) {
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

  const modelsToTry = getTierForAnalysis(analysis).filter((m) => !exclude.includes(m))
  if (exclude.length && !modelsToTry.length) {
    return { content: 'لا يوجد نموذج آخر بهالفئة لتجربته.', modelUsed: 'none', success: false, triedModels: [] as string[] }
  }
  let toolset: Awaited<ReturnType<typeof buildToolset>> = null
  if (analysis.need_tools) {
    try {
      toolset = await buildToolset(userInput, activeProject()?.path)
    } catch (err) {
      console.warn('[Tools] toolset failed:', err)
    }
  }
  return executeWithFallback(modelsToTry, userInput, analysis, systemPrompt, toolset, history)
}
