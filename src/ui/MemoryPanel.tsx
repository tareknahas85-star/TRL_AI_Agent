import { useEffect, useState } from 'react'
import { Chip, Empty, Toggle, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

type Entry = { id: string; title: string; content: string; enabled: boolean; source?: string }

export function MemoryPanel() {
  const [items, setItems] = useState<Entry[]>([])
  const [editing, setEditing] = useState<{ id?: string; title: string; content: string } | null>(null)
  const [preview, setPreview] = useState<{ count: number; chars: number; truncated: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [importing, setImporting] = useState(false)
  const [raw, setRaw] = useState('')

  const setAll = async (on: boolean): Promise<void> => {
    for (const m of items) if (m.enabled !== on) await window.api.memory.save({ id: m.id, title: m.title, content: m.content, enabled: on })
    await load()
  }

  // Accepts a JSON array [{title,content}] or plain text blocks separated by lines starting with "## title".
  const runImport = async (): Promise<void> => {
    let entries: { title: string; content: string }[] = []
    try {
      const j = JSON.parse(raw)
      if (Array.isArray(j)) entries = j.map((x) => ({ title: String(x.title ?? ''), content: String(x.content ?? '') }))
    } catch {
      entries = raw
        .split(/^##\s+/m)
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b) => {
          const nl = b.indexOf('\n')
          return nl < 0 ? { title: b, content: b } : { title: b.slice(0, nl).trim(), content: b.slice(nl + 1).trim() }
        })
    }
    const n = await window.api.memory.import(entries, 'import')
    setErr(n ? '' : 'ما انستورد أي مدخل — تأكد من الصيغة')
    if (n) {
      setRaw('')
      setImporting(false)
    }
    await load()
  }

  const load = async (): Promise<void> => {
    setItems(await window.api.memory.list())
    const p = await window.api.memory.preview()
    setPreview({ count: p.count, chars: p.text.length, truncated: p.truncated })
  }
  useEffect(() => {
    void load()
  }, [])

  const save = async (): Promise<void> => {
    if (!editing) return
    const r = await window.api.memory.save(editing)
    if (!r.ok) return setErr(r.error ?? 'خطأ')
    setErr('')
    setEditing(null)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">الذاكرة</div>
            <p className="mt-1 text-xs text-muted">
              المدخلات المفعّلة بتنضاف لتعليمات الموديل مع كل رسالة (حد أقصى ~6000 حرف). ما بتنبعت للماستر، بس للموديل
              اللي بيجاوب.
            </p>
            {preview && (
              <p className="mt-1 text-xs text-muted">
                داخل بالطلب هلق: {preview.count} مدخل ({preview.chars} حرف){preview.truncated ? ' — في مدخلات انقطعت بسبب الحد' : ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <button className={ghostBtn} onClick={() => setAll(false)}>
              تعطيل الكل
            </button>
            <button className={ghostBtn} onClick={() => setAll(true)}>
              تفعيل الكل
            </button>
            <button className={ghostBtn} onClick={() => setImporting(!importing)}>
              استيراد
            </button>
            <button className={primaryBtn} onClick={() => setEditing({ title: '', content: '' })}>
              + ضيف
            </button>
          </div>
        </div>
      </div>

      {importing && (
        <div className={cardCls}>
          <p className="mb-2 text-xs text-muted">الصق JSON (مصفوفة title/content) أو نص بكتل تبدأ بسطر "## العنوان".</p>
          <textarea className={inputCls + ' h-40'} dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} />
          {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button className={primaryBtn} onClick={runImport}>
              استيراد
            </button>
            <button className={ghostBtn} onClick={() => setImporting(false)}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className={cardCls}>
          <input
            className={inputCls}
            placeholder="العنوان"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />
          <textarea
            className={inputCls + ' mt-2 h-40'}
            placeholder="المحتوى"
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
          {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button className={primaryBtn} onClick={save}>
              حفظ
            </button>
            <button className={ghostBtn} onClick={() => setEditing(null)}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && <Empty text="ما في مدخلات ذاكرة." />}
      {items.map((m) => (
        <div key={m.id} className={cardCls}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{m.title}</span>
                {m.source && <Chip>{m.source}</Chip>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{m.content}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Toggle
                checked={m.enabled}
                label="تفعيل"
                onChange={async () => {
                  await window.api.memory.toggle(m.id)
                  await load()
                }}
              />
              <button className={ghostBtn} onClick={() => setEditing({ id: m.id, title: m.title, content: m.content })}>
                تعديل
              </button>
              <button
                className={ghostBtn}
                onClick={async () => {
                  await window.api.memory.delete(m.id)
                  await load()
                }}
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
