import { BrowserWindow } from 'electron'
import { readJson, writeJson } from './json-store'
import { getSecret, setSecret } from '../store/secure-store'

// Optional phone alert (Telegram bot) when a long task finishes while the user is away from the app.
// Privacy: only a short generic line is sent. For confidential projects nothing about the content is sent.
type Cfg = { enabled: boolean; chatId: string; minSeconds: number; inbound: boolean }
const FILE = 'telegram.json'
const TOKEN = 'telegram-bot-token'
const def: Cfg = { enabled: false, chatId: '', minSeconds: 20, inbound: false }

export function telegramState(): Cfg & { hasToken: boolean } {
  const c = { ...def, ...readJson<Partial<Cfg>>(FILE, {}) }
  return { enabled: !!c.enabled, chatId: String(c.chatId ?? ''), minSeconds: Math.max(0, Number(c.minSeconds) || 0), inbound: !!c.inbound, hasToken: !!getSecret(TOKEN) }
}

export function setTelegram(p: { enabled?: boolean; chatId?: string; minSeconds?: number; token?: string; inbound?: boolean }): ReturnType<typeof telegramState> {
  const cur = telegramState()
  writeJson(FILE, {
    enabled: p.enabled ?? cur.enabled,
    chatId: (p.chatId ?? cur.chatId).trim(),
    minSeconds: p.minSeconds ?? cur.minSeconds,
    inbound: p.inbound ?? cur.inbound
  })
  if (typeof p.token === 'string' && p.token.trim()) setSecret(TOKEN, p.token.trim())
  return telegramState()
}

export function clearTelegramToken(): void {
  setSecret(TOKEN, '')
}

export async function tgApi(method: string, body?: Record<string, unknown>, timeoutMs = 15000): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const token = getSecret(TOKEN)
  if (!token) return { ok: false, description: 'ما في توكن للبوت' }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return (await r.json()) as { ok: boolean; result?: unknown; description?: string }
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) }
  }
}

export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const c = telegramState()
  if (!c.chatId) return { ok: false, error: 'ما في Chat ID' }
  const r = await tgApi('sendMessage', { chat_id: c.chatId, text: text.slice(0, 600), disable_web_page_preview: true })
  return r.ok ? { ok: true } : { ok: false, error: r.description ?? 'فشل الإرسال' }
}

/** Finds the chat id of the last person who messaged the bot (user must send it any message first). */
export async function detectChatId(): Promise<{ ok: boolean; chatId?: string; name?: string; error?: string }> {
  const r = await tgApi('getUpdates', { limit: 20 })
  if (!r.ok) return { ok: false, error: r.description ?? 'فشل' }
  const list = (r.result as { message?: { chat?: { id?: number; first_name?: string; title?: string } } }[]) ?? []
  const last = [...list].reverse().find((u) => u.message?.chat?.id)
  if (!last?.message?.chat?.id) return { ok: false, error: 'ما في رسائل للبوت. ابعتله أي كلمة من تيليغرام وجرّب مرة تانية' }
  return { ok: true, chatId: String(last.message.chat.id), name: last.message.chat.first_name ?? last.message.chat.title }
}

const userAway = (): boolean => {
  const wins = BrowserWindow.getAllWindows()
  return !wins.some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused())
}

export function notifyDone(i: { unattended: boolean; confidential: boolean; ms: number; model: string; preview: string; failed?: boolean }): void {
  try {
    const c = telegramState()
    if (!c.enabled || !c.hasToken || !c.chatId) return
    if (!i.unattended && !userAway()) return
    if (i.ms < c.minSeconds * 1000) return
    const secs = Math.round(i.ms / 1000)
    const head = i.failed ? '⚠️ المهمة انتهت بمشكلة' : '✅ خلصت المهمة'
    const body = i.confidential ? 'مشروع سري — ما بنبعت تفاصيل' : i.preview.replace(/\s+/g, ' ').slice(0, 60)
    void sendTelegram(`${head} (${secs}ث)\n${body}${i.confidential ? '' : '\n' + i.model}`)
  } catch {
    /* alert only, never break the chat */
  }
}

/** Longer replies for the two-way control (split to fit Telegram's 4096-char limit, max 3 parts). */
export async function sendTelegramText(text: string): Promise<void> {
  const c = telegramState()
  if (!c.chatId || !c.hasToken) return
  const parts: string[] = []
  let rest = text.trim() || '(فاضي)'
  while (rest.length && parts.length < 3) {
    parts.push(rest.slice(0, 3500))
    rest = rest.slice(3500)
  }
  if (rest.length) parts[parts.length - 1] += '\n…(مقصوص)'
  for (const p of parts) await tgApi('sendMessage', { chat_id: c.chatId, text: p, disable_web_page_preview: true })
}
