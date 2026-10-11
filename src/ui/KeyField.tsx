import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { ghostBtn, inputCls } from './components/ui'

export type KeyName = 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'HUGGINGFACE_API_KEY' | 'VIRUSTOTAL_API_KEY'

// One API key: hidden by default (eye to reveal), saved as you type (encrypted on this device), optional "verify" button.
export function KeyField({ name, verify, onChange, verifyLabel }: { name: KeyName; verify?: () => Promise<{ ok: boolean; message: string; models?: string[] }>; onChange?: (has: boolean) => void; verifyLabel?: string }) {
  const [val, setVal] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; message: string; models?: string[] } | null>(null)

  useEffect(() => {
    void window.api.getKey(name).then(setVal)
  }, [name])

  const save = (v: string): void => {
    setVal(v)
    setRes(null)
    window.api.setKey(name, v)
    onChange?.(!!v.trim())
  }
  const check = async (): Promise<void> => {
    if (!verify) return
    setBusy(true)
    setRes(await verify())
    setBusy(false)
  }

  return (
    <div className="mb-5">
      <div className="mb-1 text-sm font-semibold">مفتاح API</div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input dir="ltr" type={show ? 'text' : 'password'} autoComplete="off" value={val} onChange={(e) => save(e.target.value)} placeholder={name} className={inputCls + ' pe-10'} />
          <button type="button" aria-label={show ? 'إخفاء' : 'إظهار'} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg" onClick={() => setShow(!show)}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {verify && (
          <button className={ghostBtn + ' border border-outline'} disabled={busy || !val.trim()} onClick={() => void check()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : (verifyLabel ?? 'اختبار وكشف الموديلات')}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">بتنحفظ مشفّرة على جهازك بس.</p>
      {res && <p className={'mt-1 text-xs ' + (res.ok ? 'text-success' : 'text-danger')}>{res.ok ? '✓ ' : '✗ '}{res.message}</p>}
      {res?.models && res.models.length > 0 && (
        <details className="mt-2 rounded-xl border border-outline p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">الموديلات المتاحة بمفتاحك ({res.models.length})</summary>
          <ul dir="ltr" className="mt-2 grid max-h-64 grid-cols-1 gap-1 overflow-auto text-start font-mono text-xs text-muted md:grid-cols-2">
            {res.models.map((m) => <li key={m} className="truncate">{m}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}