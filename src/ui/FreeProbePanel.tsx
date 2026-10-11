import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cardCls, ghostBtn } from './components/ui'

type Res = { id: string; ok: boolean; score: number; secs: number; tool: boolean; arabic: boolean | null; note: string; at: string }
type St = Awaited<ReturnType<typeof window.api.freeProbe.status>>

// Probe the 100%-free OpenRouter models for real (tool call + Arabic + speed).
// It only suggests: a better model becomes the first choice only after the user approves, and it rolls back by itself if it fails.
export function FreeProbePanel() {
  const [list, setList] = useState<{ id: string; ctx: number; created: string }[]>([])
  const [res, setRes] = useState<Record<string, Res>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [info, setInfo] = useState('')
  const [st, setSt] = useState<St | null>(null)

  const refresh = (): void => void window.api.freeProbe.status().then(setSt)
  const reload = async (): Promise<void> => {
    const rs = await window.api.freeProbe.results()
    setRes(Object.fromEntries(rs.map((r) => [r.id, r])))
  }

  useEffect(() => {
    void reload()
    refresh()
  }, [])

  const pull = async (): Promise<void> => {
    setBusy('list')
    const r = await window.api.freeProbe.list()
    setBusy(null)
    if (!r.ok) return setInfo('❌ ' + (r.error ?? 'فشل'))
    setList(r.models)
    setInfo(`✅ ${r.models.length} موديل مجاني 100% بيدعم الأدوات (سياق ≥ 32 ألف)`)
  }
  const run = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      setBusy(id)
      const r = await window.api.freeProbe.test(id)
      if (r) setRes((p) => ({ ...p, [id]: r }))
      await new Promise((ok) => setTimeout(ok, 3500))
    }
    await window.api.freeProbe.evaluate()
    refresh()
    setBusy(null)
  }
  const checkNow = async (): Promise<void> => {
    setBusy('weekly')
    await window.api.freeProbe.checkNow()
    await reload()
    refresh()
    setBusy(null)
  }
  const ranked = [...list].sort((a, b) => (res[b.id]?.score ?? -1) - (res[a.id]?.score ?? -1))

  return (
    <div className={cardCls + ' mt-3'}>
      <div className="mb-1 text-sm font-semibold">فحص الموديلات المجانية (OpenRouter)</div>
      <p className="mb-3 text-xs text-muted">
        بيجرّب كل موديل فعليًا: استدعاء أداة صحيح + جواب عربي + السرعة. الفحص بياكل من الكوتا اليومية للحساب المجاني. بيقترح بس: ما بيغيّر شي إلا بموافقتك، وإذا الموديل المثبّت فشل بطلبين ورا بعض بيرجع للديفولت لحالو.
      </p>

      {st?.suggestion && (
        <div dir="ltr" className="mb-3 rounded-lg border border-border p-3 text-xs">
          <div dir="rtl" className="mb-1 font-semibold">💡 اقتراح: في موديل مجاني أقوى من الحالي</div>
          <div className="font-mono">الحالي: {st.suggestion.current} ({st.suggestion.oldScore}/100)</div>
          <div className="font-mono">المقترح: {st.suggestion.model} ({st.suggestion.newScore}/100)</div>
          <div dir="rtl" className="mt-2 flex gap-2">
            <button className={ghostBtn} onClick={() => void window.api.freeProbe.apply(st.suggestion!.model).then(refresh)}>موافقة: خلّيه الأول</button>
            <button className={ghostBtn} onClick={() => void window.api.freeProbe.dismiss().then(refresh)}>تجاهل</button>
          </div>
        </div>
      )}
      {st?.pinned && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span dir="ltr" className="font-mono">مثبّت: {st.pinned}</span>
          <button className={ghostBtn} onClick={() => void window.api.freeProbe.unpin().then(refresh)}>رجّع للديفولت</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className={ghostBtn} disabled={busy !== null} onClick={() => void pull()}>
          {busy === 'list' ? <Loader2 size={14} className="animate-spin" /> : 'اسحب القائمة'}
        </button>
        {list.length > 0 && (
          <button className={ghostBtn} disabled={busy !== null} onClick={() => void run(list.slice(0, 6).map((m) => m.id))}>
            افحص أحدث 6
          </button>
        )}
        {list.length > 0 && (
          <button className={ghostBtn} disabled={busy !== null} onClick={() => void run(list.map((m) => m.id))}>
            افحص الكل ({list.length})
          </button>
        )}
        <button className={ghostBtn} disabled={busy !== null} onClick={() => void checkNow()}>
          {busy === 'weekly' ? <Loader2 size={14} className="animate-spin" /> : 'الفحص الأسبوعي هلأ'}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        آخر فحص أسبوعي: {st && st.lastCheck ? new Date(st.lastCheck).toLocaleDateString('ar') : 'لسا'} · بيتكرر كل أسبوع والتطبيق شغّال وبيبعتلك اقتراح على Telegram إذا لقي أقوى.
      </p>
      {info && <p className="mt-2 text-xs">{info}</p>}
      {ranked.length > 0 && (
        <div dir="ltr" className="mt-3 max-h-80 overflow-auto text-xs">
          {ranked.map((m) => {
            const r = res[m.id]
            return (
              <div key={m.id} className="flex items-center gap-2 border-b border-border py-1">
                <span className="w-6 text-center">{busy === m.id ? <Loader2 size={12} className="animate-spin" /> : r ? (r.ok ? '✅' : '❌') : '·'}</span>
                <span className="min-w-0 flex-1 truncate font-mono">{m.id}</span>
                <span className="w-24 text-muted">{m.created} · {Math.round(m.ctx / 1000)}k</span>
                <span className="w-16 text-end">{r ? r.score + '/100' : ''}</span>
                <span className="w-12 text-end text-muted">{r && r.secs ? r.secs + 's' : ''}</span>
                <button className={ghostBtn} disabled={busy !== null} onClick={() => void run([m.id])}>جرّب</button>
                <span dir="auto" className="hidden w-64 truncate text-muted lg:block" title={r?.note}>{r?.note}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}