import fs from 'fs'
import path from 'path'
import { app } from 'electron'

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

export function writeJson(name: string, data: unknown): void {
  const file = dataFile(name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
