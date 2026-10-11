import { telegramState, tgApi, sendTelegramText } from './telegram'
import { activeProject } from './workspace'
import { cancelRun } from './progress'

// Two-way control: a message from YOUR private Telegram chat (and nobody else) runs as a task.
// Safety: only the saved chat id + same sender id, private chat only, never confidential projects,
// runs as an unattended job (no confirmation dialogs, so risky/destructive commands are refused),
// old messages are skipped on start, one task at a time.
type Runner = (text: string, projectId: string | null) => Promise<{ content: string; failed?: boolean }>
type Upd = { update_id: number; message?: { date?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } } }

export const TG_TAB = 'sched-tg'
let runner: Runner | null = null
let loopOn = false
let busy = false

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const HELP = 'أوامر:\n/status — حالة البرنامج\n/stop — إلغاء المهمة الشغالة\n/help — هالقائمة\nأي نص تاني بينفّذ كمهمة بالمشروع الفعّال (مو السري). الأوامر الخطيرة بتنرفض هون.'

async function handle(text: string): Promise<void> {
  const cmd = text.trim()
  if (/^\/(start|help)\b/i.test(cmd)) return sendTelegramText(HELP)
  if (/^\/status\b/i.test(cmd)) {
    const p = activeProject()
    return sendTelegramText(`✅ البرنامج شغّال\nالمشروع الفعّال: ${p ? p.name + (p.confidential ? ' 🔒 (سري، ما بنفذ منو)' : '') : 'ما في'}\n${busy ? '⏳ في مهمة شغالة' : 'جاهز'}`)
  }
  if (/^\/stop\b/i.test(cmd)) {
    cancelRun(TG_TAB)
    return sendTelegramText(busy ? '🛑 طلبت الإلغاء' : 'ما في مهمة شغالة')
  }
  if (cmd.startsWith('/')) return sendTelegramText('أمر مجهول.\n' + HELP)
  if (busy) return sendTelegramText('في مهمة شغالة. استنى تخلص أو ابعت /stop')
  const p = activeProject()
  if (p?.confidential) return sendTelegramText('🔒 المشروع الفعّال سري. ما بنفذ مهام من تيليغرام عليه. غيّر المشروع من البرنامج.')
  if (!runner) return sendTelegramText('البرنامج مو جاهز.')
  busy = true
  try {
    await sendTelegramText('⏳ استلمت، عم نفّذ' + (p ? ' بمشروع ' + p.name : '') + '…')
    const r = await runner(cmd, p?.id ?? null)
    await sendTelegramText((r.failed ? '⚠️ ' : '✅ ') + (r.content || '(بدون رد)'))
  } catch (e) {
    await sendTelegramText('⚠️ خطأ: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    busy = false
  }
}

async function drain(): Promise<number> {
  const r = await tgApi('getUpdates', { offset: -1, limit: 1 })
  const list = (r.ok ? (r.result as Upd[]) : []) ?? []
  return list.length ? list[list.length - 1].update_id + 1 : 0
}

async function loop(): Promise<void> {
  let offset = 0
  let primed = false
  let fails = 0
  while (loopOn) {
    const c = telegramState()
    if (!(c.enabled && c.inbound && c.hasToken && c.chatId)) {
      primed = false
      await sleep(5000)
      continue
    }
    if (!primed) {
      offset = await drain() // skip anything sent while the feature was off
      primed = true
    }
    const r = await tgApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000)
    if (!r.ok) {
      fails++
      await sleep(Math.min(30000, 3000 * fails))
      continue
    }
    fails = 0
    for (const u of (r.result as Upd[]) ?? []) {
      offset = Math.max(offset, u.update_id + 1)
      const m = u.message
      if (!m?.text || m.chat?.type !== 'private') continue
      if (String(m.chat?.id) !== c.chatId || String(m.from?.id) !== c.chatId) continue // never answer strangers
      if (m.date && Date.now() / 1000 - m.date > 300) continue // stale
      void handle(m.text)
    }
  }
}

export function startTelegramInbound(run: Runner): void {
  runner = run
  if (loopOn) return
  loopOn = true
  void loop().catch(() => {
    loopOn = false
  })
}
