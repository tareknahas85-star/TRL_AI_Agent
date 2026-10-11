import fs from 'fs'
import path from 'path'

export const isWin = process.platform === 'win32'
export const isLinux = process.platform === 'linux'

// Looks for an executable on PATH (adds .exe on Windows).
export function findOnPath(name: string): string | null {
  const file = isWin && !name.endsWith('.exe') ? name + '.exe' : name
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, file)
    if (fs.existsSync(p)) return p
  }
  return null
}
