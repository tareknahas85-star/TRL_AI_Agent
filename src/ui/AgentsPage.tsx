import { useEffect, useState } from 'react'
import type { AgentInfo, GateInfo } from '../preload/index.d'

const MODES: { id: AgentInfo['runOn']; label: string }[] = [
  { id: 'auto', label: 'تلقائي: محلي إذا الكمبيوتر شغّال، وإلا سحابي' },
  { id: 'local', label: 'محلي فقط (على هالكمبيوتر)' },
  { id: 'cloud', label: 'سحابي فقط (بيشتغل حتى لو الكمبيوتر مطفي)' }
]
const EMPTY: AgentInfo = { id: '', name: '', prompt: '', runOn: 'auto' }
const field = 'rounded-lg border border-outline bg-bg px-3 py-1.5 outline-none focus:border-primary'

export function AgentsPage() {
  const [list, setList] = useState<AgentInfo[]>([])
  const [form, setForm] = useState<AgentInfo>(EMPTY)
  const [gate, setGate] = useState<GateInfo>({ enabled: false, url: '', hasKey: false })
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.agents.list().then(setList).catch(() => undefined)
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
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
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