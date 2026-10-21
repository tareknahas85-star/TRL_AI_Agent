import { useEffect, useState, type ReactElement } from 'react'
import { describeUpdate, type UpdateResult } from '../core/update-state'

export function UpdatePanel(): ReactElement {
  const [st, setSt] = useState({ enabled: true, version: '' })
  const [r, setR] = useState<UpdateResult | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.api.update.get().then(setSt)
  }, [])
  const isAvailable = r?.status === 'available'
  return (
    <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
      <h3 className="text-base font-semibold">التحديثات</h3>
      <p className="mt-1 text-xs text-muted">
        إصدارك الحالي: {st.version}. بيفحص GitHub Releases مرة باليوم (طلب واحد مجهول، ما بيبعت شي عنك). إذا لقى إصدار أجدد بيسألك: &quot;حدّث هلأ&quot; أو &quot;بعدين&quot;. ما بيركّب شي إلا إذا وافقت.
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
          {busy ? 'عم يفحص…' : 'افحص هلأ'}
        </button>
        {r && (
          <span
            role="status"
            className={r.status === 'available' ? 'text-warning' : r.status === 'current' || r.status === 'no-release' ? 'text-muted' : 'text-danger'}
          >
            {describeUpdate(r)}
          </span>
        )}
        {isAvailable && r.url && (
          <button onClick={() => void window.api.update.open(r.url!)} className="rounded-full bg-primary px-3 py-1.5 text-white">
            افتح صفحة التنزيل
          </button>
        )}
      </div>
    </section>
  )
}
