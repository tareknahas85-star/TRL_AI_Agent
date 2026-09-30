import { useEffect, useState } from 'react'

export function ComputerPanel() {
  const [st, setSt] = useState<{ enabled: boolean; sessionAllowed: boolean }>({ enabled: false, sessionAllowed: false })

  useEffect(() => {
    void window.api.computer.get().then(setSt)
  }, [])

  const toggle = async (): Promise<void> => setSt(await window.api.computer.set(!st.enabled))
  const reset = async (): Promise<void> => setSt(await window.api.computer.reset())

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">التحكم بالجهاز (Computer Control)</h3>
          <p className="mt-1 text-sm text-gray-500">
            يخلي النماذج تشغّل أوامر PowerShell، تقرأ الملفات، تفتح البرامج، وتضغط وتكتب على الشاشة. مطفي افتراضياً وكل إجراء
            بيطلب موافقتك.
          </p>
        </div>
        <button
          onClick={toggle}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white ${st.enabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-500 hover:bg-gray-600'}`}
        >
          {st.enabled ? 'مفعّل' : 'معطّل'}
        </button>
      </div>
      {st.enabled && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>{st.sessionAllowed ? 'الموافقة لكل الجلسة مفعّلة (ما رح يسألك مرة تانية).' : 'كل إجراء بيطلب موافقتك.'}</span>
          {st.sessionAllowed && (
            <button onClick={reset} className="rounded border border-amber-400 px-2 py-1 text-xs hover:bg-amber-100">
              إلغاء موافقة الجلسة
            </button>
          )}
        </div>
      )}
      <ul className="mt-3 list-disc space-y-1 pr-5 text-xs text-gray-500">
        <li>الأوامر للقراءة فقط (Get-*, dir...) بتشتغل مباشرة، وغيرها بيسألك.</li>
        <li>محجوب دائماً: الحذف، إطفاء الجهاز، حذف الريجستري، التنزيل، وتغيير سياسات النظام.</li>
        <li>ما بيتعامل مع نوافذ UAC وكلمات السر وأمان ويندوز، ولا بيقرأ ملفات المفاتيح.</li>
        <li>يشتغل بشجرة عناصر الواجهة (UI Automation) فيمشي مع أي نموذج نصي.</li>
      </ul>
    </div>
  )
}
