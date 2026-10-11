import { useEffect, useRef, useState } from 'react'
import type { RemoteEvent, RemoteInfo } from '../preload/index.d'

const EMPTY: RemoteInfo = { enabled: false, port: 47821, relayUrl: '', approveFromPhone: true, destructiveFromPhone: false, lan: [], listening: false, pairing: null, devices: [] }
const ago = (t: number): string => {
  if (!t) return '—'
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  return s < 60 ? 'هلأ' : s < 3600 ? Math.round(s / 60) + ' دقيقة' : s < 86400 ? Math.round(s / 3600) + ' ساعة' : Math.round(s / 86400) + ' يوم'
}

export function RemotePanel() {
  const [st, setSt] = useState<RemoteInfo>(EMPTY)
  const [relay, setRelay] = useState('')
  const [qr, setQr] = useState<{ img: string; exp: number } | null>(null)
  const [left, setLeft] = useState(0)
  const [sas, setSas] = useState<{ sas: string; name: string } | null>(null)
  const [msg, setMsg] = useState('')
  const pairingRef = useRef(false)

  const refresh = async (): Promise<void> => {
    const s = await window.api.remote.get()
    setSt(s)
    setRelay((r) => (r === '' ? s.relayUrl : r))
  }
  useEffect(() => {
    void refresh()
    const off = window.api.remote.onEvent((e: RemoteEvent) => {
      if (e.type === 'sas') {
        setSas({ sas: e.sas, name: e.name })
        setQr(null)
      } else if (e.type === 'paired') {
        setSas(null)
        setQr(null)
        pairingRef.current = false
        setMsg('انربط ' + e.name + ' ✅')
      } else if (e.type === 'pair-end') {
        setQr(null)
        if (e.reason !== 'done' && e.reason !== 'restart') setSas(null)
        pairingRef.current = false
        if (e.reason === 'expired') setMsg('انتهت صلاحية الـ QR، اعمل واحد جديد.')
        if (e.reason === 'rejected') setMsg('رفضت الربط.')
      }
      void refresh()
    })
    const t = setInterval(() => void refresh(), 10000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  useEffect(() => {
    if (!qr) return
    const t = setInterval(() => setLeft(Math.max(0, Math.round((qr.exp - Date.now()) / 1000))), 500)
    return () => clearInterval(t)
  }, [qr])

  const set = async (p: Parameters<typeof window.api.remote.set>[0]): Promise<void> => {
    try {
      setSt(await window.api.remote.set(p))
      setMsg('')
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  const pair = async (): Promise<void> => {
    setMsg('')
    const r = await window.api.remote.pairStart()
    if (!r.ok) return setMsg(r.error)
    pairingRef.current = true
    setQr({ img: r.qr, exp: r.exp })
    setLeft(Math.round((r.exp - Date.now()) / 1000))
  }

  return (
    <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
      <h3 className="text-base font-semibold">تطبيق الموبايل (ربط مشفّر)</h3>
      <p className="mt-1 text-xs text-muted">
        بتربط تلفونك بالبرنامج بمسح QR مرة وحدة. كل الكلام بينهم مشفّر من الطرفين (حتى الـ relay ما بيقدر يقراه)، وبتقدر تشيل أي جهاز بضغطة. بيشتغل عالشبكة المحلية مباشرة، ومن برا البيت لما تحط عنوان relay خاص فيك.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={st.enabled} onChange={(e) => void set({ enabled: e.target.checked })} />
        فعّل الربط مع الموبايل
      </label>
      {st.enabled && (
        <>
          <div className="mt-2 text-xs text-muted">
            {st.listening ? '✅ جاهز عالشبكة المحلية' + (st.lan.length ? ': ' + st.lan.map((u) => u.replace('/ws', '')).join('  ·  ') : '') : '⚠️ ما قدرت فتح المنفذ ' + st.port + ' (ممكن مستخدم). غيّرو تحت.'}
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs">
              المنفذ
              <input
                type="number"
                dir="ltr"
                defaultValue={st.port}
                onBlur={(e) => Number(e.target.value) !== st.port && void set({ port: Number(e.target.value) })}
                className="w-24 rounded-lg border border-outline bg-bg px-2 py-1 text-center"
              />
            </label>
            <div className="flex items-center gap-2 text-xs">
              <input
                dir="ltr"
                value={relay}
                onChange={(e) => setRelay(e.target.value)}
                placeholder="wss://relay-الخاص-فيك (اختياري، للوصول من برا البيت)"
                className="min-w-0 flex-1 rounded-lg border border-outline bg-bg px-3 py-1.5 outline-none focus:border-primary"
              />
              <button onClick={() => void set({ relayUrl: relay })} className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2">
                حفظ
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={st.approveFromPhone} onChange={(e) => void set({ approveFromPhone: e.target.checked })} />
              اطلب موافقات الأوامر عالموبايل كمان
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={st.destructiveFromPhone} disabled={!st.approveFromPhone} onChange={(e) => void set({ destructiveFromPhone: e.target.checked })} />
              اسمح بالموافقة عالأوامر الخطيرة (حذف/فرمتة) من الموبايل
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => void pair()} disabled={!!sas} className="rounded-full bg-primary px-4 py-1.5 text-sm text-white disabled:opacity-50">
              ربط جهاز جديد
            </button>
            {qr && (
              <button
                onClick={() => {
                  void window.api.remote.pairCancel()
                  setQr(null)
                }}
                className="rounded-full border border-outline px-3 py-1.5 text-xs hover:bg-surface2"
              >
                إلغاء
              </button>
            )}
          </div>

          {qr && (
            <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-outline bg-bg p-3">
              <img src={qr.img} alt="QR" className="h-80 w-80 rounded bg-white p-1" style={{ imageRendering: 'pixelated' }} />
              <div className="text-xs text-muted">
                افتح تطبيق الموبايل وامسح هالـ QR. بيخلص بعد <b className="text-fg">{left}</b> ثانية، وبينفع مرة وحدة بس.
                <br />
                تأكد إنو التلفون عالـ Wi-Fi نفسو.
              </div>
            </div>
          )}

          {sas && (
            <div className="mt-3 rounded-lg border-2 border-primary bg-bg p-4 text-center">
              <div className="text-xs text-muted">طلب ربط من «{sas.name}». تأكد إنو هالرمز هو نفسو اللي ظاهر عالتلفون:</div>
              <div dir="ltr" className="my-2 text-4xl font-bold tracking-[0.3em]">
                {sas.sas}
              </div>
              <div className="flex justify-center gap-2 text-sm">
                <button
                  onClick={() => {
                    void window.api.remote.pairAnswer(true)
                    setSas(null)
                  }}
                  className="rounded-full bg-primary px-4 py-1.5 text-white"
                >
                  الرمز متطابق، اربط
                </button>
                <button
                  onClick={() => {
                    void window.api.remote.pairAnswer(false)
                    setSas(null)
                  }}
                  className="rounded-full border border-outline px-4 py-1.5 hover:bg-surface2"
                >
                  مو متطابق / رفض
                </button>
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-1 text-xs font-medium">الأجهزة المربوطة</div>
            {st.devices.length === 0 && <div className="text-xs text-muted">ما في أجهزة.</div>}
            {st.devices.map((d) => (
              <div key={d.id} className="mb-1 flex items-center justify-between rounded-lg border border-outline bg-bg px-3 py-2 text-xs">
                <div>
                  <span className={d.online ? 'text-green-500' : 'text-muted'}>●</span> <b>{d.name}</b>
                  <span className="text-muted"> — {d.online ? 'متصل هلأ' : 'آخر ظهور: ' + ago(d.lastSeen)}</span>
                </div>
                <button
                  onClick={async () => {
                    if (confirm('شيل الجهاز «' + d.name + '»؟ ما رح يقدر يتصل إلا بربط جديد.')) setSt(await window.api.remote.revoke(d.id))
                  }}
                  className="rounded-full border border-outline px-3 py-1 text-danger hover:bg-surface2"
                >
                  شيل
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {msg && <div className="mt-2 text-xs text-muted">{msg}</div>}
    </section>
  )
}
