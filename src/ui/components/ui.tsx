import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 text-fg shadow-card ring-1 ring-outline"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="سكّر" className="rounded-full p-1.5 hover:bg-surface2">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted/40'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'start-[22px]' : 'start-0.5'}`}
      />
    </button>
  )
}

export const inputCls =
  'w-full rounded-xl border border-outline bg-surface2 p-3 text-sm outline-none placeholder:text-muted focus:border-primary focus:shadow-glow'
export const primaryBtn =
  'whitespace-nowrap rounded-full bg-primary px-5 py-2 text-sm font-medium text-white shadow-card hover:opacity-90 disabled:opacity-40'
export const ghostBtn = 'rounded-full px-3 py-2 text-sm hover:bg-surface2 disabled:opacity-40'
export const cardCls = 'rounded-card border border-outline bg-surface p-4 shadow-card'

export function PageShell({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-card border border-dashed border-outline py-16 text-center text-sm text-muted">{text}</div>
  )
}

export const TIER_LABEL: Record<string, { label: string; cls: string }> = {
  TIER_1_FREE: { label: 'مجاني', cls: 'bg-success/15 text-success' },
  TIER_2_CHEAP: { label: 'رخيص', cls: 'bg-primary/15 text-primary' },
  TIER_3_EXPENSIVE: { label: 'قوي', cls: 'bg-warning/20 text-warning' }
}

export function Chip({ children, cls = 'bg-surface2 text-muted' }: { children: ReactNode; cls?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${cls}`}>{children}</span>
}
