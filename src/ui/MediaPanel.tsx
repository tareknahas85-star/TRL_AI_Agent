import { useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, Loader2, Play, Sparkles } from 'lucide-react'
import { Modal, inputCls, primaryBtn } from './components/ui'
import type { MediaKind, ModelStatus } from '../core/media-registry'

const TITLE: Record<MediaKind, string> = { image: 'توليد صورة', video: 'توليد فيديو', audio: 'توليد صوت' }
const HINT: Record<MediaKind, string> = {
  image: 'وصف الصورة (بالعربي أو الإنجليزي، الإنجليزي غالباً أدق)…',
  video: 'وصف الفيديو القصير…',
  audio: 'النص اللي بدك ياه يتحوّل لصوت…'
}

function Badge({ m }: { m: ModelStatus }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ background: m.color }}
    >
      {m.label.replace(/[^A-Za-z؀-ۿ]/g, '').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function MediaPanel({ kind, onClose }: { kind: MediaKind; onClose: () => void }) {
  const [models, setModels] = useState<ModelStatus[]>([])
  const [sel, setSel] = useState('auto')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; path?: string; model?: string; note: string } | null>(null)
  const [img, setImg] = useState('')

  const load = (): void => void window.api.media.models(kind).then(setModels)
  useEffect(load, [kind])

  async function go(): Promise<void> {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setRes(null)
    setImg('')
    try {
      const r = await window.api.media.generate(kind, sel, prompt)
      setRes(r)
      if (r.ok && r.path && kind === 'image') setImg(await window.api.media.preview(r.path))
    } catch (e) {
      setRes({ ok: false, note: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
      load()
    }
  }

  const chosen = models.find((m) => m.id === sel)
  const isSite = chosen?.route === 'site'

  return (
    <Modal title={TITLE[kind]} onClose={onClose}>
      <div className="space-y-2">
        <button
          onClick={() => setSel('auto')}
          className={'flex w-full items-center gap-3 rounded-xl border p-3 text-start ' + (sel === 'auto' ? 'border-primary bg-surface2' : 'border-outline hover:bg-surface2')}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
            <Sparkles size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">تلقائي</span>
            <span className="block text-[11px] text-muted">بيجرّب الأقوى المتاح أول، وإذا فشل بينزل للتاني</span>
          </span>
        </button>
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => setSel(m.id)}
            disabled={!m.available}
            className={
              'flex w-full items-center gap-3 rounded-xl border p-3 text-start disabled:opacity-50 ' +
              (sel === m.id ? 'border-primary bg-surface2' : 'border-outline hover:bg-surface2')
            }
          >
            <Badge m={m} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {m.label}
                {m.route === 'site' && <span className="ms-2 text-[10px] text-muted">(بيتفتح بالمتصفح)</span>}
              </span>
              <span className="block text-[11px] text-muted">{m.best}</span>
              <span className="block text-[11px] text-muted">
                الحد: {m.limitText}
                {m.usedToday > 0 && ' · استخدمت اليوم: ' + m.usedToday}
              </span>
              {!m.available && <span className="block text-[11px] text-warning">{m.reason}</span>}
            </span>
          </button>
        ))}
      </div>

      {isSite ? (
        <button onClick={() => void window.api.media.site(sel)} className={primaryBtn + ' mt-4 flex items-center gap-2'}>
          <ExternalLink size={15} /> افتح الموقع
        </button>
      ) : (
        <>
          <textarea dir="auto" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={HINT[kind]} className={inputCls + ' mt-4 resize-none'} />
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => void go()} disabled={busy || !prompt.trim()} className={primaryBtn + ' flex items-center gap-2'}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? 'عم يولّد…' : 'ولّد'}
            </button>
            {busy && kind !== 'audio' && <span className="text-[11px] text-muted">{kind === 'video' ? 'الفيديو ممكن ياخد لحد 8 دقايق' : 'ممكن ياخد حتى دقيقة'}</span>}
          </div>
        </>
      )}

      {res && (
        <div className={'mt-4 rounded-xl border p-3 text-sm ' + (res.ok ? 'border-outline' : 'border-danger')}>
          <p className={res.ok ? '' : 'text-danger'}>{res.note}</p>
          {img && <img src={img} alt="النتيجة" className="mt-3 max-h-80 w-full rounded-lg object-contain" />}
          {res.ok && res.path && (
            <div className="mt-3 flex gap-2">
              <button onClick={() => void window.api.media.open(res.path as string)} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1.5 text-xs hover:bg-surface2">
                <Play size={13} /> افتح
              </button>
              <button onClick={() => void window.api.media.open(res.path as string, true)} className="flex items-center gap-1 rounded-full border border-outline px-3 py-1.5 text-xs hover:bg-surface2">
                <FolderOpen size={13} /> بالمجلد
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
