import fs from 'fs'
import path from 'path'

// F13: atomic file write. The body goes to a temp file in the same directory, is flushed to disk,
// and only then renamed over the target, so a crash mid-write leaves either the old or the new file, never a torn one.
export function writeFileAtomic(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, body, 0, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}
