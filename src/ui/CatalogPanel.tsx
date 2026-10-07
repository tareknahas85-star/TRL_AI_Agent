import { CapIcons } from './Caps'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, PlugZap, DownloadCloud, ArrowUp, ArrowDown } from 'lucide-react'
import { Chip, TIER_LABEL, Toggle, cardCls, ghostBtn, inputCls } from './components/ui'

type CModel = {
  id: string
  name: string
  tier: 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'
  pricePerM: number
  context: number
  vision: boolean
  tools?: boolean
  reasoning?: boolean
  enabled: boolean
}

// OpenRouter key tools: test the key, pull the models that key can use, and choose manually which ones are active.
export function CatalogPanel() {
  const [models, setModels] = useState<CModel[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)
  const [busy, setBusy] = useState<'test' | 'fetch' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [q, setQ] = useState('')
  const [tierF, setTierF] = useState<'ALL' | CModel['tier']>('ALL')
  const [onlyEnabled, setOnlyEnabled] = useState(false)

  const load = useCallback(async () => {
    const c = await window.api.catalog.list()
    setModels(c.models)
    setFetchedAt(c.fetchedAt)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const test = async (): Promise<void> => {
    setBusy('test')
    const r = await window.api.catalog.test()
    setMsg({ ok: r.ok, text: r.message })
    setBusy(null)
  }
  const pull = async (): Promise<void> => {
    setBusy('fetch')
    const r = await window.api.catalog.fetch()
    setMsg({ ok: r.ok, text: r.message })
    await load()
    setBusy(null)
  }

  const shown = useMemo(
    () =>
      [...models].sort((a, b) => Number(b.enabled) - Number(a.enabled)).filter(
        (m) =>
          (tierF === 'ALL' || m.tier === tierF) &&
          (!onlyEnabled || m.enabled) &&
          (!q || (m.id + ' ' + m.name).toLowerCase().includes(q.toLowerCase()))
      ),
    [models, q, tierF, onlyEnabled]
  )
  const enabledCount = models.filter((m) => m.enabled).length

  const setMany = async (ids: string[], on: boolean): Promise<void> => {
    await window.api.catalog.setEnabled(ids, on)
    await load()
  }

  return (
    <div className={cardCls + ' mb-6'}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">موديلات مفتاح OpenRouter</h3>
        <span className="text-xs text-muted">
          {models.length ? `${enabledCount} مفعّل من ${models.length}` : 'ما انسحبت موديلات بعد — هلق بيستخدم القائمة الافتراضية'}
        </span>
        <div className="flex-1" />
        <button className={ghostBtn} onClick={test} disabled={busy !== null}>
          {busy === 'test' ? <Loader2 size={14} className="inline animate-spin" /> : <PlugZap size={14} className="inline" />} اختبار المفتاح
        </button>
        <button className={ghostBtn} onClick={pull} disabled={busy !== null}>
          {busy === 'fetch' ? <Loader2 size={14} className="inline animate-spin" /> : <DownloadCloud size={14} className="inline" />} سحب الموديلات
        </button>
      </div>

      {msg && <p className={'mb-3 text-xs ' + (msg.ok ? 'text-green-500' : 'text-red-500')}>{msg.ok ? '✓ ' : '✗ '}{msg.text}</p>}

      {models.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input dir="ltr" className={inputCls + ' max-w-xs'} placeholder="بحث…" value={q} onChange={(e) => setQ(e.target.value)} />
            {(['ALL', 'TIER_1_FREE', 'TIER_2_CHEAP', 'TIER_3_EXPENSIVE'] as const).map((t) => (
              <button key={t} className={ghostBtn + (tierF === t ? ' bg-surface2' : '')} onClick={() => setTierF(t)}>
                {t === 'ALL' ? 'الكل' : TIER_LABEL[t].label}
              </button>
            ))}
            <button className={ghostBtn + (onlyEnabled ? ' bg-surface2' : '')} onClick={() => setOnlyEnabled(!onlyEnabled)}>المفعّل بس</button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <button className={ghostBtn} onClick={() => setMany(shown.map((m) => m.id), true)}>تفعيل المعروض ({shown.length})</button>
            <button className={ghostBtn} onClick={() => setMany(shown.map((m) => m.id), false)}>إلغاء تفعيل المعروض</button>
            <button className={ghostBtn} onClick={async () => { if (confirm('ترجّع التفعيل للإعدادات الافتراضية (الموديلات المدمجة بس)؟')) { await window.api.catalog.reset(); load() } }}>إعادة ضبط</button>
            {fetchedAt > 0 && <span className="self-center text-muted">آخر سحب: {new Date(fetchedAt).toLocaleString()}</span>}
          </div>
          <p className="mb-2 text-xs text-muted">المفعّلة بتظهر فوق، والأسهم بتغيّر ترتيب التجربة داخل نفس الطبقة (الأعلى بيجرَّب أول).</p>
          <ul className="max-h-96 space-y-1 overflow-y-auto pe-1">
            {shown.slice(0, 300).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 hover:bg-surface2">
                <div className="min-w-0">
                  <div dir="ltr" className="truncate text-start font-mono text-xs">{m.id}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Chip cls={TIER_LABEL[m.tier].cls}>{TIER_LABEL[m.tier].label}</Chip>
                    {m.pricePerM > 0 && <Chip>${m.pricePerM.toFixed(2)}/M</Chip>}
                    {m.context > 0 && <Chip>{Math.round(m.context / 1000)}K</Chip>}
                    <CapIcons caps={{ vision: m.vision, tools: m.tools, reasoning: m.reasoning }} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {m.enabled && (
                    <>
                      <button className={ghostBtn + ' !px-2'} title="قدّم بالأولوية" onClick={async () => { await window.api.catalog.move(m.id, 'up'); load() }}><ArrowUp size={14} /></button>
                      <button className={ghostBtn + ' !px-2'} title="أخّر بالأولوية" onClick={async () => { await window.api.catalog.move(m.id, 'down'); load() }}><ArrowDown size={14} /></button>
                    </>
                  )}
                <Toggle checked={m.enabled} label={`تفعيل ${m.id}`} onChange={() => setMany([m.id], !m.enabled)} />
                </div>
              </li>
            ))}
          </ul>
          {shown.length > 300 && <p className="mt-2 text-xs text-muted">عم يعرض أول 300 — استعمل البحث للتضييق.</p>}
        </>
      )}
    </div>
  )
}
