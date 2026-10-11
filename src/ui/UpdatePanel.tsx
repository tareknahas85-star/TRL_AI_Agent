import { useEffect, useState } from 'react'

type R = { ok: boolean; current: string; latest?: string; newer?: boolean; url?: string; note?: string }

export function UpdatePanel() {
  const [st, setSt] = useState({ enabled: true, version: '' })
  const [r, setR] = useState<R | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.api.update.get().then(setSt)
  }, [])
  return (
    <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
      <h3 className="text-base font-semibold">التحديثات</h3>
      <p className="mt-1 text-xs text-muted">
        إصدارك الحالي: {st.version}. بيفحص GitHub Releases مرة باليوم (طلب واحد مجهول، ما بيبعت شي عنك) وبينبّهك إذا في إصدار أجدد. ما بيركّب شي لحاله؛ بتنزّل وبتثبّت إنت.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={st.enabled} onChange={async (e) => setSt(await window.api.update.set(e.target.checked))} />
          افحص تلقائياً
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setR(await window.api.update.check())
            setBusy(false)
          }}
          className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2 disabled:opacity-50"
        >
          افحص هلأ
        </button>
        {r && (
          <span className={r.newer ? 'text-warning' : 'text-muted'}>
            {!r.ok ? 'تعذّر الفحص: ' + (r.note ?? '') : r.newer ? `في إصدار أجدد: ${r.latest}` : (r.note ?? 'إنت على آخر إصدار')}
          </span>
        )}
        {r?.newer && r.url && (
          <button onClick={() => void window.api.update.open(r.url!)} className="rounded-full bg-primary px-3 py-1.5 text-white">
            افتح صفحة التنزيل
          </button>
        )}
      </div>
    </section>
  )
}
