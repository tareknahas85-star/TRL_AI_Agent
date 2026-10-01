import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Plug, PlugZap, RefreshCw, Settings2 } from 'lucide-react'
import { Chip, Toggle, cardCls, inputCls, primaryBtn, ghostBtn } from './components/ui'

const GOOGLE = 'google-workspace'
type Status = 'checking' | 'connected' | 'disconnected' | 'needs-setup'

const STATUS: Record<Status, { text: string; cls: string }> = {
  checking: { text: 'عم يتحقق…', cls: 'bg-surface2 text-muted' },
  connected: { text: 'متصل ✓', cls: 'bg-success/15 text-success' },
  disconnected: { text: 'غير متصل', cls: 'bg-warning/20 text-warning' },
  'needs-setup': { text: 'بدو إعداد (مرة وحدة)', cls: 'bg-surface2 text-muted' }
}

function Card({ title, subtitle, status, children }: { title: string; subtitle: string; status?: Status; children?: ReactNode }) {
  return (
    <div className={cardCls + ' space-y-3'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted">{subtitle}</div>
        </div>
        {status && <Chip cls={STATUS[status].cls}>{STATUS[status].text}</Chip>}
      </div>
      {children}
    </div>
  )
}

function GoogleCard() {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState('')
  const [write, setWrite] = useState(false)
  const [hasCreds, setHasCreds] = useState(false)
  const [tail, setTail] = useState('')
  const [status, setStatus] = useState<Status>('checking')
  const [editing, setEditing] = useState(false)
  const [cid, setCid] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<'connect' | 'test' | 'setup' | 'disconnect' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = (): void => {
    if (poll.current) clearInterval(poll.current)
    poll.current = null
  }

  const check = useCallback(async (): Promise<boolean> => {
    const r = await window.api.accounts.google('test')
    setStatus(r.ok ? 'connected' : 'disconnected')
    return r.ok
  }, [])

  useEffect(() => {
    void (async () => {
      const [a, c] = await Promise.all([window.api.accounts.get(), window.api.accounts.googleCreds()])
      setEmail(a.googleEmail)
      setSaved(a.googleEmail)
      setWrite(a.writeServers.includes(GOOGLE))
      setHasCreds(c.hasCreds)
      setTail(c.clientTail)
      if (!c.hasCreds) setStatus('needs-setup')
      else if (!a.googleEmail) setStatus('disconnected')
      else await check()
    })()
    return stopPoll
  }, [check])

  const saveSetup = async (): Promise<void> => {
    setBusy('setup')
    setMsg(null)
    const r = await window.api.accounts.googleSetup(cid, secret)
    setBusy(null)
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'خطأ' })
    setCid('')
    setSecret('')
    setEditing(false)
    setHasCreds(true)
    const c = await window.api.accounts.googleCreds()
    setTail(c.clientTail)
    setStatus('disconnected')
    setMsg({ ok: true, text: 'انحفظ الإعداد. هلأ اكتب إيميلك واضغط اتصل.' })
  }

  const saveEmail = async (): Promise<string | null> => {
    const v = email.trim()
    if (v === saved) return v
    const r = await window.api.accounts.setEmail(v)
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? 'خطأ' })
      return null
    }
    setSaved(v)
    return v
  }

  const connect = async (): Promise<void> => {
    setMsg(null)
    const v = await saveEmail()
    if (!v) return
    setBusy('connect')
    const r = await window.api.accounts.google('connect')
    setMsg({ ok: r.ok, text: r.message })
    setBusy(null)
    if (!r.ok) return
    // Wait for the user to finish signing in on the browser page, then flip the status by itself.
    stopPoll()
    setStatus('checking')
    let tries = 0
    poll.current = setInterval(async () => {
      tries++
      if (await check()) {
        stopPoll()
        setMsg({ ok: true, text: 'تم الاتصال.' })
      } else if (tries >= 40) {
        stopPoll()
        setStatus('disconnected')
        setMsg({ ok: false, text: 'ما انتهى تسجيل الدخول. اضغط اتصل وجرّب مرة تانية.' })
      }
    }, 3000)
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setMsg(null)
    const r = await window.api.accounts.google('test')
    setStatus(r.ok ? 'connected' : 'disconnected')
    setMsg({ ok: r.ok, text: r.message })
    setBusy(null)
  }

  const disconnect = async (): Promise<void> => {
    if (!confirm('فصل حساب Google؟ بتحتاج تسجل الدخول من جديد لتربطه مرة تانية.')) return
    setBusy('disconnect')
    stopPoll()
    await window.api.accounts.googleDisconnect()
    setStatus('disconnected')
    setMsg({ ok: true, text: 'انفصل الحساب.' })
    setBusy(null)
  }

  const showSetup = !hasCreds || editing

  return (
    <Card title="Google" subtitle="Gmail • Calendar • Drive • Docs • Sheets • Slides • Tasks • Contacts" status={status}>
      {showSetup ? (
        <div className="space-y-2 rounded-card border border-outline p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Settings2 size={14} /> إعداد لمرة وحدة
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            من Google Cloud Console ثم Google Auth Platform ثم Clients، افتح الـ Client (Desktop app) والصق Client ID و Client secret. أو الصق محتوى ملف JSON
            كامل بالخانة الأولى والتطبيق بيقرأ الاتنين. المفاتيح بتنخزّن بالجهاز بس.
          </p>
          <textarea
            dir="ltr"
            rows={cid.trim().startsWith('{') ? 4 : 1}
            className={inputCls + ' font-mono text-xs'}
            placeholder="Client ID  (أو محتوى ملف JSON)"
            value={cid}
            onChange={(e) => setCid(e.target.value)}
          />
          {!cid.trim().startsWith('{') && (
            <input
              dir="ltr"
              type="password"
              className={inputCls + ' font-mono text-xs'}
              placeholder="Client secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
          )}
          <div className="flex gap-2">
            <button className={primaryBtn} disabled={busy !== null || !cid.trim()} onClick={saveSetup}>
              {busy === 'setup' ? <Loader2 size={14} className="animate-spin" /> : 'حفظ الإعداد'}
            </button>
            {hasCreds && (
              <button className={ghostBtn + ' border border-outline'} onClick={() => setEditing(false)}>
                إلغاء
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input dir="ltr" className={inputCls} placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === 'connected' ? (
              <button className={ghostBtn + ' border border-outline'} disabled={busy !== null} onClick={connect}>
                <RefreshCw size={13} className="ml-1 inline" /> إعادة الاتصال
              </button>
            ) : (
              <button className={primaryBtn} disabled={busy !== null || !email.trim() || status === 'checking'} onClick={connect}>
                {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : (
                  <>
                    <Plug size={14} className="ml-1 inline" /> اتصل
                  </>
                )}
              </button>
            )}
            <button className={ghostBtn + ' border border-outline'} disabled={busy !== null || !saved} onClick={test}>
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : 'اختبار'}
            </button>
            {status === 'connected' && (
              <button className={ghostBtn + ' border border-outline'} disabled={busy !== null} onClick={disconnect}>
                <PlugZap size={13} className="ml-1 inline" /> فصل
              </button>
            )}
            <button className={ghostBtn} onClick={() => setEditing(true)} title={tail}>
              تغيير الإعداد
            </button>
          </div>
          <Toggle
            checked={write}
            label="السماح بالكتابة: إرسال إيميل، إنشاء مواعيد ومهام، تعديل ملفات… (بيطلب موافقتك قبل كل إجراء)"
            onChange={async () => {
              const next = !write
              if (next && !confirm('تفعيل الكتابة بيخلي النموذج يقترح إجراءات تغيّر بحسابك (دايماً بعد موافقتك بنافذة). تكمل؟')) return
              const list = await window.api.accounts.setWrite(GOOGLE, next)
              setWrite(list.includes(GOOGLE))
            }}
          />
        </>
      )}
      {msg && <p className={`text-xs ${msg.ok ? 'text-success' : 'text-warning'}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">الحذف النهائي ممنوع دايماً. Google Keep ما إله واجهة رسمية، فالملاحظات بتنعمل عبر Tasks أو Docs. لما تنتهي الجلسة بيفتح التطبيق صفحة الدخول لحاله.</p>
    </Card>
  )
}

type Def = { id: string; title: string; subtitle: string; group: 'accounts' | 'device'; kind: 'remote' | 'local' | 'special' | 'token'; hint: string; fields?: string[]; connected: boolean; write: boolean; unavailable: string | null }

function ServiceCard({ def }: { def: Def }) {
  const id = def.id
  const [connected, setConnected] = useState(def.connected)
  const [write, setWrite] = useState(def.write)
  const [busy, setBusy] = useState<'connect' | 'test' | 'disconnect' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [code, setCode] = useState('')
  const [vals, setVals] = useState<string[]>(() => (def.fields ?? []).map(() => ''))

  const saveToken = async (): Promise<void> => {
    setBusy('connect')
    setMsg(null)
    const r = await window.api.connectors.setup(id, vals)
    setMsg({ ok: r.ok, text: r.message })
    setConnected(r.ok)
    if (r.ok) setVals((def.fields ?? []).map(() => ''))
    setBusy(null)
  }

  useEffect(
    () =>
      window.api.connectors.onCode((who, c) => {
        if (who === id) setCode(c)
      }),
    [id]
  )

  const run = async (kind: 'connect' | 'test' | 'disconnect'): Promise<void> => {
    if (kind === 'disconnect' && !confirm('فصل ' + def.title + '؟')) return
    setBusy(kind)
    setMsg(null)
    setCode('')
    const r = await window.api.connectors[kind](id)
    setMsg({ ok: r.ok, text: r.message })
    if (kind === 'disconnect') {
      setConnected(false)
      setWrite(false)
    } else setConnected(r.ok)
    setBusy(null)
    setCode('')
  }

  const verb = def.kind === 'local' ? 'تفعيل' : 'اتصل'
  return (
    <Card title={def.title} subtitle={def.subtitle} status={connected ? 'connected' : 'disconnected'}>
      {def.unavailable && <p className="text-xs text-warning">غير جاهز: {def.unavailable}</p>}
      {def.kind === 'token' && !connected && (
        <div className="space-y-2 rounded-card border border-outline p-3">
          <p className="text-[11px] leading-relaxed text-muted">{def.hint}</p>
          {(def.fields ?? []).map((label, i) => (
            <input
              key={label}
              dir="ltr"
              type="password"
              autoComplete="off"
              className={inputCls + ' font-mono text-xs'}
              placeholder={label}
              value={vals[i]}
              onChange={(e) => setVals((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          <button className={primaryBtn} disabled={busy !== null || vals.some((v) => v.trim().length < 4)} onClick={saveToken}>
            {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : 'حفظ واتصال'}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {connected ? (
          <button className={ghostBtn + ' border border-outline'} disabled={busy !== null} onClick={() => run('connect')}>
            <RefreshCw size={13} className="ml-1 inline" /> إعادة الاتصال
          </button>
        ) : def.kind === 'token' ? null : (
          <button className={primaryBtn} disabled={busy !== null || !!def.unavailable} onClick={() => run('connect')}>
            {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : (
              <>
                <Plug size={14} className="ml-1 inline" /> {verb}
              </>
            )}
          </button>
        )}
        <button className={ghostBtn + ' border border-outline'} disabled={busy !== null} onClick={() => run('test')}>
          {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : 'اختبار'}
        </button>
        {connected && (
          <button className={ghostBtn + ' border border-outline'} disabled={busy !== null} onClick={() => run('disconnect')}>
            <PlugZap size={13} className="ml-1 inline" /> فصل
          </button>
        )}
      </div>
      {busy === 'connect' && def.kind !== 'token' && <p className="text-xs text-muted">{def.hint}</p>}
      {code && (
        <p className="text-sm">
          الكود: <span dir="ltr" className="select-all font-mono text-base font-bold">{code}</span> (الصقه بصفحة تسجيل الدخول اللي انفتحت)
        </p>
      )}
      {connected && (
        <Toggle
          checked={write}
          label="السماح بالكتابة (بيطلب موافقتك قبل كل إجراء)"
          onChange={async () => {
            const next = !write
            if (next && !confirm('تفعيل الكتابة بيخلي النموذج يقترح إجراءات تغيّر ببياناتك (دايماً بعد موافقتك بنافذة). تكمل؟')) return
            const list = await window.api.accounts.setWrite(id, next)
            setWrite(list.includes(id))
          }}
        />
      )}
      {msg && <p className={`text-xs ${msg.ok ? 'text-success' : 'text-warning'}`}>{msg.text}</p>}
    </Card>
  )
}

export function AccountsPanel() {
  const [defs, setDefs] = useState<Def[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    void window.api.connectors.list().then(setDefs)
  }, [])
  const match = (d: Def): boolean => !q.trim() || (d.title + ' ' + d.subtitle + ' ' + d.id).toLowerCase().includes(q.trim().toLowerCase())
  const showGoogle = !q.trim() || 'google gmail calendar drive'.includes(q.trim().toLowerCase())
  const accounts = (defs ?? []).filter((d) => d.group === 'accounts' && match(d))
  const device = (defs ?? []).filter((d) => d.group === 'device' && match(d))
  return (
    <section className="mb-6">
      <h3 className="mb-1 text-base font-semibold">الموصلات</h3>
      <p className="mb-3 text-xs text-muted">
        اضغط «اتصل» على أي خدمة، سجّل الدخول بالمتصفح، وخلص. التطبيق ما بيشوف كلمة السر، وأي إجراء بيغيّر ببياناتك بيطلب موافقتك أول.
      </p>
      <input className={inputCls + ' mb-4'} placeholder="ابحث عن موصّل…" value={q} onChange={(e) => setQ(e.target.value)} />
      {(showGoogle || accounts.length > 0) && (
        <>
          <h4 className="mb-2 text-sm font-semibold text-muted">حسابات (تسجيل دخول)</h4>
          <div className="mb-5 grid gap-3">
            {showGoogle && <GoogleCard />}
            {accounts.map((d) => (
              <ServiceCard key={d.id} def={d} />
            ))}
          </div>
        </>
      )}
      {device.length > 0 && (
        <>
          <h4 className="mb-2 text-sm font-semibold text-muted">أدوات الجهاز</h4>
          <div className="grid gap-3">
            {device.map((d) => (
              <ServiceCard key={d.id} def={d} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
