import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Chip, Toggle, cardCls, inputCls, primaryBtn, ghostBtn } from './components/ui'

const GOOGLE = 'google-workspace'

export function AccountsPanel() {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState('')
  const [write, setWrite] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'test' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.accounts.get().then((a) => {
      setEmail(a.googleEmail)
      setSaved(a.googleEmail)
      setWrite(a.writeServers.includes(GOOGLE))
    })
  }, [])

  const saveEmail = async (): Promise<void> => {
    const r = await window.api.accounts.setEmail(email)
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'خطأ' })
    setSaved(email.trim())
    setMsg({ ok: true, text: 'انحفظ الإيميل.' })
  }
  const run = async (action: 'connect' | 'test'): Promise<void> => {
    setBusy(action)
    setMsg(null)
    const r = await window.api.accounts.google(action)
    setMsg({ ok: r.ok, text: r.message })
    setBusy(null)
  }

  return (
    <section className="mb-6">
      <h3 className="mb-1 text-base font-semibold">الحسابات المرتبطة</h3>
      <p className="mb-3 text-xs text-muted">
        اربط حساباتك ليقدر النموذج يقرأ ويتعامل مع خدماتها. تسجيل الدخول بيتم عندك بالمتصفح، والتطبيق ما بيشوف كلمة السر.
      </p>
      <div className={cardCls + ' space-y-3'}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Google</span>
          <Chip cls={write ? 'bg-warning/20 text-warning' : 'bg-success/15 text-success'}>{write ? 'قراءة وكتابة (بموافقتك)' : 'قراءة فقط'}</Chip>
        </div>
        <div className="flex gap-2">
          <input dir="ltr" className={inputCls} placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className={primaryBtn} disabled={email.trim() === saved} onClick={saveEmail}>
            حفظ
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={primaryBtn} disabled={!saved || busy !== null} onClick={() => run('connect')}>
            {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : 'اتصل'}
          </button>
          <button className={ghostBtn + ' border border-outline'} disabled={!saved || busy !== null} onClick={() => run('test')}>
            {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : 'اختبار'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-success' : 'text-warning'}`}>{msg.text}</span>}
        </div>
        <Toggle
          checked={write}
          label="السماح بالكتابة: إرسال إيميل، إنشاء مواعيد ومهام، تعديل ملفات… (بيطلب موافقتك قبل كل إجراء)"
          onChange={async () => {
            const next = !write
            if (next && !confirm('تفعيل الكتابة بيخلي النموذج يقترح إجراءات تغيّر بحسابك (دايماً بعد موافقتك بنافذة). تكمل؟')) return
            const list = await window.api.accounts.setWrite(GOOGLE, next)
            setWrite(list.includes(GOOGLE))
          }}
        />
        <p className="text-[11px] text-muted">الحذف النهائي ممنوع دايماً. Google Keep ما إله واجهة رسمية، فالملاحظات بتنعمل عبر Tasks أو Docs.</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
        <div className={cardCls}>Canva — قريباً</div>
        <div className={cardCls}>Microsoft — قريباً</div>
      </div>
    </section>
  )
}
