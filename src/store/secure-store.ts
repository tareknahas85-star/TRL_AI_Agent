import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

type StoreSchema = {
  OPENROUTER_API_KEY: string
  GEMINI_API_KEY: string
  OPENAI_API_KEY: string
  ANTHROPIC_API_KEY: string
  HUGGINGFACE_API_KEY: string
  VIRUSTOTAL_API_KEY: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Keys live in an encrypted file. The encryption key is random per install and is itself protected by the
// operating system (Windows DPAPI / macOS Keychain / Linux keyring) through Electron safeStorage, so a copied
// userData folder is useless on another machine or account. Older installs used a fixed key written in the code:
// their keys are moved into the new store once, then the old file is removed.
// If the OS cannot protect a key (for example Linux without a keyring) we keep the previous behaviour.
const LEGACY_KEY = 'my-router-key'
let store: any
let mode: 'os-protected' | 'legacy' | 'memory' = 'memory'

function ctor(): any {
  return (Store as any).default ?? Store
}

function osProtectedKey(): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const f = path.join(app.getPath('userData'), 'secure-keys.key')
    if (fs.existsSync(f)) return safeStorage.decryptString(fs.readFileSync(f))
    const k = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(f, safeStorage.encryptString(k))
    return k
  } catch (e) {
    console.error('[secure-store] OS key unavailable:', e)
    return null
  }
}

function init(): any {
  if (store) return store
  try {
    const C = ctor()
    const k = osProtectedKey()
    if (k) {
      const fresh = new C({ name: 'secure-keys-v2', encryptionKey: k })
      try {
        const old = new C({ name: 'secure-keys', encryptionKey: LEGACY_KEY })
        const oldData = { ...(old.store as Record<string, unknown>) }
        const n = Object.keys(oldData).length
        if (n > 0) {
          for (const [kk, v] of Object.entries(oldData)) if (fresh.get(kk) === undefined) fresh.set(kk, v)
          const ok = Object.keys(oldData).every((kk) => JSON.stringify(fresh.get(kk)) === JSON.stringify(oldData[kk]))
          if (ok) fs.rmSync(old.path, { force: true })
        } else {
          fs.rmSync(old.path, { force: true })
        }
      } catch {
        /* no legacy file, or it could not be read: leave it alone */
      }
      store = fresh
      mode = 'os-protected'
    } else {
      store = new C({ name: 'secure-keys', encryptionKey: LEGACY_KEY })
      mode = 'legacy'
    }
  } catch (e) {
    console.error('[secure-store] falling back to in-memory keys:', e)
    store = { get: (k: string) => process.env[k], set: () => {}, has: () => false, delete: () => {} }
    mode = 'memory'
  }
  return store
}

/** How the keys are protected right now (shown in Settings). */
export function secureStoreMode(): 'os-protected' | 'legacy' | 'memory' {
  init()
  return mode
}

export function getApiKey(key: keyof StoreSchema): string {
  try {
    return init().get(key) || process.env[key] || ''
  } catch {
    return process.env[key] || ''
  }
}

export function setApiKey(key: keyof StoreSchema, value: string): void {
  try {
    init().set(key, value)
  } catch {
    // ignore: store unavailable
  }
}

export function hasApiKey(key: keyof StoreSchema): boolean {
  try {
    return !!init().get(key) || !!process.env[key]
  } catch {
    return !!process.env[key]
  }
}

// Generic named secrets (e.g. API keys of user-added custom models, the Telegram bot token).
export function getSecret(name: string): string {
  try {
    return init().get(`secret:${name}`) || ''
  } catch {
    return ''
  }
}

export function setSecret(name: string, value: string): void {
  try {
    if (value) init().set(`secret:${name}`, value)
    else init().delete(`secret:${name}`)
  } catch {
    // ignore: store unavailable
  }
}
/** Keys as a legacy-format file (fixed key) so a password-protected settings bundle can be moved to another machine/OS. */
export function exportKeysFile(): Buffer | null {
  try {
    const st = init()
    if (mode !== 'os-protected') {
      const f = (st as any).path as string | undefined
      return f && fs.existsSync(f) ? fs.readFileSync(f) : null
    }
    const C = ctor()
    const tmp = new C({ name: 'secure-keys-export', encryptionKey: LEGACY_KEY })
    tmp.clear()
    for (const [k, v] of Object.entries(st.store as Record<string, unknown>)) tmp.set(k, v)
    const buf = fs.readFileSync(tmp.path)
    fs.rmSync(tmp.path, { force: true })
    return buf
  } catch {
    return null
  }
}