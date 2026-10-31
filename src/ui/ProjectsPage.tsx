import { Fragment, useCallback, useEffect, useState } from 'react'
import { askConfirm } from './components/confirm'
import { CheckCircle2, ChevronDown, ChevronLeft, FolderOpen, Lock, Plus, Trash2 } from 'lucide-react'
import type { ConversationSummary, ProjectInfo } from '../preload/index.d'
import { Chip, Empty, PageShell, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

export function ProjectsPage({ onChanged, onOpen, openIds, convs, onOpenConv, onNewInProject }: { onChanged: () => void; onOpen: (p: ProjectInfo) => void; openIds: string[]; convs: ConversationSummary[]; onOpenConv: (id: string) => void; onNewInProject: (p: ProjectInfo) => void }) {
  const [data, setData] = useState<{ projects: ProjectInfo[]; activeId: string | null }>({ projects: [], activeId: null })
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<string | null>(null)
  const [files, setFiles] = useState<{ n: string; d: boolean; s?: number }[] | null>(null)
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => {
    setFiles(null)
    setQ('')
    if (view) void window.api.projects.files(view).then((r) => setFiles(r.items))
  }, [view])
  const load = useCallback(() => window.api.projects.list().then(setData), [])
  useEffect(() => {
    load()
  }, [load])
  const changed = (): void => {
    load()
    onChanged()
  }

  const vp = view ? data.projects.find((p) => p.id === view) : undefined
  if (vp) {
    const mineAll = convs.filter((c) => c.projectId === vp.id).sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))
    const mineShown = q.trim() ? mineAll.filter((c) => (c.title || '').toLowerCase().includes(q.trim().toLowerCase())) : mineAll
    const openHere = openIds.includes(vp.id)
    return (
      <PageShell
        title={vp.name}
        subtitle="صفحة المشروع: معلوماته ومحادثاته وملفاته."
        action={
          <button className={ghostBtn} onClick={() => setView(null)}>
            ← كل المشاريع
          </button>
        }
      >
        <div className={cardCls + ' mb-3 space-y-2'}>
          <div dir="ltr" className="truncate text-start font-mono text-xs text-muted">{vp.path}</div>
          <div className="flex flex-wrap items-center gap-2">
            {openHere && <Chip cls="bg-primary/15 text-primary"><CheckCircle2 size={12} /> مفتوح بتبويب</Chip>}
            {vp.confidential && <Chip cls="bg-warning/20 text-warning"><Lock size={12} /> سري</Chip>}
            <button className={primaryBtn} onClick={() => onOpen(vp)}>{openHere ? 'روح عالتبويب' : 'فتح بتبويب'}</button>
            <button className={ghostBtn} onClick={() => onNewInProject(vp)}><Plus size={14} /> محادثة جديدة</button>
          </div>
        </div>
        <div className={cardCls + ' mb-3'}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold">المحادثات ({mineAll.length})</span>
            <input className={inputCls + ' max-w-xs'} placeholder="بحث بالعناوين" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-1">
            {mineShown.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{c.title || 'محادثة بدون عنوان'}</span>
                <button className={ghostBtn} onClick={() => onOpenConv(c.id)}>كمّل</button>
              </div>
            ))}
            {mineShown.length === 0 && <p className="text-xs text-muted">ما في محادثات.</p>}
          </div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 font-semibold">الملفات</div>
          {vp.confidential ? (
            <p className="text-xs text-muted">🔒 مشروع سري: ما بنعرض ملفاته هون.</p>
          ) : files === null ? (
            <p className="text-xs text-muted">عم يحمّل…</p>
          ) : files.length === 0 ? (
            <p className="text-xs text-muted">المجلد فاضي.</p>
          ) : (
            <div dir="ltr" className="max-h-96 space-y-0.5 overflow-auto text-start font-mono text-xs">
              {files.map((f) => (
                <div key={f.n} className="truncate">
                  {f.d ? '📁 ' : '📄 '}
                  {f.n}
                  {f.s != null ? ' · ' + Math.max(1, Math.round(f.s / 1024)) + ' KB' : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      </PageShell>
    )
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
            const isOpen = expanded.has(p.id)
            const mine = convs.filter((c) => c.projectId === p.id).sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))
            return (
              <Fragment key={p.id}><div className={cardCls + ` flex items-center justify-between gap-3 ${active ? 'ring-2 ring-primary' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button className="font-semibold hover:underline" title="صفحة المشروع" onClick={() => setView(p.id)}>{p.name}</button>
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
                  <button className={ghostBtn} onClick={() => setView(p.id)}>
                    صفحة المشروع
                  </button>
                  <button
                    className={ghostBtn + ' text-danger'}
                    aria-label={`شيل ${p.name}`}
                    onClick={async () => {
                      if (await askConfirm(`بدك تشيل المشروع ${p.name} من القائمة؟ (ما بينحذف من جهازك)`)) {
                        await window.api.projects.remove(p.id)
                        changed()
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mb-2 mr-4 space-y-1 border-r-2 border-outline pr-3">
                <div className="flex items-center gap-2">
                  <button
                    className={ghostBtn + ' flex items-center gap-1'}
                    aria-expanded={isOpen}
                    title={isOpen ? 'طوي المحادثات' : 'اعرض المحادثات القديمة'}
                    onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronLeft size={14} />} المحادثات ({mine.length})
                  </button>
                  <button className={ghostBtn} onClick={() => onNewInProject(p)}>
                    <Plus size={14} /> محادثة جديدة
                  </button>
                </div>
                {isOpen && mine.slice(0, 30).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{c.title || 'محادثة بدون عنوان'}</span>
                    <button className={ghostBtn} onClick={() => onOpenConv(c.id)}>كمّل</button>
                  </div>
                ))}
                {isOpen && mine.length === 0 && <p className="text-xs text-muted">ما في محادثات سابقة بهالمشروع</p>}
                {isOpen && mine.length > 30 && <p className="text-xs text-muted">… و{mine.length - 30} محادثة أقدم (من صفحة المشروع)</p>}
              </div>            </Fragment>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
