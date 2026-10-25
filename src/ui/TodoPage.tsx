import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { Empty, PageShell, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

type Item = { id: string; text: string; done: boolean; at: number }
type Filter = 'all' | 'open' | 'done'

const KEY = 'air.todo.items'

// Old storage (browser only). Read once and moved to the shared file so the phone app sees the same list.
function legacy(): Item[] {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v as Item[]).filter((i) => i && typeof i.text === 'string') : []
  } catch {
    return []
  }
}

export function TodoPage() {
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<Filter>('open')

  useEffect(() => {
    let alive = true
    const pull = (): void => void window.api.todo.list().then((l) => alive && setItems(l))
    void window.api.todo.list().then(async (l) => {
      const old = legacy()
      if (l.length === 0 && old.length > 0) {
        const merged = await window.api.todo.op({ op: 'import', items: old })
        try {
          localStorage.removeItem(KEY)
        } catch {
          /* ignore */
        }
        if (alive) setItems(merged)
      } else if (alive) setItems(l)
    })
    const off = window.api.todo.onChanged(pull)
    return () => {
      alive = false
      off()
    }
  }, [])

  const run = (op: unknown): void => void window.api.todo.op(op).then(setItems)

  const add = (): void => {
    // كل سطر بيصير مهمة، فبتقدر تلصق قائمة كاملة مرة وحدة
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
    if (!lines.length) return
    run({ op: 'add', lines })
    setText('')
  }

  const shown = useMemo(
    () => items.filter((i) => (filter === 'all' ? true : filter === 'open' ? !i.done : i.done)),
    [items, filter]
  )
  const open = items.filter((i) => !i.done).length
  const done = items.length - open

  return (
    <PageShell
      title="ملاحظات"
      subtitle="قائمة مهامك الشخصية. محفوظة عندك على الجهاز، ومتزامنة مع تبويب «ملاحظات» بتطبيق الموبايل. كل سطر بتلصقو بيصير مهمة لحاله."
      action={
        done > 0 ? (
          <button className={ghostBtn} onClick={() => run({ op: 'clearDone' })}>
            امسح المنجزة ({done})
          </button>
        ) : undefined
      }
    >
      <div className={cardCls + ' mb-4'}>
        <textarea
          className={inputCls + ' min-h-[64px] resize-y'}
          dir="auto"
          placeholder="اكتب مهمة، أو الصق عدة أسطر ليتحوّل كل سطر لمهمة…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add()
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Ctrl+Enter للإضافة السريعة</span>
          <button className={primaryBtn + ' flex items-center gap-1'} onClick={add} disabled={!text.trim()}>
            <Plus size={16} /> ضيف
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        {(
          [
            ['open', `المتبقي (${open})`],
            ['done', `المنجز (${done})`],
            ['all', `الكل (${items.length})`]
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`rounded-full px-3 py-1 ${filter === id ? 'bg-primary/15 font-medium text-primary' : 'hover:bg-surface2'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty text={items.length === 0 ? 'ما في مهام لسا. ضيف أول وحدة من فوق.' : 'ما في شي بهالتصنيف.'} />
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={i.id} className={cardCls + ' flex items-start gap-3 !p-3'}>
              <button
                aria-label={i.done ? 'رجّعها' : 'خلصت'}
                onClick={() => run({ op: 'toggle', id: i.id })}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  i.done ? 'border-success bg-success text-white' : 'border-outline hover:border-primary'
                }`}
              >
                {i.done && <Check size={13} />}
              </button>
              <span dir="auto" className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-sm ${i.done ? 'text-muted line-through' : ''}`}>
                {i.text}
              </span>
              <button aria-label="احذف" className="shrink-0 text-muted hover:text-danger" onClick={() => run({ op: 'del', id: i.id })}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  )
}