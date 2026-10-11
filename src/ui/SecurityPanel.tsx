import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Toggle, cardCls } from './components/ui'
import { KeyField } from './KeyField'

// Opt-in security tools (Pwned Passwords + VirusTotal hash lookup). Off by default; never used in confidential projects.
export function SecurityPanel() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.prefs.get().then((p) => setOn(p.securityToolsEnabled))
  }, [])
  if (on === null) return null
  return (
    <section className={cardCls + ' mb-6 space-y-3'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck size={16} /> فحوصات الأمان
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            أداتين بتشتغلوا بس لما الطلب بيحتاجهم. (1) فحص كلمة السر بقاعدة التسريبات Have I Been Pwned: مجاني وبدون مفتاح، وبيطلع من جهازك أول 5 خانات من الـhash بس، مش كلمة السر. (2) فحص ملف على VirusTotal بالـhash قبل ما تثبّت skill أو MCP أو برنامج: الملف ما بينرفع أبداً، وبدو مفتاح VirusTotal المجاني تبعك. ممنوعين بالمشاريع السرية.
          </p>
        </div>
        <Toggle
          checked={on}
          label="تفعيل فحوصات الأمان"
          onChange={async () => {
            const p = await window.api.prefs.set({ securityToolsEnabled: !on })
            setOn(p.securityToolsEnabled)
          }}
        />
      </div>
      <div>
        <div className="mb-1 text-xs text-muted">مفتاح VirusTotal (مجاني من حسابك: 4 فحوصات بالدقيقة و500 باليوم). فحص كلمات السر ما بيحتاج مفتاح.</div>
        <KeyField name="VIRUSTOTAL_API_KEY" verifyLabel="جرّب المفتاح" verify={() => window.api.prefs.testVirusTotal()} />
      </div>
    </section>
  )
}