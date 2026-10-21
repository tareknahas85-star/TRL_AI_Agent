import { useEffect, useState, type ReactElement } from 'react'
import { Modal } from './components/ui'

const VERSION = '5.16.1'
const SEEN = 'air.whatsnew.seen'
const NOTES: string[] = [
  'متصفح جانبي (🌐) بجنب المحادثة. لما تسكّر اللوحة، النافذة بترجع لعرضها الأصلي.',
  'جدولة مهامك صارت أدق: مرة وحدة أو بفترات، ولكل مهمة منطقتها الزمنية، وإعادة محاولة تلقائية إذا فشلت.',
  'إذا وصلنا لحد المزوّد، البرنامج بيوقف مؤقتاً بدل ما يفشل، والموديلات القوية بتاخد الدور.',
  'التحديث صار أوضح: مربع «حدّث هلأ / بعدين» مع نسبة التنزيل، وإذا قلت بعدين بيسألك بعد 24 ساعة.',
  'مسودة رسالتك بتنحفظ لكل محادثة، وبتنمسح بعد الإرسال أو لما تسكّر التبويب.',
  'ملفات البيانات صارت تنكتب بأمان: ما بتتلف إذا انقطعت الكهرباء أثناء الحفظ.',
  'وكلاء الهاتف بيتصرفوا مثل تلغرام: بيستخدموا الكمبيوتر إذا كان متصل، وإلا بيتحولوا للسحابة.',
  'تقدير تكلفة حقيقي لـ Gemini المباشر، والسعر المجهول بيظهر كـ«مجهول».',
  'أمان أعلى: بس نافذة البرنامج تقدر تستدعي الأوامر الداخلية.'
]


export function WhatsNew(): ReactElement | null {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SEEN) !== VERSION
    } catch {
      return false
    }
  })
  useEffect(() => {
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