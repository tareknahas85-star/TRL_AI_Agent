import { useState, useEffect } from 'react'
import { Modal, PageShell, inputCls } from './components/ui'
import { MemoryPanel } from './MemoryPanel'
import { MasterMemoryPanel } from './MasterMemoryPanel'
import { AccountsPanel } from './AccountsPanel'
import { ComputerPanel } from './ComputerPanel'
import { SpendPanel } from './SpendPanel'

const KEY_NAMES = ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
type KeyName = (typeof KEY_NAMES)[number]

export function Settings({ onClose, variant = 'modal' }: { onClose?: () => void; variant?: 'modal' | 'page' | 'inline' }) {
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

  const save = (k: KeyName, v: string): void => {
    window.api.setKey(k, v)
    setKeys((prev) => ({ ...prev, [k]: v }))
  }

  const form = (
    <>
      <p className="mb-4 text-xs text-muted">
        المفاتيح {keys.OPENROUTER_API_KEY ? '✅' : '❌ OpenRouter مطلوب'}
      </p>
      <div className="space-y-3">
        {KEY_NAMES.map((k) => (
          <div key={k}>
            <label className="mb-1 block text-xs text-muted">{k}</label>
            <input
              dir="ltr"
              type="password"
              value={keys[k]}
              onChange={(e) => save(k, e.target.value)}
              placeholder={k}
              className={inputCls}
            />
          </div>
        ))}
      </div>
    </>
  )

  if (variant === 'page') {
    // Keys now live in the Models page; this page is intentionally empty until we decide what goes here.
    return (
      <PageShell title="الإعدادات" subtitle="الذاكرة والتفضيلات.">
        <SpendPanel />
        <ComputerPanel />
        <AccountsPanel />
        <MasterMemoryPanel />
        <MemoryPanel />
      </PageShell>
    )
  }
  if (variant === 'inline') return <div className="max-w-md">{form}</div>
  return (
    <Modal title="الإعدادات" onClose={onClose ?? (() => undefined)}>
      {form}
    </Modal>
  )
}
