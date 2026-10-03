import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, Lock, Plus, Trash2 } from 'lucide-react'
import type { ProjectInfo } from '../preload/index.d'
import { Chip, Empty, PageShell, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

export function ProjectsPage({ onChanged, onOpen, openIds }: { onChanged: () => void; onOpen: (p: ProjectInfo) => void; openIds: string[] }) {
  const [data, setData] = useState<{ projects: ProjectInfo[]; activeId: string | null }>({ projects: [], activeId: null })
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => window.api.projects.list().then(setData), [])
  useEffect(() => {
    load()
  }, [load])
  const changed = (): void => {
    load()
    onChanged()
  }

  return (
    <PageShell
      title="المشاريع"
      subtitle="ضيف مجلدات مشاريعك. كبسة على 'فتح' بتفتح تبويب خاص بالمشروع: الموديل بيشوف ملفاته وبيقرأها، وباقي التبويبات مستقلة عنه."
      action={
        <button
          className={primaryBtn + ' flex items-center gap-1'}
          onClick={async () => {
            const r = await window.api.projects.pick()
            if (r.ok) changed()
            else if (r.error !== 'cancelled') setError(r.error ?? 'خطأ')
          }}
        >
          <FolderOpen size={16} /> اختار مجلد
        </button>
      }
    >
      <div className="mb-4 flex gap-2">
        <input dir="ltr" className={inputCls + ' font-mono'} placeholder="أو الصق مسار المجلد: C:\Projects\my-app" value={path} onChange={(e) => setPath(e.target.value)} />
        <button
          className={primaryBtn + ' flex items-center gap-1'}
          disabled={!path.trim()}
          onClick={async () => {
            const r = await window.api.projects.add(path.trim())
            if (!r.ok) return setError(r.error ?? 'خطأ')
            setPath('')
            setError('')
            changed()
          }}
        >
          <Plus size={16} /> ضيف
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {data.projects.length === 0 ? (
        <Empty text="ما في مشاريع - اختار مجلد مشروعك" />
      ) : (
        <div className="space-y-2">
          {data.projects.map((p) => {
            const active = openIds.includes(p.id)
            return (
              <div key={p.id} className={cardCls + ` flex items-center justify-between gap-3 ${active ? 'ring-2 ring-primary' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {active && <Chip cls="bg-primary/15 text-primary"><CheckCircle2 size={12} /> مفتوح بتبويب</Chip>}
                    {p.confidential && <Chip cls="bg-warning/20 text-warning"><Lock size={12} /> سري — موديلات مدفوعة قوية بس</Chip>}
                  </div>
                  <div dir="ltr" className="truncate text-start font-mono text-xs text-muted">{p.path}</div>
                </div>
                <div className="flex gap-1">
                  <button
                    className={ghostBtn}
                    title="المشروع السري بيستعمل بس موديلات مدفوعة قوية، والتحليل محلي"
                    onClick={async () => {
                      await window.api.projects.setConfidential(p.id, !p.confidential)
                      changed()
                    }}
                  >
                    {p.confidential ? 'شيل السرية' : '🔒 مشروع سري'}
                  </button>
                  <button
                    className={ghostBtn}
                    onClick={() => onOpen(p)}
                  >
                    {active ? 'روح عالتبويب' : 'فتح'}
                  </button>
                  <button
                    className={ghostBtn + ' text-danger'}
                    aria-label={`شيل ${p.name}`}
                    onClick={async () => {
                      if (confirm(`بدك تشيل المشروع ${p.name} من القائمة؟ (ما بينحذف من جهازك)`)) {
                        await window.api.projects.remove(p.id)
                        changed()
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
