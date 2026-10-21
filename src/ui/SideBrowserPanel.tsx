// F28: side browser panel UI. The page itself is a native view drawn by the main process, below this toolbar.
// This component draws the toolbar (address bar + actions) and the drag handle, and reports width changes.
import { useEffect, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { ArrowRight, RotateCw, Trash2, X } from 'lucide-react'
import { askConfirm } from './components/confirm'
import { clampSideWidth } from '../core/side-url'

type SideState = { open: boolean; url: string | null; width: number; canGoBack: boolean }

type Props = {
  width: number
  onWidthChange: (w: number) => void
  onClose: () => void
}

export function SideBrowserPanel({ width, onWidthChange, onClose }: Props): ReactElement {
  const [address, setAddress] = useState('')
  const [page, setPage] = useState<SideState>({ open: false, url: null, width, canGoBack: false })
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // The main process pushes a state update on every navigation, so the toolbar never goes stale.
  useEffect(() => {
    void window.api.side.state().then((s) => {
      setPage(s)
      if (s.url) setAddress(s.url)
    })
    return window.api.side.onChanged((s) => {
      setPage(s)
      if (s.url) setAddress(s.url)
    })
  }, [])

  // The page is a native view, so DOM can't draw over it. While any popup, dialog, or approval is open,
  // the main process hides the page (kept loaded) so the popup is visible. Anything marked
  // data-side-overlay or aria-modal counts as a popup.
  useEffect(() => {
    let frame = 0
    let hidden = false
    const check = (): void => {
      frame = 0
      const open = document.querySelector('[data-side-overlay],[aria-modal="true"]') !== null
      if (open !== hidden) {
        hidden = open
        void window.api.side.setOverlay(open)
      }
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'data-side-overlay'] })
    check()
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      if (hidden) void window.api.side.setOverlay(false)
    }
  }, [])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const value = address.trim()
    if (!value) return
    const res = page.open ? await window.api.side.navigate(value) : await window.api.side.open(value)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setPage(await window.api.side.state())
  }

  const clearData = async (): Promise<void> => {
    const ok = await askConfirm('تمسح بيانات المتصفح الجانبي؟ بتنمسح الكوكيز وتسجيلات الدخول.', { danger: true })
    if (ok) await window.api.side.clearData()
  }

  // The panel sits at the left edge, so the width equals the pointer's x position.
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    const next = clampSideWidth(e.clientX)
    onWidthChange(next)
    void window.api.side.setWidth(next)
  }
  const onHandleUp = (): void => setDragging(false)

  return (
    <>
      <div className="fixed left-0 top-0 z-30 flex h-full flex-col border-e border-outline bg-surface" style={{ width }} dir="rtl">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-outline px-2">
          <button onClick={() => void window.api.side.back().then(setPage)} disabled={!page.canGoBack} aria-label="رجوع" title="رجوع" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-surface2 disabled:opacity-40">
            <ArrowRight size={16} />
          </button>
          <button onClick={() => void window.api.side.reload()} disabled={!page.open} aria-label="تحديث" title="تحديث" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-surface2 disabled:opacity-40">
            <RotateCw size={15} />
          </button>
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
            <input
              dir="ltr"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                setError(null)
              }}
              placeholder="اكتب رابط…"
              aria-label="الرابط"
              aria-invalid={error ? true : undefined}
              className={`h-8 min-w-0 flex-1 rounded-full border bg-bg px-3 text-xs outline-none focus:border-primary ${error ? 'border-danger' : 'border-outline'}`}
            />
            {/* Errors live inside the toolbar: the native page view covers everything below it. */}
            {error && <span role="alert" className="max-w-[140px] shrink truncate text-xs text-danger">{error}</span>}
          </form>

          <button onClick={() => void clearData()} aria-label="امسح بيانات المتصفح" title="امسح بيانات المتصفح" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface2 hover:text-danger">
            <Trash2 size={15} />
          </button>
          <button onClick={onClose} aria-label="سكّر المتصفح الجانبي" title="سكّر المتصفح الجانبي" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-surface2">
            <X size={15} />
          </button>
        </div>

        {!page.open && (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted">
            <p>اكتب رابط فوق واضغط Enter، والصفحة بتنفتح هون.</p>
          </div>
        )}
      </div>

      {/* Drag handle on the panel's right edge. It sits just outside the native view, so it stays clickable. */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        role="separator"
        aria-orientation="vertical"
        aria-label="اسحب لتغيير عرض المتصفح"
        className={`fixed top-0 z-40 h-full w-2 cursor-col-resize hover:bg-primary/30 ${dragging ? 'bg-primary/40' : ''}`}
        style={{ left: width }}
      />
    </>
  )
}
