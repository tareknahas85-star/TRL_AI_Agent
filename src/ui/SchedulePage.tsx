import { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import type { ProjectInfo, ScheduleInfo } from '../preload/index.d'
import { Chip, Empty, Modal, PageShell, Toggle, cardCls, ghostBtn, inputCls, primaryBtn } from './components/ui'

const DAYS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const blank = { name: '', prompt: '', projectId: '', mode: 'auto' as 'auto' | 'free', kind: 'daily' as ScheduleInfo['kind'], time: '12:00', days: [] as number[], everyMin: 60 }

function when(t: ScheduleInfo): string {
  if (t.kind === 'interval') return `كل ${t.everyMin >= 60 && t.everyMin % 60 === 0 ? t.everyMin / 60 + ' ساعة' : t.everyMin + ' دقيقة'}`
  if (t.kind === 'weekly') return `كل ${t.days.map((d) => DAYS[d]).join('، ')} الساعة ${t.time}`
  return `كل يوم الساعة ${t.time}`
}

export function SchedulePage() {
  const [tasks, setTasks] = useState<ScheduleInfo[]>([])
  const [running, setRunning] = useState<string[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const r = await window.api.schedules.list()
    setTasks(r.tasks)
    setRunning(r.running)
  }, [])
  useEffect(() => {
    void load()
    void window.api.projects.list().then((d) => setProjects(d.projects))
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [load])

  const save = async (): Promise<void> => {
    const r = await window.api.schedules.add({ ...form, projectId: form.projectId || null })
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setForm(blank)
    setError('')
    void load()
  }

  return (
    <PageShell
      title="المهام المجدولة"
      subtitle="اعطيه أمر مرة وحدة وهو بينفذو بالوقت اللي بتحدده (مثلاً كل يوم 12 الضهر). البرنامج لازم يكون شغّال (حتى لو مصغّر بجنب الساعة)؛ إذا كان مسكّر وقت الموعد بينفذ المهمة أول ما ينفتح (خلال 12 ساعة)."
      action={
        <button className={primaryBtn + ' flex items-center gap-1'} onClick={() => setAdding(true)}>
          <Plus size={16} /> مهمة جديدة
        </button>
      }
    >
      {tasks.length === 0 ? (
        <Empty text="ما في مهام مجدولة - ضيف أول مهمة" />
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => {
            const isRun = running.includes(t.id) || t.lastStatus === 'running'
            const proj = projects.find((p) => p.id === t.projectId)
            return (
              <div key={t.id} className={cardCls}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Clock size={14} className="text-muted" />
                      <span className="font-semibold">{t.name}</span>
                      <Chip cls="bg-primary/15 text-primary">{when(t)}</Chip>
                      {proj && <Chip cls="bg-surface2 text-fg">{proj.name}</Chip>}
                      <Chip cls="bg-surface2 text-fg">{t.mode === 'free' ? 'مجاني' : 'تلقائي'}</Chip>
                      {isRun && (
                        <Chip cls="bg-warning/20 text-warning">
                          <Loader2 size={12} className="animate-spin" /> عم ينفّذ
                        </Chip>
                      )}
                      {!isRun && t.lastStatus === 'ok' && <Chip cls="bg-success/15 text-success">آخر تنفيذ نجح</Chip>}
                      {!isRun && t.lastStatus === 'failed' && <Chip cls="bg-danger/15 text-danger">آخر تنفيذ فشل</Chip>}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted">{t.prompt}</div>
                    {t.lastRun && <div className="text-[11px] text-muted">آخر تشغيل: {new Date(t.lastRun).toLocaleString('ar')}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Toggle
                      checked={t.enabled}
                      label={`تفعيل ${t.name}`}
                      onChange={async () => {
                        await window.api.schedules.update(t.id, { enabled: !t.enabled })
                        void load()
                      }}
                    />
                    <button className={ghostBtn + ' flex items-center gap-1'} disabled={isRun} onClick={async () => { await window.api.schedules.run(t.id); setTimeout(() => void load(), 500) }}>
                      <Play size={14} /> نفّذ هلأ
                    </button>
                    <button className={ghostBtn} onClick={() => setOpen(open === t.id ? null : t.id)}>
                      النتيجة
                    </button>
                    <button
                      className={ghostBtn + ' text-danger'}
                      aria-label={`حذف ${t.name}`}
                      onClick={async () => {
                        if (confirm(`بدك تحذف المهمة ${t.name}؟`)) {
                          await window.api.schedules.remove(t.id)
                          void load()
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {open === t.id && (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-surface2 p-3 text-xs">{t.lastResult || 'ما في نتيجة بعد. (النتائج كمان بتنحفظ كمحادثة بقائمة المحادثات)'}</pre>
                )}
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <Modal title="مهمة مجدولة جديدة" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <input className={inputCls} placeholder="اسم المهمة (مثلاً: ملخص الإيميلات)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <textarea rows={4} className={inputCls} placeholder="شو بدك ينفّذ؟ اكتبها متل ما بتكتب بالمحادثة" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select className={inputCls + ' w-auto'} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ScheduleInfo['kind'] })}>
                <option value="daily">كل يوم</option>
                <option value="weekly">أيام محددة</option>
                <option value="interval">كل فترة</option>
              </select>
              {form.kind !== 'interval' ? (
                <input type="time" dir="ltr" className={inputCls + ' w-auto'} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              ) : (
                <>
                  <span>كل</span>
                  <input type="number" min={5} dir="ltr" className={inputCls + ' w-24'} value={form.everyMin} onChange={(e) => setForm({ ...form, everyMin: Number(e.target.value) })} />
                  <span>دقيقة</span>
                </>
              )}
            </div>
            {form.kind === 'weekly' && (
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i] })}
                    className={`rounded-full border px-3 py-1 text-xs ${form.days.includes(i) ? 'border-primary bg-primary/15 text-primary' : 'border-outline'}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select className={inputCls + ' w-auto'} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">بدون مشروع</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.confidential ? ' 🔒' : ''}
                  </option>
                ))}
              </select>
              <select className={inputCls + ' w-auto'} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'auto' | 'free' })}>
                <option value="auto">تلقائي (مع المدفوع)</option>
                <option value="free">مجاني بس (أقوى مجاني متوفر)</option>
              </select>
            </div>
            <p className="text-xs text-muted">المهمة بتشتغل بدون ما حدا يكون قدام الشاشة، فبتنفّذ مباشرة بالصلاحيات المفعّلة (التحكم بالجهاز + الموافقة التلقائية). النتيجة بتوصلك إشعار وبتنحفظ كمحادثة.</p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!form.name.trim() || !form.prompt.trim()} onClick={save}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
