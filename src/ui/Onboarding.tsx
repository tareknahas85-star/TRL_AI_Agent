import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'

export const NAME_KEY = 'air.userName'
export const DONE_KEY = 'air.onboarded'

export function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'أنت'
  } catch {
    return 'أنت'
  }
}

type Msg = { ok: boolean; text: string } | null

const STEPS = ['أهلاً', 'مفتاح OpenRouter', 'النماذج', 'جاهز']

// First-run wizard: name, OpenRouter key (free tier is enough), pull + enable models, then done.
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [keyOk, setKeyOk] = useState(false)
  const [modelsOk, setModelsOk] = useState(false)
  const [freeOnly, setFreeOnly] = useState(true)
  const [st, setSt] = useState<{ key: boolean; ollama: boolean; localMaster: boolean } | null>(null)

  useEffect(() => {
    window.api.spend.get().then(setFreeOnly).catch(() => undefined)
    window.api.status().then(setSt).catch(() => undefined)
  }, [])

  const finish = (): void => {
    try {
      localStorage.setItem(DONE_KEY, '1')
      if (name.trim()) localStorage.setItem(NAME_KEY, name.trim())
    } catch {
      /* storage unavailable: the wizard just shows again next time */
    }
    onClose()
  }

  const saveKey = async (): Promise<void> => {
    const v = key.trim()
    if (v.length < 10) {
      setMsg({ ok: false, text: 'الصق المفتاح كامل (يبدأ بـ sk-or-).' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await window.api.setKey('OPENROUTER_API_KEY', v)
      const r = await window.api.catalog.test()
      setMsg({ ok: r.ok, text: r.message })
      setKeyOk(r.ok)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const pullModels = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await window.api.catalog.fetch()
      setMsg({ ok: r.ok, text: r.ok ? `تم جلب ${r.total} نموذج، وفُعّلت النماذج الافتراضية.` : r.message })
      setModelsOk(r.ok)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const toggleFree = async (): Promise<void> => {
    const next = !freeOnly
    setFreeOnly(await window.api.spend.set(next))
  }

  const go = (n: number): void => {
    setMsg(null)
    setStep(n)
  }

  const btn = 'rounded-full px-5 py-2 text-sm disabled:opacity-50'
  const primary = btn + ' bg-primary text-white'
  const ghost = btn + ' border border-outline hover:bg-surface2'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] max-w-[94vw] rounded-card border border-outline bg-surface p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted">
            {STEPS.map((s, i) => (
              <span key={s} className={i === step ? 'font-semibold text-primary' : i < step ? 'text-fg' : ''}>
                {i + 1}. {s}
                {i < STEPS.length - 1 ? ' ›' : ''}
              </span>
            ))}
          </div>
          <button onClick={finish} title="تخطي" className="rounded-full p-1 text-muted hover:bg-surface2">
            <X size={16} />
          </button>
        </div>

        {step === 0 && (
          <div className="space-y-3 text-sm">
            <div className="text-lg font-semibold">أهلاً فيك في TRL_AI_Agent</div>
          <p className="text-muted">بخطوتين بتصير جاهز: مفتاح مجاني من OpenRouter، وبعدها بنجيب النماذج ونفعّلها لحالها. كل شي بيبقى على جهازك.</p>
            <label className="block">
              <span className="mb-1 block text-muted">شو بدك نناديك؟ (اختياري)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك"
                className="w-full rounded-xl border border-outline bg-bg px-3 py-2 outline-none focus:border-primary"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={finish} className={ghost}>
                تخطي
              </button>
              <button onClick={() => go(1)} className={primary}>
                يلا نبدأ
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 text-sm">
            <div className="text-lg font-semibold">مفتاح OpenRouter</div>
            <ol className="list-decimal space-y-1 ps-5 text-muted">
              <li>
                افتح{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-primary hover:underline" dir="ltr">
                  openrouter.ai/keys
                </a>{' '}
                وسجّل دخول (مجاناً).
              </li>
              <li>اضغط Create Key وانسخ المفتاح.</li>
              <li>الصقه هون. المفتاح المجاني بيكفي للبداية مع النماذج المجانية.</li>
            </ol>
            <input
              type="password"
              dir="ltr"
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setKeyOk(false)
              }}
              placeholder="sk-or-v1-…"
              className="w-full rounded-xl border border-outline bg-bg px-3 py-2 outline-none focus:border-primary"
            />
            {msg && <div className={msg.ok ? 'text-success' : 'text-warning'}>{msg.text}</div>}
            <div className="flex justify-between gap-2 pt-2">
              <button onClick={() => go(0)} className={ghost}>
                رجوع
              </button>
              <div className="flex gap-2">
                <button disabled={busy || !key.trim()} onClick={saveKey} className={keyOk ? ghost : primary}>
                  {busy ? 'عم أفحص…' : 'حفظ واختبار'}
                </button>
                {keyOk && (
                  <button onClick={() => go(2)} className={primary}>
                    التالي
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm">
            <div className="text-lg font-semibold">النماذج</div>
            <p className="text-muted">بنجيب قائمة النماذج من OpenRouter ونفعّل الافتراضية منها. بتقدر تغيّرها بعدين من صفحة «النماذج».</p>
            <button disabled={busy} onClick={pullModels} className={modelsOk ? ghost : primary}>
              {busy ? 'عم أجلب…' : modelsOk ? 'إعادة الجلب' : 'جلب النماذج وتفعيلها'}
            </button>
            {msg && <div className={msg.ok ? 'text-success' : 'text-warning'}>{msg.text}</div>}
            <label className="flex cursor-pointer items-center gap-2 pt-1">
              <input type="checkbox" checked={freeOnly} onChange={toggleFree} />
              <span>استعمل النماذج المجانية فقط (بدون أي إنفاق)</span>
            </label>
            <div className="flex justify-between gap-2 pt-2">
              <button onClick={() => go(1)} className={ghost}>
                رجوع
              </button>
              <button disabled={!modelsOk} onClick={() => go(3)} className={primary}>
                التالي
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Check size={20} className="text-success" /> جاهز{name.trim() ? ' يا ' + name.trim() : ''}
            </div>
            <ul className="list-disc space-y-1 ps-5 text-muted">
              <li>
                المايسترو: {st?.localMaster ? 'محلي (Ollama)' : 'سحابي تلقائي'}
                {st && !st.ollama ? ' — Ollama مو مثبّت، وما بتحتاجه.' : ''}
              </li>
              <li>اكتب أي طلب بالدردشة وبيختار النموذج المناسب لحاله.</li>
              <li>لربط حساباتك (Google وGitHub وغيرهم): الإعدادات ثم الموصلات.</li>
              <li>بتقدر ترجّع هالمعالج من نافذة «عن البرنامج» (كبسة على اسم التطبيق).</li>
            </ul>
            <div className="flex justify-end pt-2">
              <button onClick={finish} className={primary}>
                ابدأ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
