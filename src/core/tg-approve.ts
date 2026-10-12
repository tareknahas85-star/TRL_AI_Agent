import crypto from 'crypto'
import { telegramState, tgApi } from './telegram'
import { isUnattended } from './progress'
import { activeProject } from './workspace'
import { gateReady } from './gate'

// When a job runs without you at the screen (a scheduled task or a Telegram request), a pop-up on the PC would
// wait forever. Instead the approval is sent to YOUR Telegram chat as two buttons. No answer in 3 minutes = refused.
type Pending = { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout>; text: string }
const pending = new Map<string, Pending>()

/** True when this run is unattended and the two-way Telegram control is fully set up. */
export function remoteApprovalAvailable(): boolean {
  try {
    const c = telegramState()
    return isUnattended() && c.enabled && (c.inbound || gateReady()) && c.hasToken && !!c.chatId
  } catch {
    return false
  }
}

export async function askViaTelegram(title: string, detail: string, timeoutMs = 180_000): Promise<boolean> {
  const c = telegramState()
  const id = crypto.randomBytes(6).toString('hex')
  const secret = !!activeProject()?.confidential
  const body = `🔐 ${title}${!secret && detail ? '\n' + detail.replace(/\s+/g, ' ').slice(0, 300) : ''}\n(بدون رد خلال 3 دقايق = رفض)`
  const sent = await tgApi('sendMessage', {
    chat_id: c.chatId,
    text: body,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: '✅ موافق', callback_data: `ap:${id}:1` }, { text: '⛔ رفض', callback_data: `ap:${id}:0` }]] }
  })
  if (!sent.ok) return false
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      void tgApi('sendMessage', { chat_id: c.chatId, text: '⌛ انتهت مهلة الموافقة، انرفض الطلب.' })
      resolve(false)
    }, timeoutMs)
    pending.set(id, { resolve, timer, text: body })
  })
}

/** Called by the Telegram listener for a button press. Returns the decision, or null if the id is unknown/expired. */
export function resolveApproval(data: string): boolean | null {
  const m = /^ap:([0-9a-f]{12}):([01])$/.exec(data)
  if (!m) return null
  const p = pending.get(m[1])
  if (!p) return null
  clearTimeout(p.timer)
  pending.delete(m[1])
  const ok = m[2] === '1'
  p.resolve(ok)
  return ok
}

/** Ids of approval requests still waiting for an answer (the gate poller asks the gate about each). */
export function pendingApprovalIds(): string[] {
  return [...pending.keys()]
}
