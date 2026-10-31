import fs from 'fs'
import path from 'path'

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-e2e', 'release', '_zero-byte-quarantine'])

/** 5.16: ملفات تشغيل StudyBuddy (السجل والتقارير والحجر) بتنكتب جوّا مجلد build إذا موجود، مو بجذر المشروع. */
export function workDir(projectDir: string): string {
  const b = path.join(projectDir, 'build')
  return fs.existsSync(b) && fs.statSync(b).isDirectory() ? b : projectDir
}
// 5.17.14: ملف 0 بايت جديد باسم قصير جداً (x.pass, a.txt): نفايات أوامر الشيل، بيتحجر كمان.
const TINY_STEM = /^[^.]{1,2}\.[A-Za-z0-9]{1,8}$/
const ALLOWED_EMPTY = new Set(['.gitkeep', '.keep', '__init__.py', '.nojekyll', '.gitignore', '.npmrc'])
const FRAGMENT = /[()[\]{},;"'<>=|]|^[^.]+$/

/** 5.15.0: ملفات 0 بايت جديدة بأسماء شظايا أوامر (غلط اقتباس/redirect) بتنقل لمجلد حجر بدل ما تبقى بالمشروع. ما في حذف. */
export function quarantineEmptyFragments(projectDir: string, since: number): string[] {
  const moved: string[] = []
  const scan = (dir: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < 1 && !SKIP.has(e.name) && !e.name.startsWith('.')) scan(p, depth + 1)
        continue
      }
      if (!e.isFile() || ALLOWED_EMPTY.has(e.name)) continue
      try {
        const st = fs.statSync(p)
        if (st.size === 0 && st.mtimeMs >= since - 1000 && (FRAGMENT.test(e.name) || TINY_STEM.test(e.name))) {
          const qd = path.join(workDir(projectDir), '_zero-byte-quarantine')
          fs.mkdirSync(qd, { recursive: true })
          let dest = path.join(qd, e.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'empty')
          for (let i = 1; fs.existsSync(dest); i++) dest = dest.replace(/(_\d+)?$/, '_' + i)
          fs.renameSync(p, dest)
          moved.push(path.relative(projectDir, p))
        }
      } catch {
        /* best-effort */
      }
    }
  }
  scan(projectDir, 0)
  return moved
}

/** يضيف السجل الآلي (من البرنامج) لنهاية FINAL-REPORT.md بالمشروع (أو build\), وإذا ما في بيعمل RUN-LOG-AUTO.md. بيضيف بس، ما بيعدّل الموجود. */
export function appendRunLog(projectDir: string, block: string): string | null {
  try {
    const work = workDir(projectDir)
    const cands = [path.join(work, 'FINAL-REPORT.md'), path.join(projectDir, 'FINAL-REPORT.md')]
    const target = cands.find((c) => fs.existsSync(c)) ?? path.join(work, 'RUN-LOG-AUTO.md')
    fs.appendFileSync(target, '\n\n' + block + '\n', 'utf8')
    return target
  } catch {
    return null
  }
}
