import { useEffect, useState, type ReactElement } from 'react'

type Series = { days: string[]; engines: { engine: string; points: { day: string; runs: number; minutes: number }[]; totalRuns: number; totalMinutes: number }[] }

// 5.16: خط استخدام لكل نموذج (محلي). ما في رصيد متبقي، هذا عدّاد تشغيلات ودقايق بس.
const NAMES: Record<string, string> = { 'cli:claude': 'Claude', 'cli:gemini': 'Gemini', 'cli:codex': 'Codex' }
const COLORS = ['#d97706', '#2563eb', '#059669', '#7c3aed', '#dc2626']
const W = 640
const H = 220
const P = 32

export function UsageChart(): ReactElement {
  const [s, setS] = useState<Series | null>(null)
  const [metric, setMetric] = useState<'runs' | 'minutes'>('runs')

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.api.usage
        .series()
        .then((r) => alive && setS(r))
        .catch(() => undefined)
    }
    load()
    const t = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  return (
    <div className="mb-6 rounded-lg border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">الاستخدام لكل نموذج (آخر 14 يوم)</h3>
        <div className="flex gap-1 text-xs">
          <button className={'rounded px-2 py-1 ' + (metric === 'runs' ? 'bg-[#2563eb] text-white' : 'border border-line')} onClick={() => setMetric('runs')}>
            تشغيلات
          </button>
          <button className={'rounded px-2 py-1 ' + (metric === 'minutes' ? 'bg-[#2563eb] text-white' : 'border border-line')} onClick={() => setMetric('minutes')}>
            دقايق
          </button>
        </div>
      </div>
      {!s ? (
        <p className="text-sm text-muted">جاري التحميل...</p>
      ) : s.engines.length === 0 ? (
        <p className="text-sm text-muted">ما في استخدام مسجّل لسا. بيبلّش يتسجّل بأول تشغيل.</p>
      ) : (
        <>
          <ul className="mb-3 space-y-2 text-sm">
            {s.engines.map((e, idx) => {
              const total = metric === 'runs' ? e.totalRuns : e.totalMinutes
              const maxTotal = Math.max(1, ...s.engines.map((x) => (metric === 'runs' ? x.totalRuns : x.totalMinutes)))
              return (
                <li key={e.engine} className="flex items-center gap-3">
                  <span className="w-40 truncate text-start font-medium" title={e.engine}>
                    {NAMES[e.engine] ?? e.engine}
                  </span>
                  <div className="h-3 flex-1 rounded bg-surface2">
                    <div className="h-3 rounded" style={{ width: `${(total / maxTotal) * 100}%`, background: COLORS[idx % COLORS.length] }} />
                  </div>
                  <span className="w-20 text-end text-muted">{total}</span>
                </li>
              )
            })}
          </ul>          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="خط استخدام لكل نموذج">
            <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" opacity={0.3} />
            {s.engines.map((e, idx) => {
              const vals = e.points.map((p) => p[metric])
              const max = Math.max(1, ...s.engines.flatMap((x) => x.points.map((p) => p[metric])))
              const pts = vals
                .map((v, i) => {
                  const px = P + (vals.length <= 1 ? 0 : (i * (W - 2 * P)) / (vals.length - 1))
                  const py = H - P - (v / max) * (H - 2 * P)
                  return `${px.toFixed(1)},${py.toFixed(1)}`
                })
                .join(' ')
              return <polyline key={e.engine} points={pts} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth={2} />
            })}
          </svg>
          <ul className="mt-2 flex flex-wrap gap-4 text-sm">
            {s.engines.map((e, idx) => (
              <li key={e.engine} className="flex items-center gap-2">
                <span className="inline-block h-2 w-4 rounded" style={{ background: COLORS[idx % COLORS.length] }} />
                <span className="font-medium">{NAMES[e.engine] ?? e.engine}</span>
                <span className="text-muted">
                  {e.totalRuns} تشغيل · {e.totalMinutes} دقيقة
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">هذا عدّاد محلي من تشغيلات البرنامج، مو رصيد الحساب.</p>
        </>
      )}
    </div>
  )
}