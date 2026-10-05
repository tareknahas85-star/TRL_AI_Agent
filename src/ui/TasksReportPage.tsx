import { Fragment, useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import type { ProjectInfo, TaskRowInfo } from '../preload/index.d'

const TIER: Record<TaskRowInfo['tier'], string> = { free: 'مجاني', cheap: 'رخيص', sub: 'اشتراكك', custom: 'مخصص', other: 'مدفوع/غير محدد' }
const fmtDur = (ms: number): string => (ms >= 60000 ? Math.floor(ms / 60000) + 'د ' + Math.round((ms % 60000) / 1000) + 'ث' : ms > 0 ? (ms / 1000).toFixed(1) + 'ث' : '-')
const fmtTime = (t: number): string => (t ? new Date(t).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' }) : '-')
const fmtCost = (c: number): string => (c > 0 ? '$' + (c < 0.01 ? c.toFixed(4) : c.toFixed(2)) : '-')
const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10)
const csvCell = (v: string | number): string => '"' + String(v).replace(/"/g, '""') + '"'

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-card border border-outline bg-surface p-3 text-center shadow-card">
      <div className={'text-xl font-semibold ' + (tone ?? '')}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  )
}

const sel = 'rounded-full border border-outline bg-surface px-3 py-1.5 text-xs outline-none'

