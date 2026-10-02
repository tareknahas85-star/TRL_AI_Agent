import { useEffect, useState } from 'react'

export function SpendPanel() {
  const [on, setOn] = useState(true)
  useEffect(() => {
    void window.api.spend.get().then(setOn)
  }, [])
  const toggle = async (): Promise<void> => setOn(await window.api.spend.set(!on))
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">مجاني بس</h3>
          <p className="mt-1 text-sm text-gray-500">
            وهو مفعّل، الراوتر بيجرّب موديلات الطبقة المجانية بس، ومستحيل يمر على موديل مدفوع (رخيص أو قوي). طفّيه بس لما بدك تسمح بالمدفوع.
          </p>
        </div>
        <button
          onClick={toggle}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white ${on ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
        >
          {on ? 'مجاني بس' : 'المدفوع مسموح'}
        </button>
      </div>
    </div>
  )
}
