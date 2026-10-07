import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { ghostBtn, inputCls } from './components/ui'

export type HostId = 'openrouter' | 'huggingface' | 'gemini'

// "API host": where the provider's requests go. Empty / reset = the official address.
export function HostField({ id }: { id: HostId }) {
  const [info, setInfo] = useState<{ value: string; default: string; custom: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = (): void => void window.api.hosts.get().then((h) => { setInfo(h[id]); setDraft(h[id].value) })
  useEffect(load, [id])
  if (!info) return null
  const save = async (v: string): Promise<void> => {
    const r = await window.api.hosts.set(id, v)
    setMsg(r.ok ? { ok: true, text: v.trim() ? 'انحفظ' : 'رجع للافتراضي' } : { ok: false, text: r.error ?? 'خطأ' })
    load()
  }
  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm font-medium">API host</label>
      <div className="flex items-center gap-2">
        <input dir="ltr" className={inputCls + ' flex-1 font-mono text-xs'} value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(null) }} placeholder={info.default} />
        <button className={ghostBtn} disabled={draft.trim() === info.value} onClick={() => save(draft)}>حفظ</button>
        <button className={ghostBtn + ' flex items-center gap-1'} disabled={!info.custom && draft === info.default} onClick={() => save('')} title="رجّع العنوان الرسمي">
          <RotateCcw size={13} /> افتراضي
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {info.custom ? 'عم يستعمل عنوان مخصص. ' : 'العنوان الرسمي. '}ما تغيّره إلا إذا عندك بروكسي أو سيرفر متوافق، لأنو المفتاح بينبعت لهالعنوان.
      </p>
      {msg && <p className={'mt-1 text-xs ' + (msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p>}
    </div>
  )
}
