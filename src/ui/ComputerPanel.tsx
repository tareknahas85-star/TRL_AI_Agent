import { useEffect, useState } from 'react'

export function ComputerPanel() {
  const [st, setSt] = useState<{ enabled: boolean; sessionAllowed: boolean; autoApprove: boolean }>({ enabled: false, sessionAllowed: false, autoApprove: true })

  useEffect(() => {
    void window.api.computer.get().then(setSt)
  }, [])

  const unsupported = !navigator.userAgent.includes('Windows') // PowerShell-based: Windows only for now
  const toggle = async (): Promise<void> => setSt(await window.api.computer.set(!st.enabled))
  const reset = async (): Promise<void> => setSt(await window.api.computer.reset())

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">التحكم بالجهاز (Computer Control)</h3>
          <p className="mt-1 text-sm text-gray-500">
            يخلي الموديلات تشغّل أوامر PowerShell، تقرأ الملفات، تفتح البرامج، وتضغط وتكتب على الشاشة. مطفي افتراضي وكل إجراء
            بيطلب موافقتك.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={unsupported}
          title={unsupported ? 'مش مدعوم على هالنظام هلق (ويندوز بس)' : undefined}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${st.enabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-500 hover:bg-gray-600'}`}
        >
          {st.enabled ? 'مفعّل' : 'معطّل'}
        </button>
      </div>
      {unsupported && (
        <p className="mt-2 text-xs text-amber-600">التحكم بالجهاز خاص بويندوز هلق، مش متاح على لينكس بهالنسخة.</p>
      )}
      {st.enabled && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>{st.autoApprove ? 'موافقة تلقائية مفعّلة: البرنامج بينفّذ بدون ما يسألك (المحجوب يبقى محجوب).' : st.sessionAllowed ? 'الموافقة لكل الجلسة مفعّلة (ما رح يسألك مرة تانية).' : 'كل إجراء بيطلب موافقتك.'}</span>
          <button onClick={async () => setSt(await window.api.computer.setAuto(!st.autoApprove))} className="rounded border border-amber-400 px-2 py-1 text-xs hover:bg-amber-100">
            {st.autoApprove ? 'رجّع السؤال' : 'فعّل الموافقة التلقائية'}
          </button>
          {st.sessionAllowed && (
            <button onClick={reset} className="rounded border border-amber-400 px-2 py-1 text-xs hover:bg-amber-100">
              إلغاء موافقة الجلسة
            </button>
          )}
        </div>
      )}
      <ul className="mt-3 list-disc space-y-1 pr-5 text-xs text-gray-500">
        <li>الأوامر للقراءة بس (Get-*, dir...) بتشتغل مباشرة، وغيرها بيسألك.</li>
        <li>محجوب دايماً: الحذف، إطفاء الجهاز، حذف الريجستري، التنزيل، وتغيير سياسات النظام.</li>
        <li>ما بيتعامل مع نوافذ UAC وكلمات السر وأمان ويندوز، ولا بيقرأ ملفات المفاتيح.</li>
        <li>يشتغل بشجرة عناصر الواجهة (UI Automation) فيمشي مع أي موديل نصي.</li>
      </ul>
    </div>
  )
}
