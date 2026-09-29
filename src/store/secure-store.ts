import Store from 'electron-store'

type StoreSchema = {
  OPENROUTER_API_KEY: string
  GEMINI_API_KEY: string
  OPENAI_API_KEY: string
  ANTHROPIC_API_KEY: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let store: any
try {
  store = new (Store as any)({ name: 'secure-keys', encryptionKey: 'my-router-key' })
} catch {
  store = { get: (k: string) => process.env[k], set: () => {}, has: () => false }
}

export function getApiKey(key: keyof StoreSchema): string {
  try {
    return store.get(key) || process.env[key] || ''
  } catch {
    return process.env[key] || ''
  }
}

export function setApiKey(key: keyof StoreSchema, value: string): void {
  try {
    store.set(key, value)
  } catch {
    // ignore: store unavailable
  }
}

export function hasApiKey(key: keyof StoreSchema): boolean {
  try {
    return !!store.get(key) || !!process.env[key]
  } catch {
    return !!process.env[key]
  }
}
