import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { MasterMemoryView, ProjectMemoryInfo } from '../preload/index.d'
import { Chip, Empty, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

function ProjectCard({ p, onSaved }: { p: ProjectMemoryInfo; onSaved: () => void }) {
  const [summary, setSummary] = useState(p.summary)
  const [ports, setPorts] = useState(p.ports.join(', '))
  const [tech, setTech] = useState(p.tech.join(', '))
  useEffect(() => {
    setSummary(p.summary)
    setPorts(p.ports.join(', '))
    setTech(p.tech.join(', '))
  }, [p.summary, p.ports, p.tech])
  const dirty = summary !== p.summary || ports !== p.ports.join(', ') || tech !== p.tech.join(', ')
  const split = (v: string): string[] => v.split(/[,،]/).map((x) => x.trim()).filter(Boolean)
  return (
    <div className={cardCls + ' space-y-2'}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{p.name}</span>
        <span className="text-[11px] text-muted">{new Date(p.updatedAt).toLocaleString('ar')}</span>
      </div>
      <textarea className={inputCls + ' min-h-[60px]'} placeholder="ملخص المشروع" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div className="flex gap-2">
        <input className={inputCls} dir="ltr" placeholder="tech: docker, node…" value={tech} onChange={(e) => setTech(e.target.value)} />
        <input className={inputCls} dir="ltr" placeholder="ports: 3000, 8080" value={ports} onChange={(e) => setPorts(e.target.value)} />
      </div>
      {p.decisions.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted">قرارات مسجّلة:</div>
          {p.decisions.map((d, i) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-xl bg-surface2 px-3 py-1.5 text-xs">
              <span>{d}</span>
              <button
                aria-label="حذف القرار"
                className="text-muted hover:text-danger"
                onClick={async () => {
                  await window.api.masterMemory.update(p.id, { decisions: p.decisions.filter((_, j) => j !== i) })
                  onSaved()
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {dirty && (
        <button
          className={primaryBtn}
          onClick={async () => {
            await window.api.masterMemory.update(p.id, {
              summary,
              tech: split(tech),
              ports: split(ports).map(Number).filter((n) => Number.isInteger(n))
            })
            onSaved()
          }}
        >
          حفظ
        </button>
      )}
    </div>
  )
}

export function MasterMemoryPanel() {
  const [data, setData] = useState<MasterMemoryView | null>(null)
  const load = useCallback(() => window.api.masterMemory.get().then(setData), [])
  useEffect(() => {
    void load()
  }, [load])
  if (!data) return null
  return (
    <section className="mb-6">
      <h3 className="mb-1 text-base font-semibold">الذاكرة الرئيسية (كل المشاريع)</h3>
      <p className="mb-3 text-xs text-muted">
        نظرة شاملة عن كل مشاريعك بتنحقن بكل محادثة، فالموديل بيعرف باقي المشاريع وبينبهك لأي تعارض (منفذ مكرر، قرار متناقض…). بتتحدث تلقائي من محادثاتك وبتقدر تعدّلها.
      </p>
      {data.conflicts.length > 0 && (
        <div className="mb-3 rounded-card border border-warning/50 bg-warning/10 p-3 text-xs">
          {data.conflicts.map((c, i) => (
            <div key={i}>⚠️ {c.detail}</div>
          ))}
        </div>
      )}
      {data.projects.length === 0 ? (
        <Empty text="ما في مشاريع بعد — ضيف مشروع من صفحة المشاريع" />
      ) : (
        <div className="space-y-2">
          {data.projects.map((p) => (
            <ProjectCard key={p.id} p={p} onSaved={load} />
          ))}
        </div>
      )}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">مواضيع أخيرة خارج المشاريع</span>
          {data.general.length > 0 && (
            <button
              className={ghostBtn + ' text-danger'}
              onClick={async () => {
                await window.api.masterMemory.clearGeneral()
                load()
              }}
            >
              مسح
            </button>
          )}
        </div>
        {data.general.length === 0 ? (
          <p className="text-xs text-muted">لا شي بعد.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.general.slice(-10).map((g, i) => (
              <Chip key={i}>{g.text}</Chip>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
