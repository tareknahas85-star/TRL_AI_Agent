import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

const KEY_NAMES = ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
type KeyName = (typeof KEY_NAMES)[number]

export function Settings({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<Record<KeyName, string>>({
    OPENROUTER_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: ''
  })

  useEffect(() => {
    Promise.all(KEY_NAMES.map((k) => window.api.getKey(k))).then((values) => {
      setKeys({
        OPENROUTER_API_KEY: values[0],
        GEMINI_API_KEY: values[1],
        OPENAI_API_KEY: values[2],
        ANTHROPIC_API_KEY: values[3]
      })
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = (k: KeyName, v: string) => {
    window.api.setKey(k, v)
    setKeys((prev) => ({ ...prev, [k]: v }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 text-[#0d0d0d] shadow-xl dark:bg-[#2f2f2f] dark:text-[#ececec]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">الإعدادات</h3>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          المفاتيح {keys.OPENROUTER_API_KEY ? '✅' : '❌ OpenRouter مطلوب'}
        </p>
        <div className="space-y-3">
          {KEY_NAMES.map((k) => (
            <div key={k}>
              <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">{k}</label>
              <input
                type="password"
                value={keys[k]}
                onChange={(e) => save(k, e.target.value)}
                placeholder={k}
                className="w-full rounded-lg border-none bg-[#f4f4f4] p-3 text-sm outline-none dark:bg-[#424242]"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
