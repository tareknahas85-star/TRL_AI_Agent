import { telegramState, tgApi, sendTelegramText } from './telegram'
import { activeProject } from './workspace'
import { cancelRun } from './progress'
import { pendingApprovalIds, resolveApproval } from './tg-approve'
import { approvalDecision, gateReady, pollInbox, syncAgents, type InboxItem } from './gate'
import { listAgents, matchAgent, type Agent } from './agents'

// Two-way control: a message from YOUR private Telegram chat (and nobody else) runs as a task.
// Safety: only the saved chat id + same sender id, private chat only, never confidential projects,
// runs as an unattended job (no confirmation dialogs, so risky/destructive commands are refused),
// old messages are skipped on start, one task at a time.
// Two ways to receive messages: direct (getUpdates) or through the Cloudflare gate (when "gate mode" is on:
// the gate owns the Telegram webhook, so getUpdates is not used and the inbox is polled instead).
type Runner = (text: string, projectId: string | null) => Promise<{ content: string; failed?: boolean }>
type Upd = {
  update_id: number
  message?: { date?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } }
  callback_query?: { id: string; data?: string; from?: { id?: number }; message?: { message_id?: number; chat?: { id?: number; type?: string } } }
}

export const TG_TAB = 'sched-tg'
let runner: Runner | null = null
let loopOn = false
let busy = false

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const MODE = { local: 'محلي', cloud: 'سحابي', auto: 'تلقائي' } as const

const HELP = 'أوامر:\n/status — حالة البرنامج\n/stop — إلغاء المهمة الشغالة\n/agents — لائحة الوكلاء\n/agent <اسم الوكيل> <المهمة> — شغّل وكيل\n/help — هالقائمة\nأي نص تاني بينفّذ كمهمة بالمشروع الفعّال (مو السري). الأوامر الخطيرة بتنرفض هون.'

async function runTask(text: string, label?: string): Promise<void> {
  if (busy) return sendTelegramText('في مهمة شغالة. استنى تخلص أو ابعت /stop')
  const p = activeProject()
  if (p?.confidential) return sendTelegramText('🔒 المشروع الفعّال سري. ما بنفذ مهام من تيليغرام عليه. غيّر المشروع من البرنامج.')
  if (!runner) return sendTelegramText('البرنامج مو جاهز.')
  busy = true
  try {
    await sendTelegramText('⏳ استلمت، عم نفّذ' + (label ? ' (' + label + ')' : '') + (p ? ' بمشروع ' + p.name : '') + '…')
    const r = await runner(text, p?.id ?? null)
    await sendTelegramText((r.failed ? '⚠️ ' : '✅ ') + (r.content || '(بدون رد)'))
  } catch (e) {
    await sendTelegramText('⚠️ خطأ: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    busy = false
  }
}

async function runAgent(agent: Agent, task: string): Promise<void> {
  if (!task.trim()) return sendTelegramText('شو المهمة لـ ' + agent.name + '؟')
  if (agent.runOn === 'cloud') return sendTelegramText('هالوكيل مضبوط يشتغل بالسحابة بس. هاد بيحتاج وضع البوابة (Gate) مفعّل بالتطبيق.')
  return runTask((agent.prompt ? agent.prompt + '\n\n' : '') + 'المهمة: ' + task, 'الوكيل ' + agent.name)
}

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
  if (/^\/agents\b/i.test(cmd)) {
    const l = listAgents()
    return sendTelegramText(l.length ? 'الوكلاء:\n' + l.map((a) => `• ${a.name} (${MODE[a.runOn]})`).join('\n') : 'ما في وكلاء. أنشئ وكيل من تبويب "وكلاء" بالتطبيق.')
  }
  if (/^\/agent\b/i.test(cmd)) {
    const arg = cmd.replace(/^\/agent\b/i, '').trim()
    if (!arg) return sendTelegramText('الاستخدام: /agent <اسم الوكيل> <المهمة>')
    const m = matchAgent(arg)
    if (!m) return sendTelegramText('ما لقيت وكيل بهالاسم. جرّب /agents')
    return runAgent(m.agent, m.task)
  }
  if (cmd.startsWith('/')) return sendTelegramText('أمر مجهول.\n' + HELP)
  return runTask(cmd)
}

async function drain(): Promise<number> {
  const r = await tgApi('getUpdates', { offset: -1, limit: 1 })
  const list = (r.ok ? (r.result as Upd[]) : []) ?? []
  return list.length ? list[list.length - 1].update_id + 1 : 0
}

// ---- gate mode ----
let gAfter = -1
let gFails = 0
let gSynced = false

function dispatchItem(it: InboxItem): void {
  if (it.type === 'stop') {
    cancelRun(TG_TAB)
    return
  }
  if (it.type === 'agent') {
    const name = String(it.agent ?? '').toLowerCase()
    const a = listAgents().find((x) => x.name.toLowerCase() === name)
    if (!a) {
      void sendTelegramText('ما لقيت هالوكيل على الكمبيوتر. افتح تبويب "وكلاء" بالتطبيق وضغط مزامنة.')
      return
    }
    void runAgent(a, String(it.text ?? ''))
    return
  }
  if (it.type === 'msg' && it.text) void handle(String(it.text))
}

async function gateTick(): Promise<void> {
  if (!gSynced) gSynced = await syncAgents()
  const r = await pollInbox(Math.max(0, gAfter))
  if (!r) {
    gFails++
    await sleep(Math.min(30000, 3000 * gFails))
    return
  }
  gFails = 0
  const first = gAfter < 0
  for (const it of r.items) {
    if (it.id <= gAfter) continue
    const age = Date.now() - it.ts
    if (age > 300_000 || (first && age > 120_000)) continue // stale
    dispatchItem(it)
  }
  gAfter = Math.max(gAfter, r.last)
  // Approval buttons are answered at the gate (it owns the webhook); pick the decisions up here.
  const ids = pendingApprovalIds()
  for (const id of ids) {
    const v = await approvalDecision(id)
    if (v !== null) resolveApproval(`ap:${id}:${v}`)
  }
  await sleep(ids.length ? 2500 : 4000)
}

async function loop(): Promise<void> {
  let offset = 0
  let primed = false
  let fails = 0
  while (loopOn) {
    const c = telegramState()
    const viaGate = gateReady() && c.enabled && c.hasToken && !!c.chatId
    if (!viaGate && !(c.enabled && c.inbound && c.hasToken && c.chatId)) {
      primed = false
      gSynced = false
      gAfter = -1
      await sleep(5000)
      continue
    }
    if (viaGate) {
      primed = false
      await gateTick()
      continue
    }
    gSynced = false
    gAfter = -1
    if (!primed) {
      offset = await drain() // skip anything sent while the feature was off
      primed = true
    }
    const r = await tgApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000)
    if (!r.ok) {
      fails++
      await sleep(Math.min(30000, 3000 * fails))
      continue
    }
    fails = 0
    for (const u of (r.result as Upd[]) ?? []) {
      offset = Math.max(offset, u.update_id + 1)
      const cq = u.callback_query
      if (cq) {
        // Approval buttons: only from your private chat, same sender id as the saved chat id.
        if (cq.message?.chat?.type !== 'private' || String(cq.message?.chat?.id) !== c.chatId || String(cq.from?.id) !== c.chatId) continue
        const d = resolveApproval(cq.data ?? '')
        void tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: d === null ? 'انتهت صلاحية الطلب' : d ? '✔ موافق' : '⛔ مرفوض' })
        if (cq.message?.message_id) void tgApi('editMessageReplyMarkup', { chat_id: c.chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } })
        continue
      }
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