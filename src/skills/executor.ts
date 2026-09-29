import type { Analysis } from '../core/master'
import { getTierForAnalysis } from '../core/router'
import { executeWithFallback } from '../core/fallback'
import { loadSkill } from './loader'

export async function executeWithSkill(userInput: string, analysis: Analysis) {
  let systemPrompt = 'You are a helpful assistant.'

  if (analysis.need_skill !== 'none') {
    const skillName = analysis.need_skill.replace('delegate-', '') // coding, research, file
    const skill = await loadSkill(skillName)
    if (skill) {
      console.log(`[Skills] Loaded skill: ${skill.name}`)
      // The skill content is used as the system prompt; the user input stays untouched.
      systemPrompt = skill.content
    } else {
      console.warn(`[Skills] Skill ${skillName} not found, using default`)
    }
  }

  const modelsToTry = getTierForAnalysis(analysis)
  return executeWithFallback(modelsToTry, userInput, analysis, systemPrompt)
}
