import { useEffect, useState } from 'react'

type Prompt = { latest?: string; current: string; url?: string }
type Progress = { stage: string; percent?: number; message?: string }

// Asks "update now or later" when a newer version exists. Nothing installs without the "now" click.
export function UpdatePrompt() {
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const offPrompt = window.api.update.onPrompt((p) => {
      setErr(null)
      setProgress(null)
      setPrompt(p)
    })
    const offProgress = window.api.update.onProgress((p) => {
      setProgress(p)
      if (p.stage === 'error') setErr(p.message ?? 'صار خطأ أثناء التحديث')
      if (p.stage === 'none') setErr('ما لقينا تحديث جديد هلأ')
    })
    return () => {
      offPrompt()
      offProgress()
    }
  }, [])

  if (!prompt) return null

  const busy = progress !== null && progress.stage !== 'error' && progress.stage !== 'none'
  const later = async (): Promise<void> => {
    await window.api.update.later()
    setPrompt(null)
    setProgress(null)
  }
  const now = async (): Promise<void> => {
    setErr(null)
    const r = await window.api.update.now()
    if (!r.ok) setErr(r.note ?? 'ما قدرنا نبدأ التحديث')
  }

  const label =
    progress?.stage === 'checking'
      ? 'عم يفحص…'
      : progress?.stage === 'downloading'
        ? `عم ينزّل التحديث… ${progress.percent ?? 0}%`
        : progress?.stage === 'installing'
          ? 'عم يركّب، البرنامج رح يعيد التشغيل…'
          : null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" data-side-overlay>
      <div role="dialog" aria-modal="true" dir="rtl" className="w-full max-w-md rounded-card bg-surface p-6 text-fg shadow-card ring-1 ring-outline">
        <h3 className="text-base font-semibold">في تحديث جديد</h3>
        <p className="mt-2 text-sm leading-relaxed">
          الإصدار <span dir="ltr">{prompt.latest}</span> متوفر (إنت على <span dir="ltr">{prompt.current}</span>). تبي تحدّث هلأ؟
        </p>
        <p className="mt-1 text-xs text-muted">إذا قلت "هلأ"، بينزّل التحديث وبيعيد تشغيل البرنامج. إذا قلت "بعدين"، بيسألك مرة تانية بعد 24 ساعة.</p>

        {label && <p className="mt-3 text-sm text-primary">{label}</p>}
        {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}

        <div className="mt-5 flex items-center justify-start gap-2">
          <button onClick={() => void now()} disabled={busy} className="rounded-full bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">
            حدّث هلأ
          </button>
          <button onClick={() => void later()} disabled={busy} className="rounded-full border border-outline px-4 py-2 text-sm hover:bg-surface2 disabled:opacity-50">
            بعدين
          </button>
        </div>
      </div>
    </div>
  )
}
