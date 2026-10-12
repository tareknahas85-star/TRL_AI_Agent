import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Chip, cardCls, ghostBtn } from './components/ui'

type Row = { model: string; n: number }
type Res = { replies: number; convs: number; tiers: Record<string, number>; top: Row[] }

const modelOf = (meta: string): string => (meta.match(/^Model: (.+?)(?: \[| · | \| |$)/)?.[1] ?? '').trim()
const tierOf = (meta: string): string => (meta.includes('اشتراكك') ? 'اشتراكك' : meta.includes('مجاني') ? 'مجاني' : meta.includes('رخيص') ? 'رخيص' : 'قوي')

export function UsagePanel() {
  const [res, setRes] = useState<Res | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const list = (await window.api.conversations.list()).slice(0, 300)
      const counts = new Map<string, number>()
      const tiers: Record<string, number> = {}
      let replies = 0
      for (const c of list) {
        const full = await window.api.conversations.get(c.id)
        for (const m of full?.messages ?? []) {
          if (m.role !== 'assistant' || !m.meta) continue
          replies++
          const mo = modelOf(m.meta)
          if (mo) counts.set(mo, (counts.get(mo) ?? 0) + 1)
          const t = tierOf(m.meta)
          tiers[t] = (tiers[t] ?? 0) + 1
        }
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([model, n]) => ({ model, n }))
      setRes({ replies, convs: list.length, tiers, top })
    } finally {
      setBusy(false)
    }
  }
  const max = Math.max(1, ...(res?.top.map((r) => r.n) ?? [1]))
  return (
    <div className={cardCls + ' mb-4'} dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <BarChart3 size={18} className="text-primary" /> استهلاكك
        </div>
        <button className={ghostBtn + ' border border-outline'} onClick={() => void run()} disabled={busy}>
          {busy ? 'عم يحلّل…' : res ? 'حدّث' : 'حلّل استهلاكي'}
        </button>
      </div>
      {!res && <p className="mt-2 text-xs text-muted">بيقرا محادثاتك المحفوظة على جهازك بس، وبيوريك أي موديلات استعملت أكتر وكم رد كان مجاني.</p>}
      {res && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Chip>{res.replies} رد</Chip>
            <Chip>{res.convs} محادثة</Chip>
            {Object.entries(res.tiers).map(([t, n]) => (
              <Chip key={t} cls={t === 'مجاني' ? 'bg-success/15 text-success' : t === 'قوي' ? 'bg-warning/20 text-warning' : 'bg-primary/15 text-primary'}>
                {t}: {n}
              </Chip>
            ))}
          </div>
          <div className="space-y-1.5">
            {res.top.map((r) => (
              <div key={r.model} className="flex items-center gap-2 text-xs">
                <span dir="ltr" className="w-44 shrink-0 truncate text-start">{r.model}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((r.n / max) * 100)}%` }} />
                </span>
                <span className="w-8 shrink-0 text-muted">{r.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}