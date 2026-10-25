import { useEffect, useState, type ReactElement } from 'react'
import { Modal } from './components/ui'

const VERSION = '5.17.6'
const SEEN = 'air.whatsnew.seen'
const NOTES: string[] = [
  'البحث عن أماكن قريبة صار يحسب «فاتحة هلأ / مسكّرة هلأ» من ساعات OpenStreetMap، وفي خيار يخبي المسكّر. وما عاد الموديل يضيّع وقت بأوامر بحث عن الساعات.',
  'الموبايل: قسم «النتائج» جوّا تاب الوكلاء. أي وكيل بيخلص (مجدول أو من أي مكان) بتطلع نتيجتو بالتلفون مع إشعار، بدون تيليغرام.',
  'زر لإسكات تيليغرام (النتائج بتضل عالتلفون) وزر «أوقف كل المهام» من الموبايل.',
  'صفحة الملاحظات مشتركة مع الموبايل، والرد بيوصل للتلفون بعد انقطاع الاتصال.'
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

