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
  // electron-store v11 is ESM-only; when bundled as CJS the constructor is on `.default`.
  const Ctor = (Store as any).default ?? Store
  store = new Ctor({ name: 'secure-keys', encryptionKey: 'my-router-key' })
} catch (e) {
  console.error('[secure-store] falling back to in-memory keys:', e)
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

// Generic named secrets (e.g. API keys of user-added custom models).
export function getSecret(name: string): string {
  try {
    return store.get(`secret:${name}`) || ''
  } catch {
    return ''
  }
}

export function setSecret(name: string, value: string): void {
  try {
    if (value) store.set(`secret:${name}`, value)
    else store.delete(`secret:${name}`)
  } catch {
    // ignore: store unavailable
  }
}
