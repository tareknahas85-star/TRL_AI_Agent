import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cardCls, ghostBtn } from './components/ui'

type Res = { id: string; ok: boolean; score: number; secs: number; tool: boolean; arabic: boolean | null; note: string; at: string }

// Probe the 100%-free OpenRouter models for real (tool call + Arabic + speed). Only reports, never switches anything.
export function FreeProbePanel() {
  const [list, setList] = useState<{ id: string; ctx: number; created: string }[]>([])
  const [res, setRes] = useState<Record<string, Res>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [info, setInfo] = useState('')

  useEffect(() => {
    void window.api.freeProbe.results().then((rs) => setRes(Object.fromEntries(rs.map((r) => [r.id, r]))))
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
    setBusy(null)
  }
  const ranked = [...list].sort((a, b) => (res[b.id]?.score ?? -1) - (res[a.id]?.score ?? -1))

  return (
    <div className={cardCls + ' mt-3'}>
      <div className="mb-1 text-sm font-semibold">فحص الموديلات المجانية (OpenRouter)</div>
      <p className="mb-3 text-xs text-muted">
        بيجرّب كل موديل فعليًا: استدعاء أداة صحيح + جواب عربي + السرعة. للعلم: الحساب المجاني على OpenRouter عليه حد يومي، فالفحص الكامل بياكل من الكوتا. ما في تبديل تلقائي، بس تقرير.
      </p>
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
      </div>
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