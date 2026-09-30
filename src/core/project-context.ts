import fs from 'fs'
import path from 'path'
import type { Project } from './workspace'

const IGNORE = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '__pycache__', '.venv', 'venv', '.cache', 'release', 'coverage'])
const DOCS = ['CLAUDE.md', 'README.md', 'readme.md', 'README.txt', 'package.json']
const MAX_TREE_LINES = 120
const MAX_DOC_CHARS = 1500

function buildTree(root: string, maxDepth = 3): { lines: string[]; more: boolean } {
  const lines: string[] = []
  let more = false
  const walk = (dir: string, prefix: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.isDirectory() && (IGNORE.has(e.name) || e.name.startsWith('.'))) continue
      if (lines.length >= MAX_TREE_LINES) {
        more = true
        return
      }
      lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`)
      if (e.isDirectory() && depth < maxDepth) walk(path.join(dir, e.name), prefix + '  ', depth + 1)
    }
  }
  walk(root, '', 1)
  return { lines, more }
}

/** Context block describing the active project: path, file tree and the head of key docs. */
export function buildProjectContext(project: Project): string {
  const head = `ACTIVE PROJECT: "${project.name}"\nFolder: ${project.path}\n`
  if (!fs.existsSync(project.path)) return head + 'Note: this folder no longer exists on disk.'
  const { lines, more } = buildTree(project.path)
  let out = head
  out +=
    'You can see this project. Its files are listed below, and the tools readFile/listFiles (relative paths inside the project) are available to open them. ' +
    'Never claim you cannot access the project folder; if something is not listed, say it is not in the project.\n\n'
  out += lines.length ? `FILES:\n${lines.join('\n')}${more ? '\n… (more files not shown)' : ''}\n` : 'FILES: (the folder is empty)\n'
  for (const d of DOCS) {
    const f = path.join(project.path, d)
    try {
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const txt = fs.readFileSync(f, 'utf-8').slice(0, MAX_DOC_CHARS)
        out += `\n--- ${d} (start) ---\n${txt}\n`
      }
    } catch {
      /* unreadable */
    }
    if (out.length > 7000) break
  }
  return out
}