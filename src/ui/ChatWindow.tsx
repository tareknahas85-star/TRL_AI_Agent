import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, Check, Copy, FolderOpen, Loader2, RotateCcw, Square } from 'lucide-react'
import { Markdown } from './Markdown'
import { CostDashboard } from './CostDashboard'
import { Chip } from './components/ui'
import type { ChatMode, ProjectInfo, StoredMessage } from '../preload/index.d'

type ChatMessage = StoredMessage

function Avatar() {
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
  failures: { model: string; reason: string }[]
}

// meta looks like: "Model: X | Memory: n | Tools: t | Skill: Y | <saved text> | Tried: a -> b | Stats: {json}"
function parseMeta(meta: string): { model: string; skill: string; saved: string; tried: string[]; council: string; stats: Stats | null } {
  const si = meta.indexOf(' | Stats: ')
  let stats: Stats | null = null
  if (si >= 0) {
    try {
      stats = JSON.parse(meta.slice(si + 10)) as Stats
    } catch {
      stats = null
    }
  }
  const out = { model: '', skill: '', saved: '', tried: [] as string[], council: '', stats }
  for (const p of (si >= 0 ? meta.slice(0, si) : meta).split(' | ')) {
    const idx = p.indexOf(': ')
    const k = idx > 0 ? p.slice(0, idx) : ''
    const v = idx > 0 ? p.slice(idx + 2) : p
    if (k === 'Model') out.model = v
    else if (k === 'Skill') out.skill = v
    else if (k === 'Council') out.council = v
    else if (k === 'Tried') out.tried = v.split(' -> ').filter(Boolean)
    else if (k === 'Memory' || k === 'Tools') continue
    else out.saved = p
  }
  return out
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
}) {
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
            <span>{progress || 'جاري المعالجة…'}</span>
            <span dir="ltr">{elapsed}s</span>
          </>
        ) : st && last ? (
          <>
            <span dir="ltr">{last.model}</span>
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
          <span>جاهز — أرسل طلباً لتظهر الإحصاءات هنا</span>
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
              {st.failures.map((f, i) => (
                <div key={i} dir="ltr" className="text-warning">
                  ✗ {f.model}: {f.reason}
                </div>
              ))}
            </>
          ) : (
            <div>لا توجد إحصاءات للرد الأخير.</div>
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
              <div>لا يوجد موصلات مفعّلة.</div>
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

function MsgFooter({ text, at }: { text: string; at?: number }) {
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
      <button onClick={copy} title="نسخ الرسالة كاملة" aria-label="نسخ الرسالة كاملة" className="rounded-full p-1 hover:bg-surface2">
        {ok ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {at ? <span>{new Date(at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })}</span> : null}
    </div>
  )
}

function MetaBar({ meta }: { meta: string }) {
  const m = parseMeta(meta)
  const t = tierChip(m.saved)
  const failed = m.tried.length > 1 ? m.tried.slice(0, -1) : []
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Chip cls={t.cls}>{t.label}</Chip>
      <Chip>
        <span dir="ltr">{m.model}</span>
      </Chip>
      {m.skill && m.skill !== 'none' && <Chip cls="bg-primary/10 text-primary">{m.skill}</Chip>}
      {m.council && <Chip cls="bg-primary/10 text-primary">🏛️ {m.council}</Chip>}
      {failed.length > 0 && (
        <Chip cls="bg-warning/15 text-warning">
          جرّب {failed.length} قبله
        </Chip>
      )}
    </div>
  )
}

