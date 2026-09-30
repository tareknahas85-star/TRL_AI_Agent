import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import type { ToolInfo } from '../preload/index.d'
import { Chip, Modal, PageShell, Toggle, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

export function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', command: '' })
  const [error, setError] = useState('')
  const load = useCallback(() => window.api.tools.list().then(setTools), [])
  useEffect(() => {
    load()
  }, [load])

  const add = async (): Promise<void> => {
    const r = await window.api.tools.add({
      name: form.name.trim(),
      description: form.description.trim(),
      command: form.command.trim()
    })
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setForm({ name: '', description: '', command: '' })
    setError('')
    load()
  }

  return (
    <PageShell
      title="الأدوات"
      subtitle="الأدوات المتاحة للنظام. فعّل أو عطّل كل أداة، أو أضف أداتك."
      action={
        <button className={primaryBtn + ' flex items-center gap-1'} onClick={() => setAdding(true)}>
          <Plus size={16} /> إضافة أداة
        </button>
      }
    >
      <div className="mb-4 flex items-start gap-2 rounded-card border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <span>تحذير: الأداة runCommand وأدواتك المخصصة بتنفذ أوامر على جهازك وتحتاج موافقتك قبل التنفيذ. عطّل اللي ما بدك ياه.</span>
      </div>
      <div className="space-y-2">
        {tools.map((t) => (
          <div key={t.name} className={cardCls + ' flex items-center justify-between gap-3'}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span dir="ltr" className="font-mono text-sm font-semibold">{t.name}</span>
                {t.custom && <Chip cls="bg-primary/15 text-primary">مخصصة</Chip>}
              </div>
              <div className="text-xs text-muted">{t.description}</div>
              {t.custom && t.command && (
                <div dir="ltr" className="mt-1 truncate text-start font-mono text-xs text-muted">$ {t.command}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {t.custom && (
                <button
                  className={ghostBtn + ' text-danger'}
                  aria-label={`حذف ${t.name}`}
                  onClick={async () => {
                    if (confirm(`حذف الأداة ${t.name}؟`)) {
                      await window.api.tools.remove(t.name)
                      load()
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <Toggle
                checked={t.enabled}
                label={`تفعيل ${t.name}`}
                onChange={async () => {
                  await window.api.tools.toggle(t.name)
                  load()
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <Modal title="إضافة أداة" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <input dir="ltr" className={inputCls} placeholder="name (e.g. gitStatus)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} placeholder="الوصف: شو بتعمل الأداة" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input dir="ltr" className={inputCls + ' font-mono'} placeholder="command (e.g. git status --short)" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!form.name.trim() || !form.command.trim()} onClick={add}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