export function TasksReportPage({ onOpenConv }: { onOpenConv?: (id: string) => void }) {
  const [rows, setRows] = useState<TaskRowInfo[] | null>(null)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [proj, setProj] = useState('all')
  const [model, setModel] = useState('all')
  const [period, setPeriod] = useState<'7' | '30' | 'all'>('all')
  const [status, setStatus] = useState<'all' | 'esc' | 'fail'>('all')
  const [budget, setBudget] = useState(0)
  const [note, setNote] = useState('')
  const load = (): void => {
    window.api.report.tasks().then(setRows).catch(() => setRows([]))
    window.api.projects.list().then((r) => setProjects(r.projects)).catch(() => undefined)
    window.api.report.budget().then(setBudget).catch(() => undefined)
  }
  useEffect(load, [])

  const all = rows ?? []
  const models = useMemo(() => [...new Set(all.map((r) => r.model))].sort(), [all])
  const list = useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86400000
    const s = q.trim().toLowerCase()
    return all.filter(
      (r) =>
        r.at >= since &&
        (proj === 'all' || (proj === 'none' ? !r.projectId : r.projectId === proj)) &&
        (model === 'all' || r.model === model) &&
        (status === 'all' || (status === 'esc' ? r.escalated : r.failures > 0)) &&
        (!s || (r.prompt + ' ' + r.convTitle + ' ' + r.model).toLowerCase().includes(s))
    )
  }, [all, q, proj, model, period, status])

  const free = list.filter((r) => r.tier === 'free').length
  const esc = list.filter((r) => r.escalated).length
  const withFail = list.filter((r) => r.failures > 0).length
  const timed = list.filter((r) => r.totalMs > 0)
  const avg = timed.length ? timed.reduce((s, r) => s + r.totalMs, 0) / timed.length : 0
  const totalCost = list.reduce((s, r) => s + r.cost, 0)
  const monthKey = new Date().toISOString().slice(0, 7)
  const monthCost = all.filter((r) => dayKey(r.at).startsWith(monthKey)).reduce((s, r) => s + r.cost, 0)
  const overBudget = budget > 0 && monthCost >= budget
  const nearBudget = budget > 0 && monthCost >= budget * 0.8

  const byModel = new Map<string, number>()
  list.forEach((r) => byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1))
  const top = [...byModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  // failures: every model in "tried" except the last one (the one that finally answered) counts as a failed attempt
  const fails = useMemo(() => {
    const m = new Map<string, { fail: number; seen: number }>()
    list.forEach((r) => {
      r.tried.forEach((t, i) => {
        const e = m.get(t) ?? { fail: 0, seen: 0 }
        e.seen++
        if (i < r.tried.length - 1) e.fail++
        m.set(t, e)
      })
    })
    return [...m.entries()].filter(([, v]) => v.fail > 0).sort((a, b) => b[1].fail - a[1].fail).slice(0, 5)
  }, [list])

  // last 14 days: tasks / free tasks / escalations
  const days = useMemo(() => {
    const out: { k: string; n: number; free: number; esc: number }[] = []
    for (let i = 13; i >= 0; i--) out.push({ k: dayKey(Date.now() - i * 86400000), n: 0, free: 0, esc: 0 })
    all.forEach((r) => {
      const d = out.find((x) => x.k === dayKey(r.at))
      if (!d) return
      d.n++
      if (r.tier === 'free') d.free++
      if (r.escalated) d.esc++
    })
    return out
  }, [all])
  const maxDay = Math.max(1, ...days.map((d) => d.n))

  const exportCsv = async (): Promise<void> => {
    const head = ['الوقت', 'المحادثة', 'الطلب', 'الموديل', 'الفئة', 'المدة (ث)', 'محاولات', 'فشل', 'توكنز', 'تكلفة تقديرية $', 'أدوات']
    const lines = [head.map(csvCell).join(',')]
    list.forEach((r) =>
      lines.push([fmtTime(r.at), r.convTitle, r.prompt, r.model, TIER[r.tier], (r.totalMs / 1000).toFixed(1), r.tried.join(' > '), r.failures, r.tokens, r.cost.toFixed(5), r.tools.join(' ')].map(csvCell).join(','))
    )
    const res = await window.api.report.export(lines.join('\r\n'))
    setNote(res.ok ? 'انحفظ: ' + res.path : 'انلغى التصدير')
  }
  const saveBudget = (v: string): void => {
    const n = Math.max(0, Number(v) || 0)
    window.api.report.budget(n).then(setBudget).catch(() => undefined)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">تقرير المهام</h2>
            <p className="text-xs text-muted">{list.length} من {all.length} رد: مين نفّذ، قديش طوّل، وين فشل وصعّد.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCsv} disabled={!list.length} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1.5 text-xs hover:bg-surface2 disabled:opacity-40">
              <Download size={13} /> تصدير CSV
            </button>
            <button onClick={load} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1.5 text-xs hover:bg-surface2">
              <RefreshCw size={13} /> تحديث
            </button>
          </div>
        </div>
        {note && <div className="text-[11px] text-muted">{note}</div>}

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالطلب أو المحادثة أو الموديل…" className={sel + ' min-w-[220px] flex-1'} />
          <select value={proj} onChange={(e) => setProj(e.target.value)} className={sel}>
            <option value="all">كل المشاريع</option>
            <option value="none">بدون مشروع</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={sel} dir="ltr">
            <option value="all">كل الموديلات</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value as '7' | '30' | 'all')} className={sel}>
            <option value="all">كل الفترة</option>
            <option value="7">آخر 7 أيام</option>
            <option value="30">آخر 30 يوم</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'esc' | 'fail')} className={sel}>
            <option value="all">كل الحالات</option>
            <option value="esc">المصعّدة بس</option>
            <option value="fail">فيها فشل</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="مهام" value={list.length} />
          <Stat label="نفّذها موديل مجاني" value={free} tone="text-success" />
          <Stat label="صعّدت لموديل تاني" value={esc} tone={esc ? 'text-warning' : ''} />
          <Stat label="متوسط الوقت" value={fmtDur(avg)} />
          <Stat label="تكلفة تقديرية" value={totalCost > 0 ? fmtCost(totalCost) : '$0'} />
        </div>
        {withFail > 0 && <div className="text-[11px] text-warning">{withFail} مهمة فيها محاولات فاشلة قبل ما تنجح.</div>}

        <div className={'flex flex-wrap items-center gap-3 rounded-card border bg-surface p-3 text-xs shadow-card ' + (overBudget ? 'border-danger' : nearBudget ? 'border-warning' : 'border-outline')}>
          <span className="font-medium">ميزانية الشهر (تقديرية)</span>
          <span>
            الصرف هالشهر: <b>{fmtCost(monthCost) === '-' ? '$0' : fmtCost(monthCost)}</b>
          </span>
          <label className="flex items-center gap-1">
            الحد $
            <input type="number" min={0} step={1} defaultValue={budget || ''} key={budget} onBlur={(e) => saveBudget(e.target.value)} placeholder="0 = بدون حد" className={sel + ' w-24'} dir="ltr" />
          </label>
          {overBudget && <span className="text-danger">وصلت الحد!</span>}
          {!overBudget && nearBudget && <span className="text-warning">قربت من الحد (80%+)</span>}
          <span className="text-[11px] text-muted">محسوبة من التوكنز × سعر الموديل بالكتالوج؛ الاشتراك والمجاني = 0.</span>
        </div>

        <div className="rounded-card border border-outline bg-surface p-3 text-xs shadow-card">
          <div className="mb-2 flex items-center justify-between font-medium">
            <span>آخر 14 يوم (مهام يومية)</span>
            <span className="flex gap-3 text-[11px] font-normal text-muted">
              <span><span className="me-1 inline-block h-2 w-2 rounded-sm bg-success" />مجاني</span>
              <span><span className="me-1 inline-block h-2 w-2 rounded-sm bg-primary" />غيره</span>
              <span><span className="me-1 inline-block h-2 w-2 rounded-sm bg-warning" />تصعيد</span>
            </span>
          </div>
          <div className="flex h-24 items-end gap-1.5">
            {days.map((d) => (
              <div key={d.k} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.k}: ${d.n} مهمة، ${d.free} مجانية، ${d.esc} تصعيد`}>
                <div className="flex w-full flex-col justify-end" style={{ height: Math.round((d.n / maxDay) * 80) + 'px' }}>
                  <div className="w-full bg-primary" style={{ flex: d.n - d.free }} />
                  <div className="w-full bg-success" style={{ flex: d.free }} />
                </div>
                <div className={'h-1 w-full rounded-full ' + (d.esc ? 'bg-warning' : 'bg-transparent')} />
                <span className="text-[9px] text-muted">{d.k.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {top.length > 0 && (
            <div className="rounded-card border border-outline bg-surface p-3 text-xs shadow-card">
              <div className="mb-2 font-medium">أكتر الموديلات استعمالاً</div>
              <div className="space-y-1.5">
                {top.map(([m, n]) => (
                  <div key={m} className="flex items-center gap-2">
                    <span dir="ltr" className="w-40 truncate text-start">
                      {m}
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-surface2">
                      <div className="h-2 rounded-full bg-primary" style={{ width: Math.max(4, (n / top[0][1]) * 100) + '%' }} />
                    </div>
                    <span className="w-6 text-end text-muted">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-card border border-outline bg-surface p-3 text-xs shadow-card">
            <div className="mb-2 font-medium">أكتر موديلات فشلت قبل ما يتصعّد</div>
            {fails.length === 0 ? (
              <div className="text-muted">ما في فشل بهالفلتر</div>
            ) : (
              <div className="space-y-1.5">
                {fails.map(([m, v]) => (
                  <div key={m} className="flex items-center gap-2">
                    <span dir="ltr" className="w-40 truncate text-start">
                      {m}
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-surface2">
                      <div className="h-2 rounded-full bg-warning" style={{ width: Math.max(4, (v.fail / fails[0][1].fail) * 100) + '%' }} />
                    </div>
                    <span className="w-14 text-end text-muted">
                      {v.fail}/{v.seen}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-card border border-outline bg-surface shadow-card">
          <table className="w-full text-start text-xs">
            <thead className="bg-surface2 text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">الوقت</th>
                <th className="px-3 py-2 text-start font-medium">الطلب</th>
                <th className="px-3 py-2 text-start font-medium">الموديل</th>
                <th className="px-3 py-2 text-start font-medium">الفئة</th>
                <th className="px-3 py-2 text-start font-medium">المدة</th>
                <th className="px-3 py-2 text-start font-medium">التكلفة</th>
                <th className="px-3 py-2 text-start font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    عم يحمّل…
                  </td>
                </tr>
              )}
              {rows && !list.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    ما في مهام مطابقة.
                  </td>
                </tr>
              )}
              {list.map((r, i) => (
                <Fragment key={i}>
                  <tr onClick={() => setOpen(open === i ? null : i)} className="cursor-pointer border-t border-outline hover:bg-surface2">
                    <td className="whitespace-nowrap px-3 py-2">{fmtTime(r.at)}</td>
                    <td className="max-w-[260px] truncate px-3 py-2" title={r.prompt}>
                      {r.prompt || r.convTitle}
                    </td>
                    <td dir="ltr" className="max-w-[200px] truncate px-3 py-2 text-start">
                      {r.model}
                    </td>
                    <td className="px-3 py-2">{TIER[r.tier]}</td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDur(r.totalMs)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtCost(r.cost)}</td>
                    <td className="px-3 py-2">
                      {r.escalated ? <span className="text-warning">صعّد ({r.tried.length} محاولات)</span> : r.failures > 0 ? <span className="text-warning">{r.failures} فشل</span> : <span className="text-success">نجح</span>}
                    </td>
                  </tr>
                  {open === i && (
                    <tr className="border-t border-outline bg-bg">
                      <td colSpan={7} className="space-y-1 px-3 py-2 text-[11px] text-muted">
                        <div className="flex items-center gap-2">
                          <span>المحادثة: {r.convTitle}</span>
                          {onOpenConv && (
                            <button onClick={() => onOpenConv(r.convId)} className="flex items-center gap-1 rounded-full border border-outline px-2 py-0.5 text-primary hover:bg-surface2">
                              <ExternalLink size={11} /> افتح المحادثة
                            </button>
                          )}
                        </div>
                        {r.tried.length > 0 && (
                          <div dir="ltr" className="text-start">
                            المحاولات: {r.tried.join(' → ')}
                          </div>
                        )}
                        <div>الأدوات: {r.tools.length ? r.tools.join('، ') : '-'}</div>
                        <div>التوكنز: {r.tokens || '-'}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
