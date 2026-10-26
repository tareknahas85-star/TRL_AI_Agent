import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronUp, Search } from 'lucide-react'
import type { ChatMode } from '../preload/index.d'
import { nameColor } from './brandColor'

type Entry = { value: string; label: string; tier: string }

const TIERS: { id: string; title: string; badge: string; cls: string }[] = [
  { id: 'LOCAL', title: 'محلي', badge: 'محلي', cls: 'bg-success/15 text-success' },
  { id: 'TIER_1_FREE', title: 'مجاني', badge: 'مجاني', cls: 'bg-success/15 text-success' },
  { id: 'SUBSCRIPTION', title: 'اشتراكك', badge: 'اشتراك', cls: 'bg-primary/15 text-primary' },
  { id: 'PAID', title: 'مدفوع', badge: 'مدفوع', cls: 'bg-warning/20 text-warning' }
]
const tierOf = (t: string): string => (t === 'TIER_1_FREE' || t === 'SUBSCRIPTION' || t === 'LOCAL' ? t : 'PAID')

// أوضاع المجلس (تلقائي / أنا أختار الكاتب والناقد) تظهر بالقائمة بس وانت بوضع المجلس. بوضع المحادثة العادية القائمة فيها موديلات بس.
const AUTO: { id: string; label: string; hint: string }[] = [
  { id: 'council', label: '🏛️ مجلس — تلقائي', hint: 'النظام بيختار الكاتب والناقد' },
  { id: 'council-manual', label: '🏛️ مجلس — أنا بختار الكاتب والناقد', hint: 'بتحدد الكاتب والناقد بإيدك' }
]
const MODE_NAME: Record<string, string> = { free: 'محادثة عادية', auto: 'بناء مشروع', council: 'المجلس' }

function currentId(mode: ChatMode): string {
  if (mode.kind === 'model') return mode.id
  if (mode.kind === 'council' && (mode.author || mode.critic)) return 'council-manual'
  return mode.kind
}

export function ModelPicker({ mode, picker, onModeChange }: { mode: ChatMode; picker: Entry[]; onModeChange: (m: ChatMode) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    window.setTimeout(() => input.current?.focus(), 0)
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const needle = q.trim().toLowerCase()
  const match = (s: string): boolean => !needle || s.toLowerCase().includes(needle)
  const autos = (mode.kind === 'council' ? AUTO : []).filter((a) => match(a.label) && (a.id !== 'council-manual' || picker.length > 0))
  const groups = useMemo(
    () => TIERS.map((t) => ({ ...t, items: picker.filter((p) => tierOf(p.tier) === t.id && (match(p.label) || match(p.value))) })).filter((g) => g.items.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picker, needle]
  )

  const select = (id: string): void => {
    if (id === 'council-manual') onModeChange({ kind: 'council', author: picker[0]?.value, critic: (picker[1] ?? picker[0])?.value })
    else if (id === 'free') onModeChange({ kind: 'free' })
    else if (id === 'auto') onModeChange({ kind: 'auto' })
    else if (id === 'council') onModeChange({ kind: 'council' })
    else onModeChange({ kind: 'model', id })
    setOpen(false)
  }
  const first = autos[0]?.id ?? groups[0]?.items[0]?.value

  const cur = currentId(mode)
  const curEntry = picker.find((p) => p.value === cur)
  const curAuto = AUTO.find((a) => a.id === cur)
  const curTier = curEntry ? TIERS.find((t) => t.id === tierOf(curEntry.tier)) : undefined
  const paid = mode.kind !== 'free'

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[22rem] items-center gap-2 rounded-full border border-outline bg-surface px-3 py-0.5 text-fg hover:bg-surface2"
      >
        <span className="truncate" style={{ color: curEntry ? nameColor(curEntry.value + ' ' + curEntry.label) : undefined }}>{curAuto ? curAuto.label : curEntry ? curEntry.label : (MODE_NAME[cur] ?? cur)}</span>
        {curTier && <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${curTier.cls}`}>{curTier.badge}</span>}
        {!curTier && paid && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
        <ChevronUp size={12} className={`shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full start-0 z-50 mb-1 w-[22rem] max-w-[90vw] overflow-hidden rounded-card border border-outline bg-surface text-[12px] text-fg shadow-card"
        >
          <div className="flex items-center gap-2 border-b border-outline px-3 py-2">
            <Search size={14} className="shrink-0 text-muted" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && first) select(first)
              }}
              placeholder="ابحث أو اكتب اسم موديل…"
              className="w-full bg-transparent outline-none placeholder:text-muted"
              dir="auto"
            />
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {autos.map((a) => (
              <button
                key={a.id}
                role="option"
                aria-selected={cur === a.id}
                onClick={() => select(a.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-surface2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.label}</span>
                  <span className="block truncate text-[10px] text-muted">{a.hint}</span>
                </span>
                {cur === a.id && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            ))}
            {groups.map((g) => (
              <div key={g.id}>
                <div className="sticky top-0 bg-surface px-3 pb-0.5 pt-2 text-[10px] font-medium text-muted">
                  🎯 {g.title} ({g.items.length})
                </div>
                {g.items.map((p) => (
                  <button
                    key={p.value}
                    role="option"
                    aria-selected={cur === p.value}
                    onClick={() => select(p.value)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-surface2"
                  >
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-start" style={{ color: nameColor(p.value + ' ' + p.label) }}>
                      {p.label}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${g.cls}`}>{g.badge}</span>
                    {cur === p.value && <Check size={14} className="shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            ))}
            {!autos.length && !groups.length && <div className="px-3 py-6 text-center text-muted">ما لقيت موديل بهالاسم.</div>}
          </div>
        </div>
      )}
    </div>
  )
}