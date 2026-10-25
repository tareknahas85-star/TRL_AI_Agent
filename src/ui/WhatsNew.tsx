import { useEffect, useState, type ReactElement } from 'react'
import { Modal } from './components/ui'

const VERSION = '5.17.5'
const SEEN = 'air.whatsnew.seen'
const NOTES: string[] = [
  'صفحة الملاحظات صارت مشتركة مع الموبايل: اكتب ملاحظة من التلفون بتطلع عالكمبيوتر والعكس.',
  'تطبيق الموبايل: ضغطة مطوّلة عرسالتك بتطلّع نسخ / إعادة إرسال / حذف (الحذف عالتلفون بس).',
  'الموبايل: «المشاريع» صار تاب لحالو، واسم المشروع الفعّال ظاهر فوق شاشة الشات.',
  'إذا انقطع الاتصال وسط طلب، الرد بيوصل للتلفون أول ما يرجع الاتصال.',
  'الوكلاء المضبوطين «سحابي بس» بيشتغلوا عالسحابة من الموبايل حتى والكمبيوتر شغّال.',
  'زر إعادة الاتصال بالموبايل صار يعطي رد فعل واضح، والموبايل صار إلو رقم إصدار مستقل.',
  'اهتمامات جديدة بالإعداد الأول: وكلاء وأتمتة، وإيميل وتواصل.'
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

