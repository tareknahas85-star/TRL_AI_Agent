import { useCallback, useEffect, useState } from 'react'
import { askConfirm } from './components/confirm'
import { cardCls, ghostBtn, primaryBtn } from './components/ui'

type Row = { id: string; label: string; url: string; state: 'yes' | 'maybe' | 'no' | 'unknown' | 'checking'; where: string; manual?: boolean }
const ST = {
  yes: { t: 'مسجّل دخول ✓', c: 'bg-success/15 text-success' },
  maybe: { t: 'غالباً مسجّل', c: 'bg-warning/20 text-warning' },
  no: { t: 'مو مسجّل', c: 'bg-surface2 text-muted' },
  unknown: { t: 'ما قدرت أتحقق', c: 'bg-surface2 text-muted' },
  checking: { t: 'عم يتحقق…', c: 'bg-surface2 text-muted' }
}

/** Sites behind the generate-image/video/audio buttons: sign in once inside the app, see the state, sign out. */
export function MediaAccountsPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const load = useCallback(() => {
    void (async () => {
      let list: Row[] = []
      try {
        list = (await window.api.media.accounts()) as Row[]
      } catch { /* empty */ }
      setRows(list.map((r) => ({ ...r, state: 'checking' as const })))
      const manual = new Set(list.filter((r) => r.manual).map((r) => r.id))
      // The quick list is only a hint; each site is then checked for real, one after another.
      for (const r of list) {
        let s: Row['state'] = 'unknown'
        try {
          s = await window.api.media.accountVerify(r.id)
        } catch { /* keep unknown */ }
        setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, state: s, manual: manual.has(r.id) } : x)))
      }
    })()
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const login = async (r: Row) => {
    const url = await window.api.media.accountLogin(r.id)
    if (url) window.dispatchEvent(new CustomEvent('trl:open-side', { detail: url }))
  }
  const logout = async (r: Row) => {
    if (!(await askConfirm(`تسجّل خروج من ${r.label} جوا البرنامج؟ (ما بيأثر على كروم أو إيدج)`))) return
    await window.api.media.accountLogout(r.id)
    load()
  }

  // The automatic check can be wrong after a real sign-in: the user states the real state and it wins until cleared.
  const mark = async (r: Row, s: 'yes' | 'no' | null) => {
    await window.api.media.accountMark(r.id, s)
    load()
  }

  return (
    <div className={cardCls + ' space-y-3'}>
      <div>
        <div className="font-semibold">حسابات مواقع التوليد (صورة / فيديو / صوت)</div>
        <div className="text-xs text-muted">
          سجّل دخول مرة وحدة جوا البرنامج وبيضل محفوظ. البرنامج ما بينسخ شي من كروم أو إيدج، فحساباتك هونيك ما بتتأثر.
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
          <div>
            <div>{r.label}</div>
            <div className="text-xs text-muted">{r.where}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={'rounded px-2 py-0.5 text-xs ' + ST[r.state].c}>{ST[r.state].t}{r.manual ? ' (يدوي)' : ''}</span>
            <button className={primaryBtn} onClick={() => void login(r)}>{r.state === 'no' ? 'سجّل دخول' : 'افتح'}</button>
            {r.state !== 'no' && <button className={ghostBtn} onClick={() => void logout(r)}>خروج</button>}
            {r.id !== 'gemini' &&
              r.state !== 'checking' &&
              (r.manual ? (
                <button className={ghostBtn} onClick={() => void mark(r, null)}>رجّع للفحص التلقائي</button>
              ) : (
                <button className={ghostBtn} title="إذا الحالة مو صح، حدّد الحالة الحقيقية" onClick={() => void mark(r, r.state === 'yes' || r.state === 'maybe' ? 'no' : 'yes')}>
                  {r.state === 'yes' || r.state === 'maybe' ? 'مو مسجّل فعلياً' : 'مسجّل فعلياً'}
                </button>
              ))}
            <button className={ghostBtn} onClick={load}>تحديث</button>
          </div>
        </div>
      ))}
    </div>
  )
}