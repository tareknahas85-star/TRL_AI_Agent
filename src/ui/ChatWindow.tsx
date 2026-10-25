import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { ModelPicker } from './ModelPicker'
import { ArrowUp, Bot, Check, Copy, FolderOpen, Loader2, Mic, Paperclip, Play, RotateCcw, Square, X } from 'lucide-react'
import { Markdown } from './Markdown'
import { useTheme } from './ThemeContext'
import eagle from '../renderer/src/assets/syria-eagle.svg'
import { CostDashboard } from './CostDashboard'
import { Chip } from './components/ui'
import { FileChips } from './FileChips'
import type { AttachmentInfo, ChatMode, ProjectInfo, StoredMessage } from '../preload/index.d'
import { brandOf, type Brand } from '../core/brands'

type ChatMessage = StoredMessage

const fmtSize = (n: number): string => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB')
const attBlock = (a: AttachmentInfo): string =>
  '--- ' + a.name + ' [' + a.kind + ', ' + fmtSize(a.size) + ']\npath: ' + a.path + '\n' + (a.text ?? '') + (a.note ? '\n[ملاحظة] ' + a.note : '')

const TEMPLATES: { label: string; text: string }[] = [
  { label: '✉️ راجع إيميل', text: 'راجعلي هالإيميل قبل ما ابعتو: دقّق اللغة والنبرة واقترحلي تعديلات.\n\n' },
  { label: '📊 تقرير Excel', text: 'اعملي ملف Excel فيه جدول وملخص ورسم بياني للبيانات التالية:\n\n' },
  { label: '📄 مستند Word', text: 'اكتبلي مستند Word رسمي عن:\n\n' },
  { label: '📽️ عرض PowerPoint', text: 'جهزلي عرض PowerPoint عن:\n\n' },
  { label: '📎 لخّص ملف', text: 'لخصلي الملف المرفق بنقاط واضحة وطلعلي القرارات والمهام.\n\n' },
  { label: '⚙️ سكربت PowerShell', text: 'اكتبلي سكربت PowerShell يعمل التالي:\n\n' }
]

// أوضاع المحادثة الثلاثة (فوق اختيار الموديل). كل وضع يربط بوضع التشغيل الموجود في الراوتر.
const CHAT_MODES: { id: 'chat' | 'project' | 'council'; label: string; hint: string; mode: ChatMode }[] = [
  { id: 'chat', label: '💬 محادثة عادية', hint: 'المجاني أولاً، وإذا فشل بتنتقل للمدفوع تلقائياً (بيصرف)', mode: { kind: 'free' } },
  { id: 'project', label: '🛠️ بناء مشروع', hint: 'منفّذ ومراجع من مزوّداتك (بمفاتيحك)', mode: { kind: 'auto' } },
  { id: 'council', label: '🏛️ المجلس', hint: 'نماذج مدفوعة بس، للمشاريع الكبيرة', mode: { kind: 'council' } }
]
const activeChatMode = (mode: ChatMode): string => (mode.kind === 'free' ? 'chat' : mode.kind === 'auto' ? 'project' : mode.kind === 'council' ? 'council' : '')
// القائمة تتبع الوضع: المحادثة العادية تعرض المجاني والمدفوع (المدفوع بيصير اختيار موديل محدد وبيصرف).
// المجلس بدون كاتب/ناقد: مدفوع بس.
function pickerForMode<T extends { tier: string }>(mode: ChatMode, picker: T[]): T[] {
  if (mode.kind === 'council' && !mode.author && !mode.critic) return picker.filter((p) => p.tier !== 'TIER_1_FREE' && p.tier !== 'LOCAL' && p.tier !== 'SUBSCRIPTION')
  return picker
}

function BrandAvatar({ brand }: { brand: Brand }): ReactElement {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: brand.color }} title={brand.label}>
      <svg viewBox="0 0 24 24" width="18" height="18" dangerouslySetInnerHTML={{ __html: brand.glyph }} />
    </div>
  )
}

function Avatar({ model }: { model?: string; pin?: boolean } = {}): ReactElement {
  const { palette } = useTheme()
  const brand = brandOf(model)
  if (brand) return <BrandAvatar brand={brand} />
  if (palette === 'syrian')
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: '#054239' }}>
        <img src={eagle} alt="" className="h-6 w-6" draggable={false} />
      </div>
    )
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
      <Bot size={18} />
    </div>
  )
}

type Stats = {
  masterMs: number
  execMs: number
  totalMs: number
  master: string
  masterModel: string
  complexity: string
  type: string
  promptTokens: number
  completionTokens: number
  tps: number
  est: boolean
  memory: number
  tools: string[]
  why?: string
  failures: { model: string; reason: string }[]
}

