import fs from 'fs'

// F30: keep a log file small. Past the limit the old file moves to <file>.1 (one generation kept).
export const LOG_MAX_BYTES = 2 * 1024 * 1024

export function rotateLogFile(file: string, max = LOG_MAX_BYTES): void {
  try {
    if (fs.statSync(file).size > max) fs.renameSync(file, file + '.1')
  } catch {
    /* no log yet, or it cannot be rotated: keep appending */
  }
}