function StatusChips() {
  const [st, setSt] = useState<{ key: boolean; ollama: boolean; localMaster: boolean; mcpOn: number; mcpTotal: number } | null>(null)
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
  const item = (ok: boolean, label: string) => (
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
}) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const convIdRef = useRef<string | null>(conversationId)
  const [progress, setProgress] = useState('')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => window.api.onProgress((id, t) => id === tabId && setProgress(t)), [tabId])
  useEffect(() => {
    onBusy(loading)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
  const [picker, setPicker] = useState<{ value: string; label: string; tier: string }[]>([])
  const [needsChoice, setNeedsChoice] = useState(false)
  useEffect(() => {
    window.api.modelPicker().then(setPicker).catch(() => undefined)
  }, [active])
  useEffect(() => {
    if (!loading) return
    const t0 = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(id)
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
  const [streamText, setStreamText] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState('')

  useEffect(
    () =>
      window.api.onStream((id, kind, t) => {
        if (id !== tabId) return
        if (kind === 'reset') {
          streamRef.current = ''
          setStreamText('')
        } else if (t) {
          streamRef.current += t
          setStreamText(streamRef.current)
        }
      }),
    [tabId]
  )

  const runRequest = async (retry: boolean, base: ChatMessage[], retryMode?: ChatMode): Promise<void> => {
    setProgress('')
    setStreamText('')
    streamRef.current = ''
    setRetryNote('')
    setNeedsChoice(false)
    setLoading(true)
    let next: ChatMessage[] = base
    try {
      const opts = { tabId, projectId: project?.id ?? null, mode: retryMode ?? mode }
      const r = retry
        ? await window.api.retryChat(opts)
        : await window.api.chat(lastUserRef.current, base.slice(0, -1).map((m) => ({ role: m.role, content: m.content })), opts)
      if (r.needsChoice) setNeedsChoice(true)
      if (r.cancelled) {
        const partial = streamRef.current
        if (partial.trim()) {
          next = [...base, { role: 'assistant', content: partial + '\n\n_⏹ تم الإيقاف_', at: Date.now() }]
        } else if (retry) {
          next = base
        } else {
          setInput(lastUserRef.current)
          next = base.slice(0, -1)
        }
      } else if (retry && r.failed) {
        setRetryNote(r.content)
        next = base
      } else if (retry) {
        next = [...base.slice(0, -1), { role: 'assistant', content: r.content, meta: r.meta, at: Date.now() }]
      } else {
        next = [...base, { role: 'assistant', content: r.content, meta: r.meta, at: Date.now() }]
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
    if (!input.trim() || loading) return
    const userMsg = input
    lastUserRef.current = userMsg
    const withUser = [...messages, { role: 'user' as const, content: userMsg, at: Date.now() }]
    setMessages(withUser)
    setInput('')
    await runRequest(false, withUser)
  }

  const handleRetry = async (retryMode?: ChatMode): Promise<void> => {
    if (loading) return
    setRetrying(true)
    await runRequest(true, messages, retryMode)
    setRetrying(false)
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
            <p className="pt-16 text-center text-sm text-muted">
              جرب: مرحبا كيفك (بسيط ← مجاني) | اكتبلي فانكشن بايثون ترتب مصفوفة (معقد ← غالي + سكيل)
            </p>
          )}

          {messages.map((msg, i) =>
            retrying && i === messages.length - 1 ? null : msg.role === 'user' ? (
              <div key={i} className="ms-auto w-fit max-w-[80%]">
                <div className="whitespace-pre-wrap rounded-3xl rounded-te-md bg-bubble px-4 py-3">{msg.content}</div>
                <MsgFooter text={msg.content} at={msg.at} />
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <Avatar />
                <div className="min-w-0 flex-1 rounded-card border border-outline bg-surface p-4 shadow-card">
                  <Markdown text={msg.content} />
                  {msg.meta && <MetaBar meta={msg.meta} />}
                  <MsgFooter text={msg.content} at={msg.at} />
                  {msg.meta && i === messages.length - 1 && !loading && (
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => handleRetry()} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1 text-[11px] text-muted hover:bg-surface2">
                        <RotateCcw size={12} /> أعد بنموذج آخر
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
                <span>الماستر يختار أرخص موديل</span>
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="bg-bg px-4 pb-4 pt-2">
        {needsChoice && !loading && (
          <div className="mx-auto mb-2 max-w-3xl rounded-card border border-warning/50 bg-warning/10 p-3 text-xs">
            <div className="mb-2 font-medium">
              {mode.kind === 'model' ? 'النموذج المحدد ما رد.' : 'النماذج المجانية خلصت أو ما ردت.'} شو بتحب نعمل؟
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="rounded-full bg-primary px-3 py-1 text-white" onClick={() => handleRetry({ kind: 'auto' })}>
                ⚡ موافق، كمّل بالمدفوع (تلقائي) — مرة وحدة
              </button>
              <select
                className="rounded-full border border-outline bg-surface px-2 py-1"
                value=""
                onChange={(e) => e.target.value && handleRetry({ kind: 'model', id: e.target.value })}
              >
                <option value="">🎯 اختار نموذج…</option>
                {picker.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} ({p.tier === 'TIER_1_FREE' ? 'مجاني' : p.tier === 'SUBSCRIPTION' ? 'اشتراكك' : 'مدفوع'})
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
          <span>النموذج:</span>
          <select
            className={`rounded-full border border-outline bg-surface px-2 py-0.5 ${mode.kind === 'free' ? '' : 'text-warning'}`}
            value={mode.kind === 'model' ? mode.id : mode.kind === 'council' && (mode.author || mode.critic) ? 'council-manual' : mode.kind}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'council-manual') return onModeChange({ kind: 'council', author: picker[0]?.value, critic: (picker[1] ?? picker[0])?.value })
              onModeChange(v === 'free' ? { kind: 'free' } : v === 'auto' ? { kind: 'auto' } : v === 'council' ? { kind: 'council' } : { kind: 'model', id: v })
            }}
          >
            <option value="free">🆓 تلقائي — مجاني فقط</option>
            <option value="auto">⚡ تلقائي — مع المدفوع</option>
            <option value="council">🏛️ مجلس النماذج — مسودة ثم نقد ثم تصحيح</option>
            <option value="council-manual" disabled={!picker.length}>🏛️ مجلس — أنا بختار الكاتب والناقد</option>
            <optgroup label="🎯 نموذج محدد">
              {picker.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} ({p.tier === 'TIER_1_FREE' ? 'مجاني' : p.tier === 'SUBSCRIPTION' ? 'اشتراكك' : 'مدفوع'})
                </option>
              ))}
            </optgroup>
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
          {mode.kind !== 'free' && <span className="text-warning">قد يستهلك رصيدك</span>}
        </div>
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-outline bg-surface px-4 py-2 shadow-card focus-within:border-primary focus-within:shadow-glow">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="اكتب طلبك هنا..."
            className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted"
          />
          {loading ? (
            <button
              onClick={handleStop}
              aria-label="إيقاف"
              title="إيقاف الطلب"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="إرسال"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition-opacity disabled:opacity-40"
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