// meta looks like: "Model: X | Memory: n | Tools: t | Skill: Y | <saved text> | Tried: a -> b | Stats: {json}"
function parseMeta(meta: string): { model: string; skill: string; saved: string; tried: string[]; council: string; tools: string[]; stats: Stats | null } {
  const si = meta.indexOf(' | Stats: ')
  let stats: Stats | null = null
  if (si >= 0) {
    try {
      stats = JSON.parse(meta.slice(si + 10)) as Stats
    } catch {
      stats = null
    }
  }
  const out = { model: '', skill: '', saved: '', tried: [] as string[], council: '', tools: [] as string[], stats }
  for (const p of (si >= 0 ? meta.slice(0, si) : meta).split(' | ')) {
    const idx = p.indexOf(': ')
    const k = idx > 0 ? p.slice(0, idx) : ''
    const v = idx > 0 ? p.slice(idx + 2) : p
    if (k === 'Model') out.model = v
    else if (k === 'Skill') out.skill = v
    else if (k === 'Council') out.council = v
    else if (k === 'Tried') out.tried = v.split(' -> ').filter(Boolean)
    else if (k === 'Tools') out.tools = v === '-' ? [] : [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))]
    else if (k === 'Memory') continue
    else out.saved = p
  }
  return out
}

type AgentCard = { key: string; engine: string; role: string; last: string; at: number; started: number; n: number }
const AGENT_TAG = /^\u27e6([^|\u27e7]*)\|([^\u27e7]*)\u27e7\s*([\s\S]*)$/
const engineName = (e: string): string =>
  e.startsWith('cli:claude') ? 'Claude' + (/opus/i.test(e) ? ' Opus' : /sonnet/i.test(e) ? ' Sonnet' : '') : e === 'cli:gemini' ? 'Gemini' : e === 'cli:codex' ? 'Codex / GPT' : e

