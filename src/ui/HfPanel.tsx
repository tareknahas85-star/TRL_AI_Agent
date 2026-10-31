import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cardCls, ghostBtn, inputCls } from './components/ui'
import { estimateStrength } from '../core/model-rank'

// Hugging Face as an extra image-description source: test the key, pull the vision models, pick one.
export function HfPanel() {
  const [hasKey, setHasKey] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [list, setList] = useState<{ id: string; providers: string[]; recommended: boolean }[]>([])
  const [info, setInfo] = useState('')
  const [chosen, setChosen] = useState('')
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null)
  const [free, setFree] = useState<{ id: string; image: boolean; tools: boolean }[]>([])
  const [priced, setPriced] = useState(true)

  useEffect(() => {
    void window.api.getKey('HUGGINGFACE_API_KEY').then((k) => setHasKey(!!k))
    void window.api.hf.getModel().then(setChosen)
  }, [])

  const pull = async (): Promise<void> => {
    setBusy('pull')
    setRes(null)
    const r = await window.api.getKey('HUGGINGFACE_API_KEY').then((k) => { setHasKey(!!k); return window.api.hf.models() })
    setBusy(null)
    if (!r.ok) {
      setInfo('❌ ' + (r.error ?? 'فشل'))
      setList([])
      return
    }
    setList(r.models)
    const fr = await window.api.hf.free(true)
    setFree(fr.ok ? fr.models : [])
    setPriced(fr.pricingKnown)
    setInfo(`✅ المفتاح شغّال — ${r.total} موديل عندهم: ${fr.ok ? fr.models.length : 0} مجاني (${fr.ok ? fr.models.filter((m) => m.image).length : 0} بتقبل صور)، و${r.models.length} بتقبل صور إجمالاً`)
  }
  const pick = async (id: string): Promise<void> => {
    setChosen(id)
    setRes(null)
    await window.api.hf.setModel(id)
  }
  const test = async (): Promise<void> => {
    if (!chosen) return
    setBusy('test')
    setRes(await window.api.hf.testModel(chosen))
    setBusy(null)
  }

  return (
    <div className={cardCls + ' mt-3'}>
      <div className="mb-1 text-sm font-semibold">Hugging Face — وصف الصور</div>
      <p className="mb-3 text-xs text-muted">
        بيشتغل كاحتياط بعد OpenRouter المجاني، وللمشاريع غير السرّية بس. ضيف المفتاح فوق ({hasKey ? 'موجود ✅' : 'ما في مفتاح'}) وبعدين اسحب الموديلات واختار واحد.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={ghostBtn} disabled={busy !== null} onClick={() => void pull()}>
          {busy === 'pull' ? <Loader2 size={14} className="animate-spin" /> : 'جرّب المفتاح + اسحب الموديلات'}
        </button>
        {list.length > 0 && (
          <select dir="ltr" className={inputCls + ' max-w-xs'} value={chosen} onChange={(e) => void pick(e.target.value)}>
            <option value="">(تلقائي: gemma-4 ثم gemma-3 ثم Qwen)</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.recommended ? '★ ' : ''}{m.id}
              </option>
            ))}
          </select>
        )}
        {chosen && (
          <button className={ghostBtn} disabled={busy !== null} onClick={() => void test()}>
            {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : 'جرّب الموديل المختار'}
          </button>
        )}
      </div>
      {info && <p className="mt-2 text-xs">{info}</p>}
      {free.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-xs font-semibold">الموديلات المجانية ({free.length}) — مرتبة من الأقوى للأضعف</div>
          {!priced && <p className="mb-1 text-xs text-warning">ما وصلت بيانات أسعار من Hugging Face، فالقائمة مو مفلترة حسب المجاني.</p>}
          <div dir="ltr" className="max-h-72 space-y-0.5 overflow-auto text-start font-mono text-xs">
            {free.slice().sort((a, b) => estimateStrength(b.id) - estimateStrength(a.id)).map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{m.id}</span>
                {m.tools && <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">tools</span>}
                {m.image && <span className="rounded bg-success/15 px-1 text-[10px] text-success">image</span>}
                <span className="w-8 text-end text-muted">{Math.round(estimateStrength(m.id))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {chosen && <p dir="ltr" className="mt-1 text-start font-mono text-xs text-muted">المختار: {chosen}</p>}
      {res && <p className={'mt-1 text-xs ' + (res.ok ? 'text-success' : 'text-danger')}>{res.ok ? '✅ ' : '❌ '}{res.message}</p>}
    </div>
  )
}