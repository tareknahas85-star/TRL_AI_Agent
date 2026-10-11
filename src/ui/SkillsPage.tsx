import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SkillInfo } from '../preload/index.d'
import { Empty, Modal, PageShell, Toggle, ghostBtn, inputCls, primaryBtn } from './components/ui'

const TEMPLATE = '# اسم السكيل\n\nاكتب هون تعليمات السكيل (System Prompt)...\n'

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState(TEMPLATE)
  const [error, setError] = useState('')

  const load = useCallback(() => window.api.skills.list().then(setSkills), [])
  useEffect(() => {
    load()
  }, [load])

  const create = async (): Promise<void> => {
    const r = await window.api.skills.create(name.trim(), content)
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setName('')
    setContent(TEMPLATE)
    setError('')
    load()
  }

  return (
    <PageShell
      title="السكيلز"
      subtitle="تعليمات جاهزة الماستر بيختارها لحاله حسب الطلب (coding / research / file) أو ضيف سكيلك."
      action={
        <button className={primaryBtn + ' flex items-center gap-1'} onClick={() => setAdding(true)}>
          <Plus size={16} /> ضيف سكيل
        </button>
      }
    >
      {skills.length === 0 ? (
        <Empty text="ما في سكيلز - ضيف واحد" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((s) => (
            <div key={s.name} className="flex flex-col rounded-card border border-outline bg-surface p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.name}</div>
                  <div className="truncate text-xs text-muted">{s.description}</div>
                </div>
                <Toggle
                  checked={s.enabled}
                  label={`تفعيل ${s.name}`}
                  onChange={async () => {
                    await window.api.skills.toggle(s.name)
                    load()
                  }}
                />
              </div>
              <pre dir="auto" className="mt-3 line-clamp-4 flex-1 whitespace-pre-wrap text-xs text-muted">
                {s.content.slice(0, 220)}
              </pre>
              <button
                className={ghostBtn + ' mt-3 flex items-center gap-1 self-end text-danger'}
                onClick={async () => {
                  if (confirm(`بدك تحذف السكيل ${s.name}؟`)) {
                    await window.api.skills.delete(s.name)
                    load()
                  }
                }}
              >
                <Trash2 size={14} /> حذف
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <Modal title="ضيف سكيل" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <input dir="ltr" className={inputCls} placeholder="skill-name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea dir="auto" rows={10} className={inputCls + ' font-mono'} value={content} onChange={(e) => setContent(e.target.value)} />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!name.trim() || !content.trim()} onClick={create}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
