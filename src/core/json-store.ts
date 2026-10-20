import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { writeFileAtomic } from './json-atomic'

// Small JSON persistence in the user data dir (survives app updates).
export function dataFile(name: string): string {
  return path.join(app.getPath('userData'), name)
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf-8')) as T
  } catch {
    return fallback
  }
}

// F13: writes are atomic (temp file + fsync + rename), so a crash can't leave a half-written JSON.
export function writeJson(name: string, data: unknown): void {
  writeFileAtomic(dataFile(name), JSON.stringify(data, null, 2))
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
