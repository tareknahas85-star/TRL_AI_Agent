import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plug, Plus, Trash2 } from 'lucide-react'
import type { CustomModelInfo, Tier } from '../preload/index.d'
import { Settings } from './Settings'
import { CatalogPanel } from './CatalogPanel'
import { Chip, Empty, Modal, PageShell, TIER_LABEL, Toggle, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

const BUILTIN: { tier: Tier; models: string[] }[] = [
  { tier: 'TIER_1_FREE', models: ['qwen/qwen3.8-27b:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3.5-lightning:free'] },
  { tier: 'TIER_2_CHEAP', models: ['deepseek/deepseek-v4.1-flash', 'google/gemini-3.5-flash-lite', 'openai/gpt-4o-mini'] },
  { tier: 'TIER_3_EXPENSIVE', models: ['anthropic/claude-sonnet-5', 'openai/gpt-4o'] }
]
const empty = { name: '', model: '', baseURL: '', apiKey: '', tier: 'TIER_2_CHEAP' as Tier }

export function ModelsPage() {
  const [models, setModels] = useState<CustomModelInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [keyFor, setKeyFor] = useState<CustomModelInfo | null>(null)
  const [keyVal, setKeyVal] = useState('')
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [local, setLocal] = useState<{ runtime: string; baseURL: string; models: string[] }[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const scan = async (): Promise<void> => {
    setScanning(true)
    setLocal(await window.api.models.detectLocal())
    setScanning(false)
  }
  const addLocal = async (baseURL: string, model: string, runtime: string): Promise<void> => {
    const r = await window.api.models.add({ name: `${model} (${runtime})`, model, baseURL, tier: 'TIER_1_FREE' })
    if (!r.ok) setError(r.error ?? 'خطأ')
    load()
  }
  const [remote, setRemote] = useState<{ src: CustomModelInfo; list: { id: string; recommended: boolean; added: boolean; free: boolean }[]; sel: Set<string>; all: boolean } | null>(null)
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null)
  const fetchRemote = async (m: CustomModelInfo, all = false): Promise<void> => {
    setRemoteBusy(m.id)
    const r = await window.api.models.fetchRemote(m.id, all)
    setRemoteBusy(null)
    if (!r.ok || !r.models) return setResults((p) => ({ ...p, [m.id]: { ok: false, message: r.error ?? 'فشل الجلب' } }))
    setRemote({ src: m, all, list: r.models, sel: new Set(r.models.filter((x) => x.recommended && x.free && !x.added).map((x) => x.id)) })
  }
  const load = useCallback(() => window.api.models.list().then(setModels), [])
  useEffect(() => {
    load()
  }, [load])

  const add = async (): Promise<void> => {
    const r = await window.api.models.add({
      name: form.name.trim(),
      model: form.model.trim(),
      baseURL: form.baseURL.trim(),
      apiKey: form.apiKey,
      tier: form.tier
    })
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setForm(empty)
    setError('')
    load()
  }

  return (
    <PageShell
      title="الموديلات"
      subtitle="الراوتر بيجرّب الموديلات حسب الطبقة وبينتقل للتالي إذا فشل واحد. ضيف موديلك الخارجي وحدد طبقته."
      action={
        <button className={primaryBtn + ' flex items-center gap-1'} onClick={() => setAdding(true)}>
          <Plus size={16} /> ضيف موديل
        </button>
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted">موديلات محلية (Ollama / LM Studio)</h3>
        <button className={ghostBtn} onClick={scan} disabled={scanning}>{scanning ? 'عم أفحص…' : 'فحص الموديلات المحلية'}</button>
      </div>
      {local !== null && (
        <div className="mb-6 space-y-2">
          {local.length === 0 ? (
            <Empty text="ما لقيت سيرفر محلي شغّال. ثبّت Ollama (أو LM Studio) وشغّله، وحمّل موديل صغير مثل qwen3:1.7b، وبعدين دوس فحص." />
          ) : (
            local.map((rt) => (
              <div key={rt.runtime} className={cardCls}>
                <div className="mb-2 text-sm font-semibold">{rt.runtime} <span dir="ltr" className="font-mono text-xs text-muted">{rt.baseURL}</span></div>
                {rt.models.length === 0 ? (
                  <p className="text-xs text-muted">شغّال بس ما فيه موديلات محمّلة.</p>
                ) : (
                  <ul className="space-y-1">
                    {rt.models.map((m) => {
                      const added = models.some((x) => x.model === m && x.baseURL === rt.baseURL)
                      return (
                        <li key={m} className="flex items-center justify-between gap-3">
                          <span dir="ltr" className="truncate font-mono text-xs">{m}</span>
                          <button className={ghostBtn} disabled={added} onClick={() => addLocal(rt.baseURL, m, rt.runtime)}>{added ? 'مضاف' : 'ضيف'}</button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <h3 className="mb-2 text-sm font-semibold text-muted">موديلاتك المخصصة</h3>
      {models.length === 0 ? (
        <Empty text="ما في موديلات مخصصة - ضيف موديل خارجي (OpenAI-compatible أو OpenRouter)" />
      ) : (
        <div className="space-y-2">
          {models.map((m) => {
            const r = results[m.id]
            return (
              <div key={m.id} className={cardCls + ' flex flex-wrap items-center justify-between gap-3'}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{m.name}</span>
                    <Chip cls={TIER_LABEL[m.tier].cls}>{TIER_LABEL[m.tier].label}</Chip>
                    {m.hasKey && <Chip>مفتاح محفوظ</Chip>}
                  </div>
                  <div dir="ltr" className="truncate text-start font-mono text-xs text-muted">
                    {m.model} · {m.baseURL || 'openrouter.ai'}
                  </div>
                  {r && <div className={`mt-1 text-xs ${r.ok ? 'text-success' : 'text-danger'}`}>{r.ok ? '✓ ' : '✗ '}{r.message}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className={ghostBtn + ' flex items-center gap-1'}
                    disabled={testing === m.id}
                    onClick={async () => {
                      setTesting(m.id)
                      const res = await window.api.models.test(m.id)
                      setResults((p) => ({ ...p, [m.id]: res }))
                      setTesting(null)
                    }}
                  >
                    {testing === m.id ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} اختبار
                  </button>
                  <button
                    className={ghostBtn}
                    title="ترتيب التجربة داخل طبقته: قبل أو بعد موديلات OpenRouter"
                    onClick={async () => { await window.api.models.setPosition(m.id, !m.last); load() }}
                  >
                    {m.last ? 'بينجرّب: بعد' : 'بينجرّب: أول'}
                  </button>
                  {m.baseURL && m.hasKey && !m.baseURL.includes('11434') && (
                    <button className={ghostBtn} disabled={remoteBusy === m.id} onClick={() => fetchRemote(m)}>{remoteBusy === m.id ? 'عم أجلب…' : 'جلب المجانية'}</button>
                  )}
                  <button className={ghostBtn} onClick={() => { setKeyVal(''); setKeyFor(m) }}>المفتاح</button>
                  <button
                    className={ghostBtn + ' text-danger'}
                    aria-label={`حذف ${m.name}`}
                    onClick={async () => {
                      if (confirm(`بدك تحذف الموديل ${m.name}؟`)) {
                        await window.api.models.remove(m.id)
                        load()
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                  <Toggle checked={m.enabled} label={`تفعيل ${m.name}`} onChange={async () => { await window.api.models.toggle(m.id); load() }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <h3 className="mb-2 mt-8 text-sm font-semibold text-muted">مفاتيح الـ API</h3>
      <div className={cardCls}>
        <p className="mb-3 text-xs text-muted">بتنحفظ مشفّرة على جهازك.</p>
        <Settings variant="inline" />
      </div>
      <div className="mt-3"><CatalogPanel /></div>

      <h3 className="mb-2 mt-8 text-sm font-semibold text-muted">الموديلات المدمجة (حسب الطبقة)</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {BUILTIN.map((t) => (
          <div key={t.tier} className={cardCls}>
            <Chip cls={TIER_LABEL[t.tier].cls}>{TIER_LABEL[t.tier].label}</Chip>
            <ul dir="ltr" className="mt-3 space-y-1 text-start font-mono text-xs text-muted">
              {t.models.map((x) => <li key={x} className="truncate">{x}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {adding && (
        <Modal title="ضيف موديل خارجي" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <input className={inputCls} placeholder="اسم للعرض (e.g. Llama محلي)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input dir="ltr" className={inputCls + ' font-mono'} placeholder="Model ID (e.g. gpt-4o-mini)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input dir="ltr" className={inputCls + ' font-mono'} placeholder="Base URL (فاضي = OpenRouter) e.g. http://localhost:11434/v1" value={form.baseURL} onChange={(e) => setForm({ ...form, baseURL: e.target.value })} />
            <input dir="ltr" type="password" className={inputCls} placeholder="API Key (اختياري للسيرفرات المحلية)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            <select className={inputCls} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}>
              {(Object.keys(TIER_LABEL) as Tier[]).map((t) => <option key={t} value={t}>الطبقة: {TIER_LABEL[t].label}</option>)}
            </select>
            <p className="text-xs text-muted">أي سيرفر بيدعم واجهة OpenAI (chat/completions) بيشتغل: OpenAI, Groq, Together, Ollama, LM Studio…</p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!form.name.trim() || !form.model.trim()} onClick={add}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
      {remote && (
        <Modal title={`موديلات مجانية من ${remote.src.baseURL}`} onClose={() => setRemote(null)}>
          <div className="space-y-3">
            <p className="text-xs text-muted">{remote.list.length} موديل مجاني. الـcoding-* مو محددة افتراضي (غالباً محصورة بأدوات البرمجة). بتنضاف بآخر السلسلة وبنفس المفتاح المحفوظ.</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={remote.all} onChange={(e) => fetchRemote(remote.src, e.target.checked)} />
              عرض كل الموديلات (بما فيها المدفوعة). غير المجانية بتنضاف بطبقة "رخيص" فما بتنستخدم إلا إذا سمحت بالمدفوع.
            </label>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {remote.list.map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" disabled={x.added} checked={x.added || remote.sel.has(x.id)} onChange={(e) => { const s = new Set(remote.sel); if (e.target.checked) s.add(x.id); else s.delete(x.id); setRemote({ ...remote, sel: s }) }} />
                  <span dir="ltr" className="font-mono">{x.id}</span>
                  {x.added && <Chip>مضاف</Chip>}
                  {!x.free && <Chip>مدفوع/غير مؤكد</Chip>}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setRemote(null)}>إلغاء</button>
              <button className={primaryBtn} disabled={!remote.sel.size} onClick={async () => { await window.api.models.importRemote(remote.src.id, remote.list.filter((x) => remote.sel.has(x.id)).map((x) => ({ id: x.id, free: x.free }))); setRemote(null); load() }}>ضيف المحدد ({remote.sel.size})</button>
            </div>
          </div>
        </Modal>
      )}
      {keyFor && (
        <Modal title={`مفتاح ${keyFor.name}`} onClose={() => setKeyFor(null)}>
          <div className="space-y-3">
            <input dir="ltr" type="password" className={inputCls} placeholder="API Key الجديد (فاضي = مسح المفتاح)" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setKeyFor(null)}>إلغاء</button>
              <button className={primaryBtn} onClick={async () => { await window.api.models.setKey(keyFor.id, keyVal); setKeyFor(null); load() }}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
