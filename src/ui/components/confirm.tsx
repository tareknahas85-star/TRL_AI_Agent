import { useEffect, useState } from 'react'

type Pending = { message: string; danger: boolean; resolve: (ok: boolean) => void }
let push: ((p: Pending) => void) | null = null

/** بديل window.confirm: نافذة داخلية بنفس ستايل البرنامج. بترجّع true إذا وافق. */
export function askConfirm(message: string, opts?: { danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.confirm(message))
    push({ message, danger: opts?.danger ?? /تحذف|فصل|تمسح|شيل/.test(message), resolve })
  })
}

export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([])
  useEffect(() => {
    push = (p) => setQueue((q) => [...q, p])
    return () => {
      push = null
    }
  }, [])
  const cur = queue[0]
  const close = (ok: boolean): void => {
    cur?.resolve(ok)
    setQueue((q) => q.slice(1))
  }
  useEffect(() => {
    if (!cur) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  if (!cur) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={() => close(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-card bg-surface p-5 text-fg shadow-card ring-1 ring-outline"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{cur.message}</p>
        <div className="mt-5 flex items-center justify-start gap-2">
          <button
            autoFocus
            onClick={() => close(true)}
            className={`rounded-full px-5 py-2 text-sm font-medium text-white shadow-card hover:opacity-90 ${cur.danger ? 'bg-danger' : 'bg-primary'}`}
          >
            تمام
          </button>
          <button onClick={() => close(false)} className="rounded-full px-4 py-2 text-sm hover:bg-surface2">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}