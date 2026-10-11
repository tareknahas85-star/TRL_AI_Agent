import { useEffect, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { Toggle, cardCls, ghostBtn } from './components/ui'

// Opt-in location tools (get_location + nearby_places). Off by default; never used in confidential projects.
export function LocationPanel() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    void window.api.prefs.get().then((p) => setOn(p.locationEnabled))
  }, [])
  if (on === null) return null
  const test = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await window.api.prefs.testLocation()
    setMsg(r.ok ? `${r.source}${r.accuracyM ? ' · دقة ~' + r.accuracyM + ' م' : ''}${r.address ? ' · ' + r.address : ''}${r.note ? ' — ' + r.note : ''}` : r.message)
    setBusy(false)
  }
  return (
    <section className={cardCls + ' mb-6 space-y-3'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <MapPin size={16} /> الموقع
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            بيخلّي البرنامج يعرف وين إنت لما تسأل «قريب مني» أو «الطقس عندي»، وبيبحث عن الأماكن من OpenStreetMap (مجاني). بيجرّب بالترتيب: GPS الموبايل (إذا مربوط)، بعدين خدمة الموقع بويندوز (واي فاي)، وآخر شي الـIP (دقة مدينة، وبيغلط مع الـVPN). ما بيشتغل إلا لما الطلب بيحتاجو، وما بينبعت للموديل غير الإحداثيات اللازمة، وممنوع بالمشاريع السرية.
          </p>
        </div>
        <Toggle
          checked={on}
          label="تفعيل أدوات الموقع"
          onChange={async () => {
            const p = await window.api.prefs.set({ locationEnabled: !on })
            setOn(p.locationEnabled)
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <button className={ghostBtn + ' flex items-center gap-1 border border-outline'} disabled={busy} onClick={() => void test()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />} جرّب تحديد موقعي
        </button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </section>
  )
}
