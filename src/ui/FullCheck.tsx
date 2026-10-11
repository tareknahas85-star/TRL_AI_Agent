import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ListChecks, Loader2, MinusCircle, Square, XCircle } from 'lucide-react'
import type { CheckItemInfo } from '../preload/index.d'
import { ghostBtn } from './components/ui'

type Kind = 'mcp' | 'tools' | 'connectors' | 'models'
type Done = { ok: number; fail: number; skipped: number; cancelled: boolean }
export type FullCheck = { kind: Kind; items: Record<string, CheckItemInfo>; running: boolean; done: Done | null; touched: boolean; start: () => Promise<void>; cancel: () => void }

// One "full check" per tab: runs only when the button is pressed (never at startup), shows each result next to its item as it arrives.
export function useFullCheck(kind: Kind): FullCheck {
  const [items, setItems] = useState<Record<string, CheckItemInfo>>({})
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [touched, setTouched] = useState(false)
  const busy = useRef(false)
  useEffect(
    () =>
      window.api.check.onItem((k, item) => {
        if (k === kind) setItems((p) => ({ ...p, [item.id]: item }))
      }),
    [kind]
  )
  const start = useCallback(async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setRunning(true)
    setTouched(true)
    setItems({})
    setDone(null)
    try {
      const r = await window.api.check.run(kind)
      if (r) {
        setItems(Object.fromEntries(r.items.map((i) => [i.id, i])))
        setDone({ ok: r.ok, fail: r.fail, skipped: r.skipped, cancelled: r.cancelled })
      }
    } finally {
      busy.current = false
      setRunning(false)
    }
  }, [kind])
  const cancel = useCallback((): void => {
    void window.api.check.cancel(kind)
  }, [kind])
  return { kind, items, running, done, touched, start, cancel }
}

export function CheckButton({ c, label = 'فحص كامل' }: { c: FullCheck; label?: string }) {
  return c.running ? (
    <button className={ghostBtn + ' flex items-center gap-1 border border-outline'} onClick={c.cancel}>
      <Square size={14} /> إلغاء الفحص
    </button>
  ) : (
    <button className={ghostBtn + ' flex items-center gap-1 border border-outline'} onClick={() => void c.start()}>
      <ListChecks size={16} /> {label}
    </button>
  )
}

const ICON = {
  ok: <CheckCircle2 size={14} className="shrink-0 text-success" />,
  fail: <XCircle size={14} className="shrink-0 text-danger" />,
  skip: <MinusCircle size={14} className="shrink-0 text-muted" />
}

export function CheckBadge({ item }: { item?: CheckItemInfo }) {
  if (!item) return null
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${item.state === 'ok' ? 'text-success' : item.state === 'fail' ? 'text-danger' : 'text-muted'}`} title={item.message}>
      {ICON[item.state]}
      {item.message.slice(0, 40)}
    </span>
  )
}

// Summary line ("12 تمام، 2 بدها مراجعة") + the list of results.
export function CheckPanel({ c }: { c: FullCheck }) {
  if (!c.touched) return null
  const list = Object.values(c.items)
  const ok = list.filter((i) => i.state === 'ok').length
  const fail = list.filter((i) => i.state === 'fail').length
  const skip = list.filter((i) => i.state === 'skip').length
  const order = { fail: 0, ok: 1, skip: 2 } as const
  const sorted = [...list].sort((a, b) => order[a.state] - order[b.state] || a.label.localeCompare(b.label))
  return (
    <div className="mb-4 rounded-card border border-outline p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        {c.running ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />}
        {c.running ? 'عم يفحص…' : c.done?.cancelled ? 'انلغى الفحص' : 'انتهى الفحص'}
        <span className="text-muted">
          — {ok} تمام{fail ? `، ${fail} بدها مراجعة` : ''}
          {skip ? `، ${skip} ما انفحصت (مطفية/مو مفعّلة)` : ''}
        </span>
      </div>
      {sorted.length > 0 && (
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {sorted.map((i) => (
            <li key={i.id} className="flex items-start gap-1.5 text-xs">
              {ICON[i.state]}
              <span className="font-medium">{i.label}</span>
              <span className="min-w-0 truncate text-muted" title={i.message}>
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
