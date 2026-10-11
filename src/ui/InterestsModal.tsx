import { useState } from 'react'
import { Modal, primaryBtn, ghostBtn } from './components/ui'

// Interest id -> connector categories it suggests (see the Connectors catalog).
export const INTEREST_CATS: Record<string, string[]> = {
  dev: ['dev'],
  cloud: ['cloud', 'dev'],
  office: ['office'],
  media: ['media'],
  research: ['research'],
  daily: ['local']
}

const OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'dev', label: 'برمجة وتطوير', hint: 'GitHub، Linear، تعديل ملفات' },
  { id: 'cloud', label: 'سحابة وDevOps', hint: 'Google Cloud، Kubernetes، Terraform، Cloudflare' },
  { id: 'office', label: 'مكتب وإدارة', hint: 'Google، Microsoft 365، Notion، Dropbox' },
  { id: 'media', label: 'تصميم ووسائط', hint: 'Canva، Miro، تفريغ صوت' },
  { id: 'research', label: 'بحث ومعلومات', hint: 'بحث بالنت، أتمتة متصفح' },
  { id: 'daily', label: 'حياة يومية', hint: 'أماكن قريبة، طقس، ملفات الجهاز' }
]

// First-run (and "change my interests") screen. It only picks which connectors are suggested; nothing is switched on by itself
// because connecting needs the user's own sign-in or key.
export function InterestsModal({ initial = [], onDone }: { initial?: string[]; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>(initial)
  const [loc, setLoc] = useState(false)
  const toggle = (id: string): void => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const save = async (): Promise<void> => {
    await window.api.prefs.set({ interests: sel, onboardingDone: true, ...(sel.includes('daily') && loc ? { locationEnabled: true } : {}) })
    onDone()
  }
  const skip = async (): Promise<void> => {
    await window.api.prefs.set({ onboardingDone: true })
    onDone()
  }
  return (
    <Modal title="شو اللي بيهمّك؟" onClose={() => void skip()}>
      <div className="space-y-3 text-sm">
        <p className="text-xs leading-relaxed text-muted">
          اختار اهتماماتك ليقترح البرنامج الموصلات المناسبة بصفحة «الموصلات» (بعلامة «مقترح»). ما بيتفعّل ولا موصّل لحاله: كل واحد بدو تسجيل دخول أو مفتاح منك. وبتقدر تغيّرها بأي وقت.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => toggle(o.id)}
              className={'rounded-xl border p-3 text-start ' + (sel.includes(o.id) ? 'border-primary bg-primary/10' : 'border-outline hover:bg-surface2')}
            >
              <div className="font-medium">{o.label}</div>
              <div className="text-[11px] text-muted">{o.hint}</div>
            </button>
          ))}
        </div>
        {sel.includes('daily') && (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={loc} onChange={(e) => setLoc(e.target.checked)} />
            <span>فعّل أدوات الموقع (قريب مني / الطقس). بتقدر تطفيها من الإعدادات ← عام ← الموقع.</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className={ghostBtn} onClick={() => void skip()}>
            تخطي
          </button>
          <button className={primaryBtn} onClick={() => void save()}>
            حفظ
          </button>
        </div>
      </div>
    </Modal>
  )
}
