import fs from 'fs'
import path from 'path'

// Shallow file tree (2 levels, 150 entries) for the phone's project page. Names and sizes only, never contents.
export function listDirShallow(root: string): { n: string; d: boolean; s?: number }[] {
  const out: { n: string; d: boolean; s?: number }[] = []
  const skip = new Set(['node_modules', 'dist', 'out', '__pycache__', 'release'])
  const walk = (dir: string, rel: string, depth: number): void => {
    let ents: fs.Dirent[] = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of ents) {
      if (out.length >= 150) return
      if (e.isDirectory() && (e.name.startsWith('.') || skip.has(e.name))) continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) {
        out.push({ n: r, d: true })
        if (depth < 1) walk(path.join(dir, e.name), r, depth + 1)
      } else {
        let size: number | undefined
        try { size = fs.statSync(path.join(dir, e.name)).size } catch { /* ignore */ }
        out.push({ n: r, d: false, s: size })
      }
    }
  }
  walk(root, '', 0)
  return out
}
