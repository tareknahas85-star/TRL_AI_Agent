import { readJson, writeJson } from './json-store'
import { getSecret, setSecret } from '../store/secure-store'
import { listAgents } from './agents'
import { cloudMemoryPack } from './agent-memory'
import { randomBytes } from 'crypto'
import { mailScript } from './mail-script'

// Link to the Cloudflare gate (trl-agent-gate). The gate owns the Telegram webhook, so while this is on the app
// does NOT call getUpdates: it polls the gate's inbox instead. Each poll also tells the gate "the PC is online",
// so messages are routed here when the PC is on and to the cloud runner when it is off.
const FILE = 'gate.json'
const KEY = 'gate-key'
type Cfg = { enabled: boolean; url: string }

export function gateState(): Cfg & { hasKey: boolean } {
  const c = { enabled: false, url: '', ...readJson<Partial<Cfg>>(FILE, {}) }
  return { enabled: !!c.enabled, url: String(c.url ?? '').trim().replace(/\/+$/, ''), hasKey: !!getSecret(KEY) }
}

export function setGate(p: { enabled?: boolean; url?: string; key?: string }): ReturnType<typeof gateState> {
  const cur = gateState()
  const url = (p.url ?? cur.url).trim().replace(/\/+$/, '')
  if (url && !/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('الرابط لازم يكون https بدون مسار')
  writeJson(FILE, { enabled: p.enabled ?? cur.enabled, url })
  if (typeof p.key === 'string' && p.key.trim()) setSecret(KEY, p.key.trim())
  return gateState()
}

export function gateReady(): boolean {
  const s = gateState()
  return s.enabled && s.hasKey && !!s.url
}

async function gateFetch(path: string, init?: { method?: string; body?: string }, timeoutMs = 15000): Promise<Response | null> {
  const s = gateState()
  const key = getSecret(KEY)
  if (!s.url || !key) return null
  try {
    return await fetch(s.url + path, {
      method: init?.method ?? 'GET',
      headers: { 'x-gate-key': key, 'content-type': 'application/json' },
      body: init?.body,
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    return null
  }
}

export type InboxItem = { id: number; ts: number; type: 'msg' | 'agent' | 'stop'; text?: string; agent?: string; job?: string }

/** Post progress/final text of a phone-started job to the gate (the phone polls it; Telegram is optional). */
export async function postResult(job: string, kind: 'say' | 'done' | 'fail', text: string): Promise<void> {
  if (!/^[0-9a-f]{12}$/.test(job)) return
  await gateFetch('/result', { method: 'POST', body: JSON.stringify({ job, kind, text: text.slice(0, 3500) }) }).catch(() => null)
}

/** Long-ish poll of the inbox. Also counts as the heartbeat. */
export async function pollInbox(after: number): Promise<{ items: InboxItem[]; last: number } | null> {
  const r = await gateFetch(`/inbox?after=${Math.max(0, Math.floor(after))}`)
  if (!r || !r.ok) return null
  try {
    const j = (await r.json()) as { items?: InboxItem[]; last?: number }
    return { items: Array.isArray(j.items) ? j.items : [], last: Number(j.last) || 0 }
  } catch {
    return null
  }
}

export async function syncAgents(): Promise<boolean> {
  const body = JSON.stringify(listAgents().map((a) => ({ name: a.name, prompt: a.prompt, runOn: a.runOn, memory: a.memory, model: a.model, tool: a.tool, schedule: a.schedule, sources: a.sources })))
  const r = await gateFetch('/agents', { method: 'PUT', body })
  if (!r || !r.ok) return false
  // The filtered basic-facts pack for cloud agents (best effort: agents still work if this fails).
  await gateFetch('/memory', { method: 'PUT', body: JSON.stringify({ text: cloudMemoryPack().text }) }).catch(() => null)
  return true
}

// A narrow key for the phone app (it can only ask the gate for status and send a task, exactly like the Telegram bot).
// Generated here, registered at the gate with the app key, then handed to the paired phone over the encrypted link.
const PHONE_KEY = 'gate-phone-key'
let phoneKeyRegistered = ''
export async function phoneGateInfo(): Promise<{ url: string; key: string } | null> {
  if (!gateReady()) return null
  let key = getSecret(PHONE_KEY)
  if (!key) {
    key = randomBytes(24).toString('hex')
    setSecret(PHONE_KEY, key)
  }
  if (phoneKeyRegistered !== key) {
    const r = await gateFetch('/phone-key', { method: 'PUT', body: JSON.stringify({ key }) })
    if (!r || !r.ok) return null
    phoneKeyRegistered = key
  }
  return { url: gateState().url, key }
}

/** 1 = approved, 0 = rejected, null = no answer yet. */
export async function approvalDecision(id: string): Promise<0 | 1 | null> {
  if (!/^[0-9a-f]{12}$/.test(id)) return null
  const r = await gateFetch(`/approval/${id}`)
  if (!r || !r.ok) return null
  try {
    const j = (await r.json()) as { v?: number }
    return j.v === 1 ? 1 : j.v === 0 ? 0 : null
  } catch {
    return null
  }
}

export async function testGate(): Promise<{ ok: boolean; error?: string }> {
  const s = gateState()
  if (!s.url) return { ok: false, error: 'ما في رابط' }
  if (!s.hasKey) return { ok: false, error: 'ما في مفتاح' }
  const r = await gateFetch('/agents')
  if (!r) return { ok: false, error: 'ما قدرت أوصل للبوابة' }
  if (r.status === 401) return { ok: false, error: 'المفتاح غلط' }
  if (!r.ok) return { ok: false, error: 'خطأ ' + r.status }
  return (await syncAgents()) ? { ok: true } : { ok: false, error: 'فشلت مزامنة الوكلاء' }
}
/** Wizard step: register a fresh write-only mailbox key at the gate and return the ready-to-paste Apps Script. */
export async function linkMailbox(srcRaw: string): Promise<{ ok: boolean; script?: string; error?: string }> {
  const s = gateState()
  if (!s.url || !s.hasKey) return { ok: false, error: 'اربط البوابة أول (الرابط والمفتاح)' }
  const src = String(srcRaw || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main'
  const key = randomBytes(32).toString('hex')
  const r = await gateFetch('/mail-key', { method: 'PUT', body: JSON.stringify({ key }) })
  if (!r) return { ok: false, error: 'ما قدرت أوصل للبوابة' }
  if (!r.ok) return { ok: false, error: r.status === 404 ? 'البوابة عندك قديمة: لازم تعمل deploy للنسخة الجديدة (wrangler deploy)' : 'رفضت البوابة (HTTP ' + r.status + ')' }
  return { ok: true, script: mailScript(s.url, key, src) }
}
