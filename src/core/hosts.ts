import { readJson, writeJson } from './json-store'

// API hosts the app talks to. The user can point a provider at another compatible server (a proxy, a mirror,
// a self-hosted gateway) and reset it to the default at any time. Stored without a trailing slash.
export type HostId = 'openrouter' | 'huggingface' | 'gemini'
export const HOST_DEFAULTS: Record<HostId, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  huggingface: 'https://router.huggingface.co/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
}
const FILE = 'hosts.json'
const read = (): Partial<Record<HostId, string>> => readJson<Partial<Record<HostId, string>>>(FILE, {})

export const hostOf = (id: HostId): string => read()[id] || HOST_DEFAULTS[id]

export function hostsInfo(): Record<HostId, { value: string; default: string; custom: boolean }> {
  const cur = read()
  const out = {} as Record<HostId, { value: string; default: string; custom: boolean }>
  for (const id of Object.keys(HOST_DEFAULTS) as HostId[]) out[id] = { value: cur[id] || HOST_DEFAULTS[id], default: HOST_DEFAULTS[id], custom: !!cur[id] }
  return out
}

// Empty value = back to the default. http is only accepted for local servers (the key would travel in clear text otherwise).
export function setHost(id: HostId, raw: string): { ok: boolean; error?: string; value: string } {
  const cur = read()
  const v = raw.trim().replace(/\/+$/, '')
  if (!v || v === HOST_DEFAULTS[id]) {
    delete cur[id]
    writeJson(FILE, cur)
    return { ok: true, value: HOST_DEFAULTS[id] }
  }
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return { ok: false, error: 'الرابط مو صحيح', value: hostOf(id) }
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { ok: false, error: 'لازم https (http مسموح بس للسيرفر المحلي)', value: hostOf(id) }
  cur[id] = v
  writeJson(FILE, cur)
  return { ok: true, value: v }
}
