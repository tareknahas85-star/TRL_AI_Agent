import { useEffect, useState } from 'react'
import { FolderOpen, Play, RotateCcw } from 'lucide-react'
import type { MediaRef } from '../core/media-msg'

// A generated image / audio / video shown inside the chat (the message text only carries a small marker).
export function MediaCard({ mediaRef, text, onRetry }: { mediaRef: MediaRef; text: string; onRetry: (r: MediaRef) => void }) {
  const [src, setSrc] = useState('')
  const [gone, setGone] = useState(false)

  useEffect(() => {
    let live = true
    if (mediaRef.k === 'video') return
    void window.api.media.preview(mediaRef.p).then((d) => {
      if (!live) return
      if (d) setSrc(d)
      else setGone(true)
    })
    return () => {
      live = false
    }
  }, [mediaRef.p, mediaRef.k])

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: mediaRef.c ?? '#888' }} />
        <span>{text || 'ناتج توليد'}</span>
      </div>
      {mediaRef.k === 'image' && src && <img src={src} alt={mediaRef.q} className="max-h-96 w-full rounded-lg object-contain" />}
      {mediaRef.k === 'audio' && src && <audio controls src={src} className="w-full" />}
      {gone && <p className="text-xs text-warning">الملف انحذف أو انتقل من مكانو.</p>}
      <p dir="auto" className="mt-2 text-xs text-muted">
        الوصف: {mediaRef.q}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => void window.api.media.open(mediaRef.p)} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1 text-[11px] hover:bg-surface2">
          <Play size={12} /> افتح
        </button>
        <button onClick={() => void window.api.media.open(mediaRef.p, true)} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1 text-[11px] hover:bg-surface2">
          <FolderOpen size={12} /> بالمجلد
        </button>
        <button onClick={() => onRetry(mediaRef)} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1 text-[11px] text-muted hover:bg-surface2">
          <RotateCcw size={12} /> جرّب غيرو
        </button>
      </div>
    </div>
  )
}
