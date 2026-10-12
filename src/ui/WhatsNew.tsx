import { useEffect, useState } from 'react'
import { Modal } from './components/ui'

const VERSION = '5.9.7'
const SEEN = 'air.whatsnew.seen'
const NOTES: string[] = [
  'تبويب «التو دو» جديد بالشريط الجانبي لمهامك الشخصية.',
  'قائمة الموديلات صارت وحدة قابلة للبحث، مقسّمة مجاني / اشتراكك / مدفوع مع شارات. وبتقدر تكتب اسم الموديل مباشرة.',
  'نوافذ التأكيد صارت داخل البرنامج بنفس ستايلو.',
  'صفحة السكيلز: اسم ووصف نظيف، بحث، فلتر مفعّل/معطّل، وتفعيل أو تعطيل بالجملة.',
  'شريط ملخص بالموصّلات: كم موصّل متصل من الكل.',
  'عناوين المحادثات الجديدة قصيرة ومفهومة، وبتنقص عند حدود كلمة.',
  'تحت كل رد بيظهر شو الأدوات يلي انستعملت.',
  'لوحة أوامر (Ctrl+K) للتنقل السريع بين المحادثات والصفحات.',
  'لوحة استهلاك بصفحة الموديلات: شو الموديلات يلي بتستعملها أكتر.'
]

export function WhatsNew() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN) !== VERSION) setOpen(true)
    } catch {
      /* storage unavailable */
    }
    const h = (): void => setOpen(true)
    window.addEventListener('air:whatsnew', h)
    return () => window.removeEventListener('air:whatsnew', h)
  }, [])
  if (!open) return null
  const close = (): void => {
    setOpen(false)
    try {
      localStorage.setItem(SEEN, VERSION)
    } catch {
      /* storage unavailable */
    }
  }
  return (
    <Modal title={`شو الجديد بنسخة ${VERSION}`} onClose={close}>
      <ul className="list-disc space-y-2 ps-5 text-sm" dir="rtl">
        {NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <div className="mt-5 flex justify-start">
        <button onClick={close} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white shadow-card hover:opacity-90">
          تمام
        </button>
      </div>
    </Modal>
  )
}