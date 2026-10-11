import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ghostBtn, primaryBtn } from './components/ui'

type St = Awaited<ReturnType<typeof window.api.claudeAcct.get>>

export function ClaudeAccountsPanel() {
  const [s, setS] = useState<St | null>(null)
  const [msg, setMsg] = useState('')
  const load = useCallback(() => window.api.claudeAcct.get().then(setS), [])
  useEffect(() => {
    void load()
  }, [load])
  if (!s) return null
  const row = (id: 'work' | 'personal', title: string, st: St['work']): ReactElement => (
    <label className="flex items-center gap-3 rounded-xl border border-outline p-3">
      <input type="radio" name="claude-acct" checked={s.cfg.active === id} disabled={!st.loggedIn} onChange={() => window.api.claudeAcct.set({ active: id }).then(load)} />
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div dir="ltr" className="text-start text-xs text-muted">
          {st.loggedIn ? (st.email ?? '') + (st.plan ? ' · ' + st.plan : '') : 'مو مسجّل دخول'}
        </div>
      </div>
      {id === 'personal' && (
        <button
          type="button"
          className={(st.loggedIn ? ghostBtn : primaryBtn) + ' border border-outline'}
          onClick={async () => {
            const r = await window.api.claudeAcct.login()
            setMsg(r.ok ? 'انفتحت نافذة تسجيل الدخول، كمّل بالمتصفح وبعدين دوس تحديث.' : (r.error ?? 'خطأ'))
          }}
        >
          {st.loggedIn ? 'إعادة تسجيل الدخول' : 'تسجيل الدخول'}
        </button>
      )}
    </label>
  )
  return (
    <section className="mb-4 rounded-card border border-outline p-4">
      <h3 className="mb-1 text-sm font-semibold">حسابات Claude (اشتراك)</h3>
      <p className="mb-3 text-xs text-muted">اختار أي حساب يستعمله البرنامج. الحساب الشخصي منفصل تماماً (ملف إعدادات خاص فيه).</p>
      <div className="space-y-2">
        {row('work', 'الحساب الافتراضي (الشغل)', s.work)}
        {row('personal', 'الحساب الشخصي', s.personal)}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={s.cfg.auto} onChange={(e) => window.api.claudeAcct.set({ auto: e.target.checked }).then(load)} />
        إذا خلص رصيد/حد الحساب المختار، حوّل تلقائياً للحساب التاني (إذا مسجّل دخول)
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className={ghostBtn + ' border border-outline'} onClick={() => void load()}>تحديث</button>
        {msg && <span className="text-xs text-success">{msg}</span>}
      </div>
    </section>
  )
}
