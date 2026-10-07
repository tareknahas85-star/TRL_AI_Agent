import * as path from 'path'
import * as os from 'os'
let base = ''
export function setComputerBase(dir?: string): void { base = dir || '' }
/** Relative paths resolve against the active project folder (else the user's home) - never the app's own cwd. */
export function rp(p: string): string {
  if (!p) return p
  return path.isAbsolute(p) ? p : path.resolve(base || os.homedir(), p)
}
