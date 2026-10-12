import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search, Sparkles, SquarePen } from 'lucide-react'

type Item = { id: string; label: string; hint: string; icon: 'page' | 'chat' | 'action'; run: () => void }

export function CommandPalette({
  pages,
  convs,
  onPage,
  onOpenConv,
  onNewChat
}: {
  pages: { id: string; label: string }[]
  convs: { id: string; title: string }[]
  onPage: (id: string) => void
  onOpenConv: (id: string) => void
  onNewChat: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    window.setTimeout(() => input.current?.focus(), 0)
  }, [open])

  const items = useMemo<Item[]>(() => {
    const done = (f: () => void) => () => {
      setOpen(false)
      f()
    }
    return [
      { id: 'new', label: 'محادثة جديدة', hint: 'إجراء', icon: 'action', run: done(onNewChat) },
      { id: 'whatsnew', label: 'شو الجديد بهالنسخة', hint: 'إجراء', icon: 'action', run: done(() => window.dispatchEvent(new Event('air:whatsnew'))) },
      ...pages.map((p) => ({ id: 'p-' + p.id, label: p.label, hint: 'صفحة', icon: 'page' as const, run: done(() => onPage(p.id)) })),
      ...convs.map((c) => ({ id: 'c-' + c.id, label: c.title, hint: 'محادثة', icon: 'chat' as const, run: done(() => onOpenConv(c.id)) }))
    ]
  }, [pages, convs, onPage, onOpenConv, onNewChat])

  const needle = q.trim().toLowerCase()
  const shown = (needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items).slice(0, 30)
  useEffect(() => setSel(0), [needle])

  if (!open) return null
  const Icon = { page: Sparkles, chat: MessageSquare, action: SquarePen }
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh]" dir="rtl" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-card bg-surface text-fg shadow-card ring-1 ring-outline" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-outline px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, shown.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter') shown[sel]?.run()
            }}
            placeholder="دوّر على محادثة أو صفحة أو إجراء…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            dir="auto"
          />
          <kbd className="shrink-0 rounded border border-outline px-1.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {shown.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">ما لقيت شي.</div>}
          {shown.map((it, i) => {
            const I = Icon[it.icon]
            return (
              <button
                key={it.id}
                onMouseEnter={() => setSel(i)}
                onClick={it.run}
                className={`flex w-full items-center gap-3 px-4 py-2 text-start text-sm ${i === sel ? 'bg-primary/10' : ''}`}
              >
                <I size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {it.label}
                </span>
                <span className="shrink-0 text-[10px] text-muted">{it.hint}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}