import { useCallback, useEffect, useState } from 'react'
import { askConfirm } from './components/confirm'
import { cardCls, ghostBtn, primaryBtn } from './components/ui'

type Row = { id: string; label: string; url: string; state: 'yes' | 'maybe' | 'no'; where: string }
const ST = {
  yes: { t: 'مسجّل دخول ✓', c: 'bg-success/15 text-success' },
  maybe: { t: 'غالباً مسجّل', c: 'bg-warning/20 text-warning' },
  no: { t: 'مو مسجّل', c: 'bg-surface2 text-muted' }
}

/** Sites behind the generate-image/video/audio buttons: sign in once inside the app, see the state, sign out. */
export function MediaAccountsPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const load = useCallback(() => void window.api.media.accounts().then(setRows).catch(() => setRows([])), [])
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
            <span className={'rounded px-2 py-0.5 text-xs ' + ST[r.state].c}>{ST[r.state].t}</span>
            <button className={primaryBtn} onClick={() => void login(r)}>{r.state === 'no' ? 'سجّل دخول' : 'افتح'}</button>
            {r.state !== 'no' && <button className={ghostBtn} onClick={() => void logout(r)}>خروج</button>}
            <button className={ghostBtn} onClick={load}>تحديث</button>
          </div>
        </div>
      ))}
    </div>
  )
}