import { useEffect, useState, type ReactElement } from 'react'
import { Modal } from './components/ui'

const VERSION = '5.17.7'
const SEEN = 'air.whatsnew.seen'
const NOTES: string[] = [
  'أزرار «توليد صورة / فيديو / صوت» جنب الشات: كل زر بيعرض النماذج المتاحة مع شرح وحد يومي، والنتيجة بتطلع بالشات نفسو مع زر «جرّب غيرو». الفيديو بيفتح بمشغّل النظام.',
  'نماذجك المخصصة صار إلها نوع (دردشة / صورة / صوت)، بيتخمّن من الاسم وانت بتأكّدو، وبتظهر تحت الزر المناسب.',
  'إعدادات ← الموصّلات: قسم «حسابات مواقع التوليد» بيعرض حالة الدخول لكل موقع مع زر دخول وخروج. Gemini بيسجّل دخول من Chrome لأنو Google بيرفض النافذة المدمجة.',
  'اسم الموديل صار بلون شركتو بقائمة الاختيار وصفحة الموديلات، وفي مربع بحث بصفحة الموديلات.',
  'وكيل فيديو سحابي جديد بصفحة الوكلاء (بدو مفتاح Gemini بفوترة).',
  'تطبيق الموبايل: صفحة «توليد» (من المزيد) لتوليد صورة / فيديو / صوت من التلفون، بينعمل عالكمبيوتر والنتيجة بترجع عالتلفون.',
  'النماذج المخصصة صار فيها نوع «فيديو» كمان (واجهة /videos متل OpenAI Sora).',
  'حسابات مواقع التوليد: إذا حالة الدخول طلعت غلط في زر لتحديد الحالة الحقيقية بإيدك.'
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

