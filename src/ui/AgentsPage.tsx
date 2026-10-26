import { useEffect, useState } from 'react'
import type { AgentInfo, AgentMemInfo, GateInfo } from '../preload/index.d'

const MODES: { id: AgentInfo['runOn']; label: string }[] = [
  { id: 'auto', label: 'تلقائي: محلي إذا الكمبيوتر شغّال، وإلا سحابي' },
  { id: 'local', label: 'محلي فقط (على هالكمبيوتر)' },
  { id: 'cloud', label: 'سحابي فقط (بيشتغل حتى لو الكمبيوتر مطفي)' }
]
const EMPTY: AgentInfo = { id: '', name: '', prompt: '', runOn: 'auto', memory: 'basic', model: '', tool: 'text', schedule: null, sources: [] }
const field = 'rounded-lg border border-outline bg-bg px-3 py-1.5 outline-none focus:border-primary'

export function AgentsPage() {
  const [list, setList] = useState<AgentInfo[]>([])
  const [form, setForm] = useState<AgentInfo>(EMPTY)
  const [gate, setGate] = useState<GateInfo>({ enabled: false, url: '', hasKey: false })
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [runId, setRunId] = useState('')
  const [task, setTask] = useState('')
  const [out, setOut] = useState('')
  const [running, setRunning] = useState(false)
  const [mailSrc, setMailSrc] = useState('main')
  const [mailScript, setMailScript] = useState('')
  const [mailMsg, setMailMsg] = useState('')
  const [mem, setMem] = useState<AgentMemInfo | null>(null)
  const [blockedText, setBlockedText] = useState('')
  const runAgent = async (id: string): Promise<void> => {
    setRunning(true)
    setOut('')
    try {
      const r = await window.api.agents.run(id, task)
      setOut((r.failed ? '⚠️ ' : '') + r.content)
    } catch (e) {
      setOut('⚠️ ' + (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
    }
    setRunning(false)
  }

  useEffect(() => {
    window.api.agents.list().then(setList).catch(() => undefined)
    window.api.agentMem.get().then((m) => {
      setMem(m)
      setBlockedText(m.blocked.join('\n'))
    }).catch(() => undefined)
    window.api.gate.get().then((g) => {
      setGate(g)
      setUrl(g.url)
    }).catch(() => undefined)
  }, [])

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try {
      setMsg(await fn())
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
    }
    setBusy(false)
  }

  const save = (): Promise<void> =>
    run(async () => {
      setList(await window.api.agents.save(form))
      setForm(EMPTY)
      return 'انحفظ الوكيل.'
    })

  const saveGate = (enabled?: boolean): Promise<void> =>
    run(async () => {
      const g = await window.api.gate.set({ url, key: key || undefined, ...(enabled === undefined ? {} : { enabled }) })
      setGate(g)
      setKey('')
      return 'انحفظت إعدادات البوابة.'
    })

  return (
    <div className="h-full overflow-y-auto p-6" dir="rtl">
      <h2 className="text-lg font-semibold">وكلاء</h2>
      <p className="mt-1 text-xs text-muted">
        كل وكيل إله اسم وتعليمات، وبتختار وين بيشتغل. من تيليغرام: /agents بيعرض اللائحة، و /agent اسم_الوكيل المهمة بيشغّله.
      </p>

      <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
        <h3 className="text-base font-semibold">{form.id ? 'تعديل وكيل' : 'وكيل جديد'}</h3>
        <div className="mt-3 grid gap-2 text-sm">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم الوكيل (مثلاً: باحث)" maxLength={40} className={field} />
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="تعليمات الوكيل (شو دوره وكيف بيتصرف)"
            rows={4}
            maxLength={3000}
            className={field}
          />
          <select value={form.runOn} onChange={(e) => setForm({ ...form, runOn: e.target.value as AgentInfo['runOn'] })} className={field}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value as AgentInfo['tool'] })} className={field}>
            <option value="text">نوع الوكيل: نصّي (محادثة وأدوات)</option>
            <option value="image">نوع الوكيل: توليد صور (نانو بنانا، سحابي، بدو مفتاح مدفوع)</option>
            <option value="video">نوع الوكيل: توليد فيديو (Gemini Omni، سحابي، بدو مفتاح مدفوع)</option>
          </select>
          <input dir="ltr" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={form.tool === 'image' ? 'الموديل (فاضي = gemini-2.5-flash-image)' : form.tool === 'video' ? 'الموديل (فاضي = gemini-omni-1.1-flash)' : 'الموديل (فاضي = الافتراضي، مثلاً gemini-flash-latest)'} maxLength={80} className={field} />
          <input dir="ltr" value={form.sources.join(', ')} onChange={(e) => setForm({ ...form, sources: e.target.value.split(',').map((s) => s.trim()) })} placeholder="مصادر الإيميل يلي بيقراها (مثلاً: gmail, outlook) - فاضي = كل الصناديق" className={field} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.checked ? { time: '08:00', days: 'all', task: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone } : null })} />
            جدولة تلقائية (بتشتغل من السحابة حتى لو الكمبيوتر مطفي)
          </label>
          {form.schedule && (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <input type="time" dir="ltr" value={form.schedule.time} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule!, time: e.target.value } })} className={field} />
                <select value={form.schedule.days} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule!, days: e.target.value as 'all' | 'work' } })} className={field}>
                  <option value="all">كل يوم</option>
                  <option value="work">الأحد للخميس</option>
                </select>
                <span className="self-center text-xs text-muted" dir="ltr">{form.schedule.tz}</span>
              </div>
              <textarea value={form.schedule.task} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule!, task: e.target.value } })} rows={2} maxLength={2000} placeholder="المهمة يلي بينفذها كل مرة (مثلاً: لخّصلي الإيميلات الجديدة)" className={field} />
            </div>
          )}
          <select value={form.memory} onChange={(e) => setForm({ ...form, memory: e.target.value as AgentInfo['memory'] })} className={field}>
            <option value="basic">ذاكرة أساسية مفلترة (بدون مشاريع ولا أسرار) — للوكيل السحابي</option>
            <option value="none">بدون ذاكرة</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button disabled={busy || !form.name.trim()} onClick={() => void save()} className="rounded-full bg-primary px-3 py-1.5 text-white disabled:opacity-50">
            حفظ
          </button>
          {form.id && (
            <button onClick={() => setForm(EMPTY)} className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2">
              إلغاء التعديل
            </button>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
        <h3 className="text-base font-semibold">الوكلاء ({list.length})</h3>
        {list.length === 0 && <p className="mt-2 text-xs text-muted">ما في وكلاء لسا.</p>}
        <ul className="mt-2 grid gap-2 text-sm">
          {list.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-outline bg-bg p-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {a.name} <span className="text-xs text-muted">({MODES.find((m) => m.id === a.runOn)?.label.split(':')[0].split(' (')[0]})</span>
                </div>
                {a.prompt && <div className="mt-1 line-clamp-2 text-xs text-muted">{a.prompt}</div>}
                {runId === a.id && (
                  <div className="mt-2 grid gap-2">
                    <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2} placeholder="المهمة يلي بدك الوكيل ينفذها" className={field} />
                    <div className="flex gap-2 text-xs">
                      <button disabled={running || !task.trim()} onClick={() => void runAgent(a.id)} className="rounded-full bg-primary px-3 py-1 text-white disabled:opacity-50">
                        {running ? 'عم ينفّذ…' : 'نفّذ'}
                      </button>
                    </div>
                    {out && <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-outline bg-surface p-2 text-xs">{out}</div>}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  onClick={() => { setRunId(runId === a.id ? '' : a.id); setOut('') }}
                  className="rounded-full bg-primary px-3 py-1 text-white"
                >
                  شغّل
                </button>
                <button onClick={() => setForm(a)} className="rounded-full border border-outline px-3 py-1 hover:bg-surface2">
                  تعديل
                </button>
                <button
                  disabled={busy}
                  onClick={() => void run(async () => { setList(await window.api.agents.remove(a.id)); return 'انحذف الوكيل.' })}
                  className="rounded-full border border-outline px-3 py-1 hover:bg-surface2 disabled:opacity-50"
                >
                  حذف
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
        <h3 className="text-base font-semibold">ذاكرة الوكلاء السحابيين</h3>
        <p className="mt-1 text-xs text-muted">
          الوكيل السحابي بيعرف معلوماتك الأساسية بس (قراءة فقط). أسماء المشاريع، السطور يلي فيها كلمات مسرّية، وأي كلمة بتكتبها هون ما بتنبعت أبداً.
        </p>
        <textarea
          value={blockedText}
          onChange={(e) => setBlockedText(e.target.value)}
          rows={4}
          dir="auto"
          placeholder="كلمات ممنوعة، وحدة بكل سطر (اسم شركة، عميل، مشروع…)"
          className={field + ' mt-3 w-full text-sm'}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const m = await window.api.agentMem.set(blockedText.split('\n'))
                setMem(m)
                setBlockedText(m.blocked.join('\n'))
                return 'انحفظت القائمة وانزامنت.'
              })
            }
            className="rounded-full bg-primary px-3 py-1.5 text-white disabled:opacity-50"
          >
            حفظ ومزامنة
          </button>
          {mem && (
            <span className="text-muted">
              انبعت {mem.used} عنصر · انحجب {mem.dropped} · مشاريع محجوبة تلقائياً: {mem.projects.length}
            </span>
          )}
        </div>
        {mem && mem.text && (
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-outline bg-bg p-2 text-xs">{mem.text}</pre>
        )}
      </section>

      <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
        <h3 className="text-base font-semibold">🔗 ربط إيميل للوكلاء (Gmail)</h3>
        <p className="mt-1 text-xs text-muted">
          عشان الوكلاء السحابيين يقرأوا إيميلاتك وهنّي والكمبيوتر مطفي. بيتولّد سكربت جاهز مع مفتاح خاص (قراءة فقط، ما بيرسل ولا بيمسح). بتلصقو مرة وحدة بحساب Gmail يلي بدك تربطو.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <input dir="ltr" value={mailSrc} onChange={(e) => setMailSrc(e.target.value)} placeholder="اسم الصندوق (مثلاً main)" className={field + ' w-48'} />
          <button
            className="rounded-full bg-primary px-4 py-1.5 text-white disabled:opacity-40"
            disabled={!gate.enabled || !gate.hasKey}
            onClick={async () => {
              setMailMsg('')
              const r = await window.api.gate.linkMail(mailSrc.trim() || 'main')
              if (r.ok && r.script) { setMailScript(r.script); setMailMsg('تولّد السكربت. اتبع الخطوات تحت.') }
              else { setMailScript(''); setMailMsg(r.error ?? 'خطأ') }
            }}
          >
            ولّد السكربت
          </button>
          {mailMsg && <span className="text-xs text-muted">{mailMsg}</span>}
        </div>
        {mailScript && (
          <div className="mt-3 space-y-2 text-xs leading-relaxed">
            <ol className="list-decimal space-y-1 pe-5 text-muted">
              <li>افتح script.google.com وانت مسجّل بحساب Gmail المطلوب، واختار «مشروع جديد».</li>
              <li>امسح الكود الموجود والصق السكربت تحت، ثم احفظ.</li>
              <li>اختار الدالة installTrigger من القائمة فوق، واضغط «تشغيل» ووافق على الصلاحيات (قراءة الإيميل بس).</li>
              <li>خلص: كل دقيقة بيدفع الإيميلات الجديدة للبوابة. بعدها اكتب اسم الصندوق بحقل «مصادر الإيميل» عند الوكيل (أو اتركو فاضي).</li>
            </ol>
            <textarea readOnly dir="ltr" value={mailScript} className={field + ' h-44 w-full font-mono text-[11px]'} onFocus={(e) => e.currentTarget.select()} />
            <button className="rounded-full px-3 py-1.5 hover:bg-surface2" onClick={() => void navigator.clipboard.writeText(mailScript).then(() => setMailMsg('انسخ السكربت'))}>
              📋 انسخ السكربت
            </button>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
        <h3 className="text-base font-semibold">البوابة السحابية (Cloudflare)</h3>
        <p className="mt-1 text-xs text-muted">
          لما تكون شغّالة، تيليغرام بيمرّ على البوابة: إذا البرنامج شغّال بتنفذ المهمة هون، وإذا الكمبيوتر مطفي بتشتغل على السحابة. بتحتاج رابط البوابة ومفتاحها.
        </p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://trl-agent-gate.xxx.workers.dev" className={field} />
          <input
            dir="ltr"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={gate.hasKey ? 'المفتاح محفوظ (اكتب مفتاح جديد لتغييرو)' : 'مفتاح البوابة (GATE_KEY)'}
            className={field}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button disabled={busy} onClick={() => void saveGate()} className="rounded-full bg-primary px-3 py-1.5 text-white disabled:opacity-50">
            حفظ
          </button>
          <button
            disabled={busy || !gate.url || !gate.hasKey}
            onClick={() => void run(async () => { const r = await window.api.gate.test(); return r.ok ? 'البوابة شغّالة وانزامنت الوكلاء.' : 'فشل: ' + (r.error ?? '') })}
            className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2 disabled:opacity-50"
          >
            جرّب ومزامنة الوكلاء
          </button>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={gate.enabled} disabled={busy || !gate.url || !gate.hasKey} onChange={(e) => void saveGate(e.target.checked)} />
            شغّل وضع البوابة
          </label>
        </div>
      </section>

      {msg && <p className="mt-3 text-xs text-muted">{msg}</p>}
    </div>
  )
}