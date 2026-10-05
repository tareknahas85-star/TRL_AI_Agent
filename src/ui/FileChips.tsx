import { useEffect, useMemo, useState } from 'react'
import { Eye, ExternalLink, FileText, FolderOpen, X } from 'lucide-react'
import type { FilePreviewInfo } from '../preload/index.d'

// Finds absolute Windows paths with a file extension inside an assistant reply and offers preview / open / reveal.
const QUOTED = /[`"'«]([A-Za-z]:\\[^`"'»\r\n<>|*?]+?\.[A-Za-z0-9]{1,5})[`"'»]/g
const BARE = /(?:^|[\s(])([A-Za-z]:\\[^\s`"'<>|*?()]+?\.[A-Za-z0-9]{1,5})(?=$|[\s`"')،,.؛:])/g

export function extractPaths(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(QUOTED)) out.add(m[1].trim())
  for (const m of text.matchAll(BARE)) out.add(m[1].trim())
  return [...out].slice(0, 6)
}

const base = (p: string): string => p.split('\\').pop() ?? p

export function FileChips({ text }: { text: string }) {
  const cands = useMemo(() => extractPaths(text), [text])
  const [paths, setPaths] = useState<string[]>([])
  const [view, setView] = useState<{ path: string; data: FilePreviewInfo | null } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    if (!cands.length) {
      setPaths([])
      return
    }
    window.api.files
      .exists(cands)
      .then((ex) => live && setPaths(cands.filter((_, i) => ex[i])))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [cands])

  if (!paths.length) return null

  const openPreview = async (p: string): Promise<void> => {
    setView({ path: p, data: null })
    try {
      setView({ path: p, data: await window.api.files.preview(p) })
    } catch {
      setView({ path: p, data: { ok: false, note: 'فشلت المعاينة' } })
    }
  }
  const openFile = async (p: string): Promise<void> => {
    const r = await window.api.files.open(p)
    setErr(r.ok ? '' : (r.error ?? 'ما انفتح'))
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {paths.map((p) => (
          <div key={p} className="flex items-center gap-1 rounded-full border border-outline bg-surface2 py-1 ps-3 pe-1 text-[11px]">
            <FileText size={12} />
            <span dir="ltr" className="max-w-[220px] truncate" title={p}>
              {base(p)}
            </span>
            <button onClick={() => void openPreview(p)} title="معاينة" aria-label="معاينة" className="rounded-full p-1.5 hover:bg-outline">
              <Eye size={13} />
            </button>
            <button onClick={() => void openFile(p)} title="فتح بالبرنامج الافتراضي" aria-label="فتح" className="rounded-full p-1.5 hover:bg-outline">
              <ExternalLink size={13} />
            </button>
            <button onClick={() => void window.api.files.reveal(p)} title="أظهرو بالمجلد" aria-label="أظهرو بالمجلد" className="rounded-full p-1.5 hover:bg-outline">
              <FolderOpen size={13} />
            </button>
          </div>
        ))}
      </div>
      {err && <div className="mt-1 text-[11px] text-warning">{err}</div>}
      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setView(null)}>
          <div className="flex max-h-full w-full max-w-3xl flex-col rounded-card border border-outline bg-surface shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 border-b border-outline px-4 py-2 text-sm">
              <span dir="ltr" className="truncate font-medium">
                {base(view.path)}
              </span>
              <button onClick={() => setView(null)} aria-label="سكّر" className="rounded-full p-1 hover:bg-surface2">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
              {!view.data && <div className="text-muted">عم يحمّل…</div>}
              {view.data && !view.data.ok && <div className="text-warning">{view.data.note}</div>}
              {view.data?.ok && view.data.kind === 'image' && view.data.dataUrl && <img src={view.data.dataUrl} alt={base(view.path)} className="mx-auto max-h-[70vh] max-w-full" />}
              {view.data?.ok && view.data.kind === 'video' && view.data.dataUrl && <video src={view.data.dataUrl} controls className="mx-auto max-h-[70vh] max-w-full" />}
              {view.data?.ok && view.data.kind === 'audio' && view.data.dataUrl && <audio src={view.data.dataUrl} controls className="w-full" />}
              {view.data?.ok && view.data.text && (
                <pre dir="auto" className="whitespace-pre-wrap break-words font-mono text-xs">
                  {view.data.text}
                </pre>
              )}
              {view.data?.ok && !view.data.text && !view.data.dataUrl && <div className="text-muted">{view.data.note ?? 'ما في معاينة لهالنوع، افتحو بالزر.'}</div>}
              {view.data?.ok && view.data.note && (view.data.text || view.data.dataUrl) && <div className="mt-2 text-[11px] text-muted">{view.data.note}</div>}
            </div>
            <div className="flex gap-2 border-t border-outline px-4 py-2 text-xs">
              <button onClick={() => void openFile(view.path)} className="rounded-full border border-outline px-3 py-1 hover:bg-surface2">
                فتح
              </button>
              <button onClick={() => void window.api.files.reveal(view.path)} className="rounded-full border border-outline px-3 py-1 hover:bg-surface2">
                أظهرو بالمجلد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
