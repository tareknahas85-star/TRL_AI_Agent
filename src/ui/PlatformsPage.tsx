import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, Loader2, Plus } from 'lucide-react'
import { Chip, PageShell, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

type Ov = Awaited<ReturnType<typeof window.api.platforms.overview>>

const bar = (s: number): string => (s >= 85 ? 'bg-success' : s >= 65 ? 'bg-primary' : s >= 50 ? 'bg-warning' : 'bg-muted')

// 5.18.0: كل المنصات والموديلات المحمّلة منها + ترتيب عام من الأقوى للأضعف (تقدير من الاسم والحجم، مو قياس فعلي).
export function PlatformsPage() {
  const [ov, setOv] = useState<Ov | null>(null)
  const [freeOnly, setFreeOnly] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  const [form, setForm] = useState({ name: '', baseURL: '', key: '' })
  const [addMsg, setAddMsg] = useState('')

  const load = useCallback(() => window.api.platforms.overview(freeOnly).then(setOv), [freeOnly])
  useEffect(() => {
    void load()
  }, [load])

  const toggle = (id: string): void => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pull = async (id: string): Promise<void> => {
    setBusy(id)
    const r = await window.api.platforms.pull(id)
    setMsg((m) => ({ ...m, [id]: r.message }))
    setBusy(null)
    await load()
  }
  const add = async (): Promise<void> => {
    setBusy('add')
    const r = await window.api.platforms.add(form.name, form.baseURL, form.key)
    setAddMsg(r.message)
    if (r.ok) setForm({ name: '', baseURL: '', key: '' })
    setBusy(null)
    await load()
  }

  const ranking = ov?.ranking ?? []
  const shown = showAll ? ranking : ranking.slice(0, 25)

  return (
    <PageShell title="المنصات" subtitle="كل المنصات بموديلاتها المحمّلة، وترتيب عام من الأقوى للأضعف بغض النظر عن المنصة. الدرجة تقدير من الاسم والحجم (مو قياس فعلي).">
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
        المجاني فقط
      </label>

      <div className={cardCls + ' mb-4'}>
        <div className="mb-2 font-semibold">الترتيب العام ({ranking.length})</div>
        <div className="space-y-1">
          {shown.map((m, i) => (
            <div key={m.platform + m.id} className="flex items-center gap-2 text-xs">
              <span className="w-6 shrink-0 text-muted">{i + 1}</span>
              <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono">{m.label}</span>
              <Chip>{m.platformName}</Chip>
              {m.tools && <Chip cls="bg-primary/15 text-primary">أدوات</Chip>}
              {m.image && <Chip cls="bg-success/15 text-success">صور</Chip>}
              {m.dup > 0 && <span className="text-muted" title="نفس الموديل موجود بمنصات تانية">+{m.dup}</span>}
              <span className="flex w-24 shrink-0 items-center gap-1">
                <span className="h-1.5 flex-1 rounded-full bg-surface2"><span className={`block h-1.5 rounded-full ${bar(m.score)}`} style={{ width: m.score + '%' }} /></span>
                <span className="w-7 text-end tabular-nums">{Math.round(m.score)}</span>
              </span>
            </div>
          ))}
          {ranking.length === 0 && <p className="text-xs text-muted">ما في موديلات بعد. اسحب من المنصات تحت.</p>}
        </div>
        {ranking.length > 25 && (
          <button className={ghostBtn + ' mt-2'} onClick={() => setShowAll((v) => !v)}>{showAll ? 'اعرض أقل' : `اعرض كل ${ranking.length}`}</button>
        )}
      </div>

      <div className="space-y-2">
        {(ov?.platforms ?? []).map((p) => {
          const list = (freeOnly ? p.models.filter((m) => m.free) : p.models).slice().sort((a, b) => b.score - a.score)
          const isOpen = open.has(p.id)
          return (
            <div key={p.id} className={cardCls}>
              <div className="flex flex-wrap items-center gap-2">
                <button className="flex items-center gap-1 font-semibold" aria-expanded={isOpen} onClick={() => toggle(p.id)}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronLeft size={14} />} {p.name}
                </button>
                <Chip cls={p.hasKey ? 'bg-success/15 text-success' : 'bg-warning/20 text-warning'}>{p.hasKey ? 'المفتاح موجود' : 'ما في مفتاح'}</Chip>
                <span className="text-xs text-muted">{list.length} موديل{freeOnly ? ' مجاني' : ''}</span>
                <span className="flex-1" />
                <button className={ghostBtn} disabled={busy !== null} onClick={() => void pull(p.id)}>
                  {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : 'اختبر المفتاح واسحب المجاني'}
                </button>
              </div>
              {p.note && <p className="mt-1 text-xs text-muted">{p.note}</p>}
              {msg[p.id] && <p className="mt-1 text-xs">{msg[p.id]}</p>}
              {isOpen && (
                <div className="mt-2 max-h-80 space-y-0.5 overflow-auto">
                  {list.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs">
                      <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono">{m.label}</span>
                      {m.tools && <Chip cls="bg-primary/15 text-primary">أدوات</Chip>}
                      {m.image && <Chip cls="bg-success/15 text-success">صور</Chip>}
                      <span className="w-8 text-end tabular-nums text-muted">{Math.round(m.score)}</span>
                    </div>
                  ))}
                  {list.length === 0 && <p className="text-xs text-muted">ما في موديلات بهالعرض.</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className={cardCls + ' mt-4 space-y-2'}>
        <div className="font-semibold">إضافة منصة</div>
        <p className="text-xs text-muted">أي منصة متوافقة مع OpenAI: بنختبر المفتاح وبنسحب موديلاتها المجانية ونضيفها.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={inputCls} placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input dir="ltr" className={inputCls + ' font-mono'} placeholder="https://api.example.com/v1" value={form.baseURL} onChange={(e) => setForm({ ...form, baseURL: e.target.value })} />
          <input dir="ltr" type="password" className={inputCls + ' font-mono'} placeholder="API key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        </div>
        <button className={primaryBtn + ' flex items-center gap-1'} disabled={busy !== null || !form.name.trim() || !form.baseURL.trim() || !form.key.trim()} onClick={() => void add()}>
          {busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} أضف واسحب المجاني
        </button>
        {addMsg && <p className="text-xs">{addMsg}</p>}
      </div>
    </PageShell>
  )
}