/** لوحة حيّة: مين النموذج الشغّال، شو دورو، آخر عملية، ومن أي وقت (لونها بيتحوّل إذا سكت كتير). */
function AgentPanel({ agents }: { agents: AgentCard[] }): ReactElement | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!agents.length) return null
  return (
    <div className="mt-2 w-full max-w-xl space-y-1.5">
      {agents.map((a) => {
        const idle = Math.max(0, Math.round((now - a.at) / 1000))
        const tone = idle < 60 ? 'bg-green-500' : idle < 180 ? 'bg-amber-500' : 'bg-red-500'
        return (
          <div key={a.key} className="flex items-start gap-2 rounded-xl border border-outline bg-surface px-3 py-1.5 text-[11px]">
            <span className={'mt-1 h-2 w-2 shrink-0 rounded-full ' + tone} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <b>{engineName(a.engine)}</b>
                <span className="text-muted">{a.role}</span>
                <span className="text-muted" dir="ltr">
                  {Math.round((now - a.started) / 60000)}m · {a.n} عملية
                </span>
                <span className={idle >= 180 ? 'text-warning' : 'text-muted'}>آخر نشاط قبل {idle}s</span>
              </div>
              <div className="truncate text-muted" dir="auto">
                {a.last}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
const fmtMs = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms')

function StatusBar({
  loading,
  progress,
  elapsed,
  messages
}: {
  loading: boolean
  progress: string
  elapsed: number
  messages: { meta?: string }[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [act, setAct] = useState<{ id: string; title: string; prefix: string; running: boolean; tools: number; names: string[] }[]>([])
  useEffect(() => {
    if (!open) return
    let on = true
    const tick = (): void => {
      window.api.connectors.active().then((r) => on && setAct(r)).catch(() => undefined)
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => {
      on = false
      clearInterval(t)
    }
  }, [open])
  const parsed = messages.filter((m) => m.meta).map((m) => parseMeta(m.meta as string))
  const last = parsed[parsed.length - 1]
  const st = last?.stats
  const withStats = parsed.filter((p) => p.stats)
  const totalTok = withStats.reduce((a, p) => a + (p.stats?.promptTokens ?? 0) + (p.stats?.completionTokens ?? 0), 0)
  const speeds = withStats.map((p) => p.stats?.tps ?? 0).filter((x) => x > 0)
  const avgTps = speeds.length ? speeds.reduce((a, x) => a + x, 0) / speeds.length : 0
  const failCount = withStats.reduce((a, p) => a + (p.stats?.failures.length ?? 0), 0)
  const masterLabel = st?.master === 'local' ? 'ماستر محلي' : st?.master === 'openrouter' ? 'ماستر سحابي' : st ? 'ماستر احتياطي' : ''
  return (
    <div className="mx-auto mt-1 max-w-3xl">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl px-3 py-1 text-start text-[11px] text-muted hover:bg-surface2"
      >
        {loading ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span>{progress || 'عم يشتغل…'}</span>
            <span dir="ltr">{elapsed}s</span>
          </>
        ) : st && last ? (
          <>
            <span dir="ltr" title="الموديل اللي جاوب فعلاً">جاوب: {last.model}{last.tried.length > 1 ? ` (بعد فشل ${last.tried.slice(0, -1).join(' ← ')})` : ''}</span>
            <span dir="ltr">⏱ {fmtMs(st.totalMs)}</span>
            <span dir="ltr">
              ⇅ {st.promptTokens || '—'}/{st.completionTokens}
              {st.est ? '~' : ''} tok
            </span>
            {st.tps > 0 && <span dir="ltr">⚡ {st.tps} t/s</span>}
            <span>{masterLabel}</span>
            {st.memory > 0 && <span>ذاكرة {st.memory}</span>}
            {st.tools.length > 0 && <span>أدوات {st.tools.length}</span>}
            {st.failures.length > 0 && <span className="text-warning">فشل {st.failures.length}</span>}
          </>
        ) : (
          <span>جاهز — ابعت طلب لتطلع الإحصاءات هون</span>
        )}
        <span className="ms-auto">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded-card border border-outline bg-surface p-3 text-[11px] text-muted">
          {st ? (
            <>
              <div dir="ltr">
                master: {st.masterModel || st.master} · {fmtMs(st.masterMs)} → {st.complexity}/{st.type}
              </div>
              <div dir="ltr">
                model: {fmtMs(st.execMs)} · in {st.promptTokens || '—'} · out {st.completionTokens}
                {st.est ? ' (estimated)' : ''} · {st.tps || '—'} t/s
              </div>
              {st.tools.length > 0 && <div dir="ltr">tools: {st.tools.join(', ')}</div>}
              {st.tools.length > 0 && st.why && <div>ليش هالأدوات؟ {st.why}. (بتقدر تنسّي البرنامج أي أداة من الإعدادات ← الذاكرة)</div>}
              {st.failures.map((f, i) => (
                <div key={i} dir="ltr" className="text-warning">
                  ✗ {f.model}: {f.reason}
                </div>
              ))}
            </>
          ) : (
            <div>ما في إحصاءات للرد الأخير.</div>
          )}
          <div className="border-t border-outline pt-1">
            <div className="mb-1 flex items-center gap-2">
              <span>الأدوات الشغّالة:</span>
              <button
                disabled={scanning}
                onClick={() => {
                  setScanning(true)
                  window.api.connectors.active(true).then(setAct).catch(() => undefined).finally(() => setScanning(false))
                }}
                className="rounded-full border border-outline px-2 py-0.5 text-primary hover:bg-surface2 disabled:opacity-50"
              >
                {scanning ? 'عم أفحص…' : 'فحص / تحديث'}
              </button>
            </div>
            {act.length === 0 ? (
              <div>ما في موصلات مفعّلة.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {act.map((a) => {
                  const used = !!st?.tools.some((t) => t.startsWith(a.prefix))
                  return (
                    <span key={a.id} title={a.names.join(', ')} className={`rounded-full border px-2 py-0.5 ${used ? 'border-primary text-primary' : 'border-outline'}`}>
                      <span className={a.running ? 'text-success' : 'text-muted'}>●</span> {a.title} · {a.tools || '—'}
                      {used ? ' · استُعمل بآخر رد' : ''}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          <div className="border-t border-outline pt-1">
            الجلسة: {parsed.length} ردود · {totalTok} توكن · متوسط السرعة {avgTps ? avgTps.toFixed(1) : '—'} t/s · محاولات فاشلة {failCount}
          </div>
        </div>
      )}
    </div>
  )
}

function tierChip(saved: string): { label: string; cls: string } {
  if (saved.includes('اشتراكك')) return { label: 'اشتراكك', cls: 'bg-primary/15 text-primary' }
  if (saved.includes('مجاني')) return { label: 'مجاني', cls: 'bg-success/15 text-success' }
  if (saved.includes('رخيص')) return { label: 'رخيص', cls: 'bg-primary/15 text-primary' }
  if (saved.includes('مخصص')) return { label: 'مخصص', cls: 'bg-surface2 text-fg' }
  return { label: 'قوي', cls: 'bg-warning/20 text-warning' }
}

function MsgFooter({ text, at }: { text: string; at?: number }): ReactElement {
  const [ok, setOk] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setOk(true)
    setTimeout(() => setOk(false), 1500)
  }
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
      <button onClick={copy} title="انسخ الرسالة كاملة" aria-label="انسخ الرسالة كاملة" className="rounded-full p-1 hover:bg-surface2">
        {ok ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {at ? <span>{new Date(at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })}</span> : null}
    </div>
  )
}

// تفاصيل التنفيذ: مين رد، ومين فشل وليش، والوقت. مخفية افتراضياً، بتنفتح بالضغط.
function ExecDetails({ meta }: { meta: string }): ReactElement {
  const m = parseMeta(meta)
  const st = m.stats as unknown as { failures?: { model: string; reason: string }[]; why?: string; complexity?: string; totalMs?: number } | null
  const failures = st?.failures ?? []
  return (
    <details className="mt-3 rounded-lg border border-outline bg-surface2/60 p-3 text-[12px] leading-6">
      <summary className="cursor-pointer select-none font-semibold text-muted">
        🔍 شو صار بالخلفية {failures.length ? `(${failures.length} تحويل)` : '(بدون تحويلات)'}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {failures.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span>❌</span>
            <span>
              <span dir="ltr" className="font-mono">{f.model}</span> — {f.reason}
            </span>
          </li>
        ))}
        <li className="flex gap-2">
          <span>✅</span>
          <span>
            الرد من <span dir="ltr" className="font-mono">{m.model}</span>
            {m.tools.length > 0 && ` · أدوات: ${m.tools.length}`}
          </span>
        </li>
      </ul>
      <div className="mt-2 text-muted">
        {st?.complexity && <span>التعقيد: {st.complexity} · </span>}
        {st?.totalMs ? <span>الوقت: {(st.totalMs / 1000).toFixed(1)}s · </span> : null}
        {m.saved && <span>{m.saved} · </span>}
        {st?.why && <span>السبب: {st.why}</span>}
      </div>
      {m.council && <div className="mt-1">🏛️ المجلس: {m.council}</div>}
    </details>
  )
}

function MetaBar({ meta }: { meta: string }): ReactElement {
  const m = parseMeta(meta)
  const t = tierChip(m.saved)
  return (
    <>
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Chip cls={t.cls}>{t.label}</Chip>
      <Chip>
        <span dir="ltr">{m.model}</span>
      </Chip>
      {m.skill && m.skill !== 'none' && <Chip cls="bg-primary/10 text-primary">{m.skill}</Chip>}
      {m.tools.length > 0 && (
        <Chip cls="bg-surface2 text-muted">
          <span title={m.tools.join('، ')} dir="ltr">
            🔧 {m.tools.slice(0, 3).map((x) => x.replace(/^mcp__/, '').replace(/__/g, ' › ')).join(' · ')}
            {m.tools.length > 3 ? `  +${m.tools.length - 3}` : ''}
          </span>
        </Chip>
      )}
      {m.council && <Chip cls="bg-primary/10 text-primary">🏛️ {m.council}</Chip>}
    </div>
    <ExecDetails meta={meta} />
    </>
  )
}

function StatusChips(): ReactElement | null {
  const [st, setSt] = useState<{ key: boolean; ollama: boolean; localMaster: boolean; mcpOn: number; mcpTotal: number; free: { count: number; limit: number; limited: boolean } } | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.api.status().then((x) => alive && setSt(x)).catch(() => undefined)
    }
    load()
    const id = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!st) return null
  const dot = (ok: boolean): string => (ok ? 'bg-success' : 'bg-danger')
  const item = (ok: boolean, label: string): ReactElement => (
    <Chip>
      <span className={`inline-block h-2 w-2 rounded-full ${dot(ok)}`} /> {label}
    </Chip>
  )
  return (
    <>
      {item(st.key, 'OpenRouter')}
      {item(st.ollama, 'Ollama')}
      {item(st.localMaster, 'ماستر محلي')}
      {item(st.mcpTotal === 0 || st.mcpOn > 0, `MCP ${st.mcpOn}/${st.mcpTotal}`)}
      {item(!st.free.limited && st.free.count < st.free.limit - 5, st.free.limited ? '🆓 خلصت كوتا اليوم' : `🆓 ${st.free.count}/${st.free.limit} اليوم`)}
    </>
  )
}

export function ChatWindow({
  tabId,
  active,
  conversationId,
  initialMessages,
  project,
  mode,
  onModeChange,
  onBusy,
  onSaved
}: {
  tabId: string
  active: boolean
  conversationId: string | null
  initialMessages: ChatMessage[]
  project: ProjectInfo | null
  mode: ChatMode
  onModeChange: (m: ChatMode) => void
  onBusy: (b: boolean) => void
  onSaved: (id: string, title?: string) => void
}): ReactElement {
  // F17: the unsent draft is saved per tab as you type, so a crash or quit never loses it.
  const draftKey = 'air.draft.v1.' + tabId
  const [input, setInput] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      if (input) localStorage.setItem(draftKey, input)
      else localStorage.removeItem(draftKey)
    } catch {
      // storage unavailable: the draft just won't survive a restart
    }
  }, [input, draftKey])
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const convIdRef = useRef<string | null>(conversationId)
  const [progress, setProgress] = useState('')
  const [agents, setAgents] = useState<AgentCard[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [atts, setAtts] = useState<AttachmentInfo[]>([])
  const [dragOver, setDragOver] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const lastTypedRef = useRef('')
  const [prep, setPrep] = useState(0)
  // voice note: record with the mic, transcribe locally (Whisper) and drop the text into the input box
  const [rec, setRec] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const toggleRec = async (): Promise<void> => {
    if (recRef.current) {
      recRef.current.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        recRef.current = null
        setRec(false)
        if (!chunks.length) return
        setPrep((n) => n + 1)
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const [a] = await window.api.attach.savePasted('voice-' + Date.now() + '.webm', await blob.arrayBuffer(), project?.id ?? null)
          const txt = a?.text?.trim()
          if (txt) setInput((v) => (v ? v + ' ' : '') + txt)
          else addAtts(a ? [a] : [])
        } finally {
          setPrep((n) => Math.max(0, n - 1))
        }
      }
      recRef.current = mr
      mr.start()
      setRec(true)
    } catch (e) {
      console.warn('mic failed', e)
    }
  }
  const addAtts = (list: AttachmentInfo[]): void => setAtts((a) => [...a, ...list.filter((x) => !a.some((y) => y.path === x.path))])
  const pickFiles = async (): Promise<void> => {
    try {
      setPrep((n) => n + 1)
      addAtts(await window.api.attach.pick(project?.id ?? null))
    } catch (e) {
      console.warn('attach pick failed', e)
    } finally {
      setPrep((n) => Math.max(0, n - 1))
    }
  }
  const addFiles = async (files: File[]): Promise<void> => {
    setPrep((n) => n + 1)
    try {
    const paths: string[] = []
    for (const f of files) {
      const p = window.api.attach.pathFor(f)
      if (p) paths.push(p)
      else addAtts(await window.api.attach.savePasted(f.name || 'pasted-' + Date.now() + '.png', await f.arrayBuffer(), project?.id ?? null))
    }
    if (paths.length) addAtts(await window.api.attach.prepare(paths, project?.id ?? null))
    } finally {
      setPrep((n) => Math.max(0, n - 1))
    }
  }
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  useEffect(
    () =>
      window.api.onProgress((id, t) => {
        if (id !== tabId) return
        const m = AGENT_TAG.exec(t)
        if (!m) return setProgress(t)
        const [, engine, role, text] = m
        setProgress(text)
        const nowMs = Date.now()
        setAgents((prev) => {
          const key = engine + '|' + role
          const i = prev.findIndex((a) => a.key === key)
          if (i < 0) return [...prev, { key, engine, role, last: text, at: nowMs, started: nowMs, n: 1 }]
          const next = prev.slice()
          next[i] = { ...next[i], last: text, at: nowMs, n: next[i].n + 1 }
          return next
        })
      }),
    [tabId]
  )
  useEffect(() => {
    onBusy(loading)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
  const [picker, setPicker] = useState<{ value: string; label: string; tier: string; keyed?: boolean }[]>([])
  const [needsChoice, setNeedsChoice] = useState(false)
  const [policyRefused, setPolicyRefused] = useState(false)
  const [skillCard, setSkillCard] = useState<{ tools: string[]; request: string; answer: string; name: string; msg: string } | null>(null)
  const [effort, setEffortUi] = useState('auto')
  const [roles, setRolesUi] = useState<{ executor: string; reviewer: string }>({ executor: 'auto', reviewer: 'auto' })
  useEffect(() => {
    window.api.roles.get().then((r) => setRolesUi({ executor: r.executor, reviewer: r.reviewer })).catch(() => undefined)
  }, [active])
  useEffect(() => {
    window.api.effort.get().then(setEffortUi).catch(() => undefined)
  }, [active])
  useEffect(() => {
    window.api.modelPicker().then(setPicker).catch(() => undefined)
  }, [active])
  useEffect(() => {
    if (!loading) return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => {
      clearInterval(id)
      setElapsed(0)
    }
  }, [loading])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const persist = async (msgs: ChatMessage[]): Promise<void> => {
    try {
      const saved = await window.api.conversations.save({
        id: convIdRef.current ?? undefined,
        messages: msgs,
        projectId: project?.id ?? null
      })
      convIdRef.current = saved.id
      onSaved(saved.id, saved.title)
    } catch (e) {
      console.warn('save conversation failed', e)
    }
  }

  const lastUserRef = useRef('')
  const streamRef = useRef('')
  const partialRef = useRef('') // last streamed text; survives the 'reset' a cancel triggers, so Stop keeps what was written
  const [streamText, setStreamText] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState('')

  useEffect(
    () =>
      window.api.onStream((id, kind, t) => {
        if (id !== tabId) return
        if (kind === 'reset') {
          if (streamRef.current.trim()) partialRef.current = streamRef.current
          streamRef.current = ''
          setStreamText('')
        } else if (t) {
          streamRef.current += t
          partialRef.current = streamRef.current
          setStreamText(streamRef.current)
        }
      }),
    [tabId]
  )

  const runRequest = async (retry: boolean, base: ChatMessage[], retryMode?: ChatMode, allowWeaker?: boolean): Promise<void> => {
    setProgress('')
    setAgents([])
    setStreamText('')
    streamRef.current = ''
    partialRef.current = ''
    setRetryNote('')
    setNeedsChoice(false)
    setPolicyRefused(false)
    setSkillCard(null)
    setLoading(true)
    let next: ChatMessage[] = base
    try {
      const opts = { tabId, projectId: project?.id ?? null, mode: retryMode ?? mode, ...(allowWeaker ? { allowWeaker: true } : {}) }
      const r = retry
        ? await window.api.retryChat(opts)
        : await window.api.chat(lastUserRef.current, base.slice(0, -1).map((m) => ({ role: m.role, content: m.content })), opts)
      if (r.needsChoice) setNeedsChoice(true)
      if (r.policyRefused) setPolicyRefused(true)
      if (r.skillHint && !r.cancelled) {
        const slug = (lastUserRef.current.match(/[A-Za-z0-9]+/g) ?? []).slice(0, 4).join('-').toLowerCase().slice(0, 40)
        setSkillCard({ tools: r.skillHint.tools, request: lastUserRef.current, answer: r.content, name: slug || 'task-' + Date.now().toString(36), msg: '' })
      }
      if (r.cancelled) {
        const partial = streamRef.current.trim() ? streamRef.current : partialRef.current
        if (partial.trim()) {
          next = [...base, { role: 'assistant', content: partial + '\n\n_⏹ انوقف_', at: Date.now() }]
        } else if (retry) {
          next = base
        } else {
          setInput(lastTypedRef.current)
          next = base.slice(0, -1)
        }
      } else if (retry && r.failed) {
        setRetryNote(r.content)
        next = base
      } else if (retry) {
        next = [...base.slice(0, -1), { role: 'assistant', content: r.content, meta: r.meta, at: Date.now(), pin: opts.mode.kind === 'model' }]
      } else {
        next = [...base, { role: 'assistant', content: r.content, meta: r.meta, at: Date.now(), pin: opts.mode.kind === 'model' }]
      }
    } catch (e) {
      next = [...base, { role: 'assistant', content: 'Error: ' + (e instanceof Error ? e.message : String(e)), at: Date.now() }]
    }
    setStreamText('')
    streamRef.current = ''
    setMessages(next)
    setLoading(false)
    if (next.length && next !== base) persist(next)
  }

  const handleSend = async (): Promise<void> => {
    if ((!input.trim() && !atts.length) || loading || prep > 0) return
    const typed = input.trim() ? input : 'حلل الملفات المرفقة وقلي شو فيها.'
    const shown = atts.length ? typed + '\n\n' + atts.map((a) => '📎 ' + a.path).join('\n') : typed
    const toModel = atts.length ? (typed + '\n\n[ملفات مرفقة من المستخدم]\n' + atts.map(attBlock).join('\n\n')).slice(0, 70000) : typed
    lastTypedRef.current = typed
    lastUserRef.current = toModel
    const withUser = [...messages, { role: 'user' as const, content: shown, at: Date.now() }]
    setMessages(withUser)
    setInput('')
    setAtts([])
    await runRequest(false, withUser)
  }

  const handleRetry = async (retryMode?: ChatMode, allowWeaker?: boolean): Promise<void> => {
    if (loading) return
    setRetrying(true)
    await runRequest(true, messages, retryMode, allowWeaker)
    setRetrying(false)
  }

  const handleResume = async (): Promise<void> => {
    if (loading) return
    const t = 'كمّل من وين وقفت، وما تعيد اللي خلص.'
    lastTypedRef.current = t
    lastUserRef.current = t
    const w = [...messages, { role: 'user' as const, content: t, at: Date.now() }]
    setMessages(w)
    await runRequest(false, w)
  }

  const handleStop = (): void => {
    void window.api.cancelChat(tabId)
  }

  return (
    <div className={`${active ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col bg-bg text-fg`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-outline bg-surface px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{project ? 'ملف المشروع' : 'محادثة'}</span>
          {project && (
            <Chip cls="bg-primary/15 text-primary">
              <FolderOpen size={12} /> {project.name}
            </Chip>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChips />
        </div>
      </header>
      <div className="pt-3">
        <CostDashboard messages={messages} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 && !loading && (
            <div className="pt-16 text-center">
            <p className="text-sm text-muted">
              جرب: مرحبا كيفك (بسيط ← مجاني) | اكتبلي فانكشن بايثون ترتب مصفوفة (معقد ← غالي + سكيل)
            </p>
            <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => {
                    setInput(t.text)
                    taRef.current?.focus()
                  }}
                  className="rounded-full border border-outline bg-surface px-3 py-1.5 text-xs hover:bg-surface2"
                >
                  {t.label}
                </button>
              ))}
            </div>
            </div>
          )}

          {messages.map((msg, i) =>
            retrying && i === messages.length - 1 ? null : msg.role === 'user' ? (
              <div key={i} className="ms-auto w-fit max-w-[80%]">
                <div className="whitespace-pre-wrap rounded-3xl rounded-te-md bg-bubble px-4 py-3">{msg.content}</div>
                <MsgFooter text={msg.content} at={msg.at} />
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <Avatar model={msg.meta ? parseMeta(msg.meta).model : undefined} pin={msg.pin} />
                <div className="min-w-0 flex-1 rounded-card border border-outline bg-surface p-4 shadow-card">
                  <Markdown text={msg.content} />
                  <FileChips text={msg.content} />
                  {msg.meta && <MetaBar meta={msg.meta} />}
                  <MsgFooter text={msg.content} at={msg.at} />
                  {!msg.meta && i === messages.length - 1 && !loading && (msg.content.trimEnd().endsWith('_⏹ انوقف_') || msg.content.startsWith('Error:')) && (
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => void handleResume()} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] text-white">
                        <Play size={12} /> كمّل من وين وقفت
                      </button>
                    </div>
                  )}
                  {msg.meta && i === messages.length - 1 && !loading && (
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => handleRetry()} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1 text-[11px] text-muted hover:bg-surface2">
                        <RotateCcw size={12} /> جرّب بموديل تاني
                      </button>
                      {retryNote && <span className="text-[11px] text-warning">{retryNote}</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {loading && streamText && (
            <div className="flex gap-3">
              <Avatar />
              <div className="min-w-0 flex-1 rounded-card border border-outline bg-surface p-4 shadow-card">
                <Markdown text={streamText} />
                <span className="inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />
              </div>
            </div>
          )}

          {loading && !streamText && (
            <div className="flex items-center gap-3">
              <Avatar />
              <div className="flex items-center gap-2 text-sm text-muted">
                <span>{progress || 'عم يشتغل…'}</span>
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
              </div>
            </div>
          )}
          {loading && agents.length > 0 && (
            <div className="flex justify-center">
              <AgentPanel agents={agents} />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div
        className="bg-bg px-4 pb-4 pt-2"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDragOver(false)
          void addFiles(Array.from(e.dataTransfer.files))
        }}
      >
        {skillCard && !loading && (
          <div className="mx-auto mb-2 max-w-3xl rounded-card border border-primary/40 bg-primary/5 p-3 text-xs">
            <div className="mb-2 font-medium">المهمة كانت من {skillCard.tools.length} خطوات (أدوات). بدك أحفظها كسكيل لتتكرر أسهل؟</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                dir="ltr"
                value={skillCard.name}
                onChange={(e) => setSkillCard({ ...skillCard, name: e.target.value })}
                placeholder="skill-name"
                className="w-48 rounded-lg border border-outline bg-bg px-2 py-1"
              />
              <button
                className="rounded-full bg-primary px-3 py-1 text-white"
                onClick={async () => {
                  const uniq = [...new Set(skillCard.tools)]
                  const body = ['# ' + skillCard.request.slice(0, 80), '', 'استعمل هالسكيل لطلبات مشابهة لـ: ' + skillCard.request.slice(0, 300), '', 'الأدوات اللي اشتغلت المرة الماضية بالترتيب: ' + skillCard.tools.join(' ← '), '', 'الأدوات المميزة: ' + uniq.join('، '), '', 'مثال على الناتج:', skillCard.answer.slice(0, 600), '', '(مسودة انحفظت من محادثة؛ عدّلها من صفحة السكيلز.)'].join('\n')
                  const r = await window.api.skills.create(skillCard.name.trim(), body)
                  if (r.ok) setSkillCard(null)
                  else setSkillCard({ ...skillCard, msg: r.error ?? 'فشل الحفظ' })
                }}
              >
                احفظ كسكيل
              </button>
              <button className="rounded-full px-3 py-1 text-muted hover:bg-surface2" onClick={() => setSkillCard(null)}>
                لا، شكراً
              </button>
              {skillCard.msg && <span className="text-danger">{skillCard.msg}</span>}
            </div>
          </div>
        )}
        {needsChoice && !loading && (
          <div className="mx-auto mb-2 max-w-3xl rounded-card border border-warning/50 bg-warning/10 p-3 text-xs">
            <div className="mb-2 font-medium">
              {policyRefused
                ? 'الموديلات القوية مشغولة، والطلب معقد فما نزّلناه تلقائياً.'
                : mode.kind === 'model'
                  ? 'الموديل المحدد ما رد.'
                  : 'الموديلات المجانية خلصت أو ما ردت.'}{' '}
              شو بتحب نعمل؟
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {policyRefused ? (
                <button className="rounded-full bg-warning px-3 py-1 text-white" onClick={() => handleRetry({ kind: 'auto' }, true)}>
                  ⬇️ موافق، كمّل بموديل أخف (جواب أسرع وأقل جودة)
                </button>
              ) : (
                <button className="rounded-full bg-primary px-3 py-1 text-white" onClick={() => handleRetry({ kind: 'auto' })}>
                  ⚡ موافق، كمّل بالمدفوع (تلقائي) — مرة وحدة
                </button>
              )}
              <select
                className="rounded-full border border-outline bg-surface px-2 py-1"
                value=""
                onChange={(e) => e.target.value && handleRetry({ kind: 'model', id: e.target.value })}
              >
                <option value="">🎯 اختار موديل…</option>
                {picker.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} ({p.tier === 'LOCAL' ? 'محلي' : p.tier === 'TIER_1_FREE' ? 'مجاني' : p.tier === 'SUBSCRIPTION' ? 'اشتراكك' : 'مدفوع'})
                  </option>
                ))}
              </select>
              {mode.kind !== 'free' && (
                <button className="rounded-full border border-outline px-3 py-1" onClick={() => handleRetry({ kind: 'free' })}>
                  🆓 جرّب المجاني
                </button>
              )}
              <button className="rounded-full px-3 py-1 text-muted hover:bg-surface2" onClick={() => setNeedsChoice(false)}>
                لا، خلص
              </button>
            </div>
          </div>
        )}
        <div className="mx-auto mb-1 flex max-w-3xl flex-wrap items-center gap-2 text-[11px] text-muted">
          <div className="flex overflow-hidden rounded-full border border-outline" role="radiogroup" aria-label="وضع المحادثة">
            {CHAT_MODES.map((b) => {
              const on = activeChatMode(mode) === b.id
              return (
                <button key={b.id} type="button" role="radio" aria-checked={on} title={b.hint} onClick={() => onModeChange(b.mode)} className={`px-3 py-0.5 ${on ? 'bg-primary/20 font-medium text-primary' : 'bg-surface text-fg hover:bg-surface2'}`}>
                  {b.label}
                </button>
              )
            })}
          </div>
          <span>الموديل:</span>
          <ModelPicker mode={mode} picker={pickerForMode(mode, picker)} onModeChange={onModeChange} />
          {mode.kind === 'auto' && (
            <>
              <span>المنفّذ:</span>
              <select className="rounded-full border border-outline bg-surface px-2 py-0.5" value={roles.executor} title="المنفّذ: موديل من مزوّد عنده مفتاح، أو تلقائي" onChange={(e) => { setRolesUi({ ...roles, executor: e.target.value }); window.api.roles.set({ executor: e.target.value }).catch(() => undefined) }}>
                <option value="auto">تلقائي</option>
                {picker.filter((p) => p.keyed).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <span>المراجع:</span>
              <select className="rounded-full border border-outline bg-surface px-2 py-0.5" value={roles.reviewer} title="المراجع: لازم يكون من عيلة مختلفة عن المنفّذ" onChange={(e) => { setRolesUi({ ...roles, reviewer: e.target.value }); window.api.roles.set({ reviewer: e.target.value }).catch(() => undefined) }}>
                <option value="auto">تلقائي</option>
                {picker.filter((p) => p.keyed).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </>
          )}
          <span>التفكير:</span>
          <select
            className="rounded-full border border-outline bg-surface px-2 py-0.5"
            value={effort}
            title="مستوى التفكير لكل الجلسة، بينطبق على أي موديل بيدعمه"
            onChange={(e) => {
              setEffortUi(e.target.value)
              window.api.effort.set(e.target.value).catch(() => undefined)
            }}
          >
            <option value="auto">تلقائي</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="max">Max</option>
          </select>
          {mode.kind === 'council' && (mode.author || mode.critic) && (
            <>
              <span>الكاتب:</span>
              <select className="rounded-full border border-outline bg-surface px-2 py-0.5" value={mode.author ?? ''} onChange={(e) => onModeChange({ ...mode, author: e.target.value })}>
                {picker.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} ({p.tier === 'TIER_1_FREE' ? 'مجاني' : p.tier === 'SUBSCRIPTION' ? 'اشتراكك' : 'مدفوع'})
                </option>
              ))}
              </select>
              <span>الناقد:</span>
              <select className="rounded-full border border-outline bg-surface px-2 py-0.5" value={mode.critic ?? ''} onChange={(e) => onModeChange({ ...mode, critic: e.target.value })}>
                {picker.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} ({p.tier === 'TIER_1_FREE' ? 'مجاني' : p.tier === 'SUBSCRIPTION' ? 'اشتراكك' : 'مدفوع'})
                </option>
              ))}
              </select>
            </>
          )}
          {mode.kind !== 'free' && <span className="text-warning">ممكن يستهلك رصيدك</span>}
        </div>
        {prep > 0 && (
          <div className="mx-auto mb-1.5 flex max-w-3xl items-center gap-2 text-[11px] text-muted">
            <Loader2 size={12} className="animate-spin" /> عم يجهّز الملفات (تفريغ الصوت أو وصف الصور ممكن ياخد شوي)…
          </div>
        )}
        {atts.length > 0 && (
          <div className="mx-auto mb-1.5 flex max-w-3xl flex-wrap gap-1.5">
            {atts.map((a) => (
              <span key={a.path} title={a.note ?? a.path} className="flex items-center gap-1 rounded-full border border-outline bg-surface2 px-2.5 py-1 text-[11px]">
                <Paperclip size={11} />
                <span dir="ltr" className="max-w-[200px] truncate">
                  {a.name}
                </span>
                {a.note && !a.text && <span className="text-warning">⚠</span>}
                <button aria-label="شيل المرفق" onClick={() => setAtts((x) => x.filter((y) => y.path !== a.path))} className="rounded-full p-0.5 hover:bg-outline">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div
          className={
            'mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border bg-surface px-3 py-2 shadow-card focus-within:border-primary focus-within:shadow-glow ' +
            (dragOver ? 'border-primary' : 'border-outline')
          }
        >
          <button
            onClick={() => void pickFiles()}
            title="إرفاق ملفات (صوت، Office، صور، PDF، نصوص...)"
            aria-label="إرفاق ملفات"
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface2"
          >
            <Paperclip size={18} />
          </button>
          <button
            onClick={() => void toggleRec()}
            title={rec ? 'وقّف التسجيل وفرّغو لنص' : 'فويس نوت (بيتفرّغ محلياً بـ Whisper)'}
            aria-label="تسجيل صوت"
            className={'mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ' + (rec ? 'animate-pulse bg-danger text-white' : 'text-muted hover:bg-surface2')}
          >
            <Mic size={18} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const fs = Array.from(e.clipboardData.files)
              if (fs.length) {
                e.preventDefault()
                void addFiles(fs)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="اكتب طلبك هون… (Enter بيبعت، Shift+Enter سطر جديد)"
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted"
          />
          {loading ? (
            <button
              onClick={handleStop}
              aria-label="وقّف"
              title="وقّف الطلب"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger text-white"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !atts.length) || prep > 0}
              aria-label="ابعت"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-opacity disabled:opacity-40"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <StatusBar loading={loading} progress={progress} elapsed={elapsed} messages={messages} />
      </div>
    </div>
  )
}
