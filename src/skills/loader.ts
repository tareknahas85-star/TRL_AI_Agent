import fs from 'fs/promises'
import path from 'path'

export type Skill = { name: string; description: string; content: string; filePath: string }

const SKILLS_DIR = path.join(process.cwd(), 'src/skills/delegate-skills')

export async function loadSkill(skillName: string): Promise<Skill | null> {
  try {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md')
    const content = await fs.readFile(skillPath, 'utf-8')
    return {
      name: skillName,
      description: content.split('\n')[0].replace('#', '').trim(),
      content,
      filePath: skillPath
    }
  } catch (e) {
    console.warn(`[Skills] Skill not found: ${skillName}`, e)
    return null
  }
}

export async function listSkills(): Promise<string[]> {
  try {
    const dirs = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
    return dirs.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

export function buildSkillPrompt(skill: Skill, userInput: string): string {
  return `${skill.content}\n\n---\nUser Request: ${userInput}`
}
