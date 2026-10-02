import fs from 'fs/promises'
import path from 'path'
import { getSkillsDir } from '../core/paths'
import { readState } from '../core/state'

export type Skill = {
  name: string
  description: string
  content: string
  filePath: string
  enabled: boolean
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const isValidSkillName = (n: unknown): n is string => typeof n === 'string' && NAME_RE.test(n)

export async function loadSkill(skillName: string): Promise<Skill | null> {
  if (!isValidSkillName(skillName)) return null
  try {
    const skillPath = path.join(getSkillsDir(), skillName, 'SKILL.md')
    const content = await fs.readFile(skillPath, 'utf-8')
    return {
      name: skillName,
      description: content.split('\n').find((l) => l.trim())?.replace(/^#+/, '').trim() ?? '',
      content,
      filePath: skillPath,
      enabled: !readState().disabledSkills.includes(skillName)
    }
  } catch (e) {
    console.warn(`[Skills] Skill not found: ${skillName}`, e)
    return null
  }
}

export async function listSkills(): Promise<string[]> {
  try {
    const dirs = await fs.readdir(getSkillsDir(), { withFileTypes: true })
    return dirs.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

export async function listSkillDetails(): Promise<Skill[]> {
  const all = await Promise.all((await listSkills()).map(loadSkill))
  return all.filter((s): s is Skill => s !== null)
}

export async function createSkill(name: string, content: string): Promise<Skill> {
  if (!isValidSkillName(name)) throw new Error('اسم السكيل لازم يكون حروف إنجليزية/أرقام/ - / _ بس')
  if (!content.trim()) throw new Error('محتوى السكيل فاضي')
  const dir = path.join(getSkillsDir(), name)
  try {
    await fs.access(dir)
    throw new Error('السكيل موجود من قبل')
  } catch (e) {
    if (e instanceof Error && e.message === 'السكيل موجود من قبل') throw e
  }
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf-8')
  return (await loadSkill(name)) as Skill
}

export async function deleteSkill(name: string): Promise<boolean> {
  if (!isValidSkillName(name)) return false
  await fs.rm(path.join(getSkillsDir(), name), { recursive: true, force: true })
  return true
}

export function buildSkillPrompt(skill: Skill, userInput: string): string {
  return `${skill.content}\n\n---\nUser Request: ${userInput}`
}

// Compact catalog of the imported (non built-in) skills, shown to the maestro so it can pick one.
const BUILTIN_SKILLS = new Set(['coding', 'research', 'file'])

function frontDescription(content: string): string {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  let d = ''
  if (fm) {
    const lines = fm[1].split(/\r?\n/)
    const i = lines.findIndex((l) => /^\s*description\s*:/.test(l))
    if (i >= 0) {
      d = lines[i].replace(/^\s*description\s*:\s*/, '').trim()
      if (/^[>|][-+]?$/.test(d) || d === '') d = (lines[i + 1] ?? '').trim()
    }
  }
  if (!d) d = content.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('---'))?.replace(/^#+/, '').trim() ?? ''
  return d.replace(/^["']|["']$/g, '').slice(0, 100)
}

export async function skillCatalog(): Promise<{ name: string; description: string }[]> {
  const all = await listSkillDetails()
  return all
    .filter((s) => s.enabled && !BUILTIN_SKILLS.has(s.name))
    .map((s) => ({ name: s.name, description: frontDescription(s.content) }))
}
