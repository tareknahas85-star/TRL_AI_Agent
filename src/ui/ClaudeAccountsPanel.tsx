import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ghostBtn, primaryBtn } from './components/ui'

type St = Awaited<ReturnType<typeof window.api.claudeAcct.get>>

export function ClaudeAccountsPanel() {
  const [s, setS] = useState<St | null>(null)
  const [msg, setMsg] = useState('')
  const [full, setFull] = useState(false)
  const [ac, setAc] = useState<Awaited<ReturnType<typeof window.api.engineAccounts.status>> | null>(null)
  const loadAc = useCallback(() => window.api.engineAccounts.status().then(setAc), [])
  useEffect(() => {
    void loadAc()
  }, [loadAc])
  useEffect(() => {
    void window.api.agentMode.get().then(setFull)
  }, [])
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
      <h3 className="mb-1 text-sm font-semibold">حسابات Claude</h3>
      <p className="mb-3 text-xs text-muted">اختار أي حساب يستعمله البرنامج. الحساب الشخصي منفصل تماماً (ملف إعدادات خاص فيه). ملاحظة: Claude Code بيحتاج اشتراك Pro أو Max، فالحساب المجاني ما بيشتغل هون.</p>
      <div className="space-y-2">
        {row('work', 'الحساب الافتراضي (الشغل)', s.work)}
        {row('personal', 'الحساب الشخصي', s.personal)}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={s.cfg.auto} onChange={(e) => window.api.claudeAcct.set({ auto: e.target.checked }).then(load)} />
        إذا خلص رصيد/حد الحساب المختار، حوّل تلقائياً للحساب التاني (إذا مسجّل دخول)
      </label>
      <div className="mt-4 rounded border border-outline p-3">
        <h4 className="mb-1 text-xs font-semibold">تسجيل الدخول للحسابات (محرّكات التنفيذ)</h4>
        <p className="mb-2 text-xs text-muted">الترتيب: غووغل ثم Claude ثم ChatGPT. بيفتح نافذة تسجيل بالمتصفح وبتسجّل دخول بإيدك، والبرنامج ما بيشوف ولا بيخزّن أي رمز.</p>
        {([['gemini', 'غووغل (Antigravity)', ac?.gemini], ['claude', 'Claude', ac?.claude], ['codex', 'ChatGPT (Codex)', ac?.codex]] as const).map(([k, name, st]) => (
          <div key={k} className="mb-1 flex items-center gap-3 text-xs">
            <span className="w-32">{name}</span>
            <span className="w-28 text-muted">{!st?.installed ? 'الأداة مو مثبّتة' : 'loggedIn' in st ? (k === 'gemini' ? (st.loggedIn ? 'مفتاح جاهز' : 'ما في مفتاح') : st.loggedIn ? 'مسجّل' : 'مو مسجّل') : 'مثبّتة'}</span>
            <button type="button" className={ghostBtn + ' border border-outline'} disabled={!st?.installed} onClick={() => void window.api.engineAccounts.login(k).then(() => { let n = 0; const t = setInterval(() => { void loadAc(); if (++n > 40) clearInterval(t) }, 3000) })}>{k === 'gemini' ? 'احصل على مفتاح Gemini' : 'سجّل دخول / بدّل الحساب'}</button>
          </div>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={full} onChange={(e) => void window.api.agentMode.set(e.target.checked).then(setFull)} />
        وضع الاستقلال الكامل: Claude Code وCodex بينفّذوا بدون أي سؤال صلاحيات وبدون عزل (مطفي = محدود بمجلد العمل)
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className={ghostBtn + ' border border-outline'} onClick={() => { void load(); void loadAc() }}>تحديث</button>
        {msg && <span className="text-xs text-success">{msg}</span>}
      </div>
    </section>
  )
}
