import { useState, useEffect } from 'react'
import { Modal, PageShell, inputCls } from './components/ui'
import { MemoryPanel } from './MemoryPanel'
import { MasterMemoryPanel } from './MasterMemoryPanel'
import { AccountsPanel } from './AccountsPanel'
import { ComputerPanel } from './ComputerPanel'
import { TelegramPanel } from './TelegramPanel'
import { SpendPanel } from './SpendPanel'
import { ClaudeAccountsPanel } from './ClaudeAccountsPanel'

const KEY_NAMES = ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
type KeyName = (typeof KEY_NAMES)[number]

const TABS = [
  { id: 'general', label: 'عام' },
  { id: 'connectors', label: 'الموصلات' },
  { id: 'memory', label: 'الذاكرة' }
] as const
type TabId = (typeof TABS)[number]['id']

export function Settings({ onClose, variant = 'modal' }: { onClose?: () => void; variant?: 'modal' | 'page' | 'inline' }) {
  const [tab, setTab] = useState<TabId>(() => {
    try {
      const v = localStorage.getItem('air.settings.tab')
      return TABS.some((t) => t.id === v) ? (v as TabId) : 'general'
    } catch {
      return 'general'
    }
  })
  const pickTab = (id: TabId): void => {
    setTab(id)
    try {
      localStorage.setItem('air.settings.tab', id)
    } catch {
      /* storage unavailable */
    }
  }
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
      <PageShell title="الإعدادات" subtitle="عام • الموصلات • الذاكرة">
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTab(t.id)}
              className={'rounded-full px-4 py-1.5 text-sm ' + (tab === t.id ? 'bg-primary text-white' : 'border border-outline hover:bg-surface2')}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'general' && (
          <>
            <SpendPanel />
            <ClaudeAccountsPanel />
            <ComputerPanel />
            <TelegramPanel />
          </>
        )}
        {tab === 'connectors' && <AccountsPanel />}
        {tab === 'memory' && (
          <>
            <MasterMemoryPanel />
            <MemoryPanel />
          </>
        )}
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
