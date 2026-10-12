import { useCallback, useEffect, useMemo, useState } from 'react'
import { askConfirm } from './components/confirm'
import { Plus, Trash2 } from 'lucide-react'
import type { SkillInfo } from '../preload/index.d'
import { Empty, Modal, PageShell, Toggle, ghostBtn, inputCls, primaryBtn } from './components/ui'

/** يطلّع الوصف والنص من سكيل مكتوب بصيغة frontmatter (---) بدل ما نعرض النص الخام. */
function parseSkill(content: string): { description: string; body: string } {
  const m = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { description: '', body: content.trim() }
  const lines = m[1].split('\n')
  const i = lines.findIndex((l) => /^description:/.test(l))
  let desc = ''
  if (i >= 0) {
    const first = lines[i].replace(/^description:\s*/, '').trim()
    if (/^[>|][+-]?$/.test(first) || first === '') {
      const parts: string[] = []
      for (let k = i + 1; k < lines.length && (/^\s/.test(lines[k]) || lines[k] === ''); k++) parts.push(lines[k].trim())
      desc = parts.join(' ').trim()
    } else desc = first.replace(/^["']|["']$/g, '')
  }
  return { description: desc, body: m[2].trim() }
}

const TEMPLATE = '# اسم السكيل\n\nاكتب هون تعليمات السكيل (System Prompt)...\n'

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState(TEMPLATE)
  const [error, setError] = useState('')
  const [warn, setWarn] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(() => window.api.skills.list().then(setSkills), [])
  useEffect(() => {
    load()
  }, [load])

  const parsed = useMemo(() => new Map(skills.map((s) => [s.name, parseSkill(s.content)])), [skills])
  const shown = skills.filter((s) => {
    if (filter === 'on' && !s.enabled) return false
    if (filter === 'off' && s.enabled) return false
    const n = q.trim().toLowerCase()
    if (!n) return true
    const p = parsed.get(s.name)
    return (s.name + ' ' + (p?.description || s.description || '')).toLowerCase().includes(n)
  })
  const onCount = skills.filter((s) => s.enabled).length
  const bulk = async (target: boolean): Promise<void> => {
    const list = shown.filter((s) => s.enabled !== target)
    if (!list.length) return
    const msg = `${target ? 'تفعيل' : 'تعطيل'} ${list.length} سكيل؟`
    if (!(await askConfirm(msg, { danger: false }))) return
    setBulkBusy(true)
    for (const s of list) await window.api.skills.toggle(s.name)
    setBulkBusy(false)
    load()
  }

  const create = async (): Promise<void> => {
    // Safety lint first: show the warnings once; a second click on "save anyway" goes through.
    if (warn.length === 0) {
      const f = await window.api.skills.lint(content)
      if (f.length > 0) return setWarn(f.map((x) => x.message))
    }
    const r = await window.api.skills.create(name.trim(), content)
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setName('')
    setContent(TEMPLATE)
    setError('')
    setWarn([])
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
      {skills.length > 0 && (
        <div className="mb-4 space-y-2">
          <input className={inputCls} placeholder="دوّر على سكيل…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {([['all', `الكل (${skills.length})`], ['on', `مفعّل (${onCount})`], ['off', `معطّل (${skills.length - onCount})`]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className={'rounded-full px-3 py-1 ' + (filter === id ? 'bg-primary text-white' : 'border border-outline hover:bg-surface2')}>
                {label}
              </button>
            ))}
            <span className="ms-auto flex items-center gap-1">
              <button className={ghostBtn + ' !py-1 text-xs'} disabled={bulkBusy} onClick={() => void bulk(true)}>فعّل يلي ظاهر</button>
              <button className={ghostBtn + ' !py-1 text-xs'} disabled={bulkBusy} onClick={() => void bulk(false)}>عطّل يلي ظاهر</button>
            </span>
          </div>
        </div>
      )}
      {skills.length === 0 ? (
        <Empty text="ما في سكيلز - ضيف واحد" />
      ) : shown.length === 0 ? (
        <Empty text="ما في سكيل بيطابق بحثك." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <div key={s.name} className="flex flex-col rounded-card border border-outline bg-surface p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.name}</div>
                  <div className="line-clamp-2 text-xs text-muted" dir="auto">{parsed.get(s.name)?.description || s.description}</div>
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
                {(parsed.get(s.name)?.body ?? s.content).slice(0, 220)}
              </pre>
              <button
                className={ghostBtn + ' mt-3 flex items-center gap-1 self-end text-danger'}
                onClick={async () => {
                  if (await askConfirm(`بدك تحذف السكيل ${s.name}؟`)) {
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
            <textarea dir="auto" rows={10} className={inputCls + ' font-mono'} value={content} onChange={(e) => { setContent(e.target.value); setWarn([]) }} />
            {warn.length > 0 && (
              <div className="rounded-xl border border-danger p-3 text-xs">
                <div className="mb-1 font-semibold text-danger">فحص الأمان لقى {warn.length} ملاحظة. اقرا النص مرة تانية قبل ما تحفظ:</div>
                <ul className="list-disc space-y-1 ps-5">{warn.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!name.trim() || !content.trim()} onClick={create}>{warn.length > 0 ? 'احفظ رغم التحذير' : 'حفظ'}</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
