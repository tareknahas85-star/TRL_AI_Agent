import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { RefreshCw, RotateCcw, X } from 'lucide-react'
import type { LearnViewInfo, PrefsInfo } from '../preload/index.d'
import { Toggle, cardCls, ghostBtn } from './components/ui'

// "What the app learned about you": all numbers are computed and kept on this device; nothing here is ever sent to a model.

function Ring({ pct, size = 72, stroke = 7, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${pct}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-outline" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="text-primary transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
    </div>
  )
}

function History({ points }: { points: { at: number; level: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-muted">الرسم بيظهر بعد يومين من الاستخدام.</p>
  const w = 520
  const h = 110
  const pad = 8
  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / (points.length - 1))
  const ys = points.map((p) => h - pad - (p.level / 100) * (h - 2 * pad))
  const d = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const fmt = (t: number): string => new Date(t).toLocaleDateString('ar', { day: 'numeric', month: 'short' })
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-xl text-primary" role="img" aria-label="تطوّر مستوى التعلّم عبر الزمن">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" className="text-outline" />
        <polyline points={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r="3" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{fmt(points[0].at)}</span>
        <span>{points[points.length - 1].level}% الآن</span>
      </figcaption>
    </figure>
  )
}

export function LearningPanel() {
  const [v, setV] = useState<LearnViewInfo | null>(null)
  const [prefs, setPrefs] = useState<PrefsInfo | null>(null)
  const load = useCallback(async (): Promise<void> => {
    const [a, b] = await Promise.all([window.api.learn.get(), window.api.prefs.get()])
    setV(a)
    setPrefs(b)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  if (!v || !prefs) return null

  const setPref = async (patch: Partial<PrefsInfo>): Promise<void> => {
    setPrefs(await window.api.prefs.set(patch))
    void load()
  }
  const maxTopic = Math.max(1, ...v.topics.map((t) => t.n))

  return (
    <section className="mb-6">
      <h3 className="mb-1 text-base font-semibold">شو تعلّم البرنامج عنك</h3>
      <p className="mb-3 text-xs text-muted">
        بيتعلّم من استخدامك الفعلي بس (عدّادات، مو نصوص). كل شي محفوظ على جهازك ولا بينبعت لأي موديل، وما بيتسجّل شي من المشاريع السرية ولا من المهام المجدولة. بتقدر تصحّح أو تنسّيه أي شي.
      </p>

      <div className={cardCls + ' mb-3 flex flex-wrap items-center gap-5'}>
        <Ring pct={v.level} size={116} stroke={10}>
          <div>
            <div className="text-2xl font-bold">{v.level}%</div>
            <div className="text-[10px] text-muted">مستوى التعلّم</div>
          </div>
        </Ring>
        <div className="min-w-[220px] flex-1 space-y-2">
          <div className="text-sm leading-relaxed">{v.summary.text || 'لسا عم أتعرّف عليك — كل ما استعملتني أكتر بفهمك أحسن.'}</div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>{v.turns} طلب منذ {new Date(v.since).toLocaleDateString('ar')}</span>
            <span>· الدائرة ما بتوصل 100% (السقف 95%) لأنو الفهم ما بيكتمل</span>
            <button
              className={ghostBtn + ' flex items-center gap-1 !py-1 text-xs'}
              onClick={async () => {
                const text = await window.api.learn.refreshSummary()
                setV((p) => (p ? { ...p, summary: { text, at: Date.now() } } : p))
              }}
            >
              <RefreshCw size={12} /> حدّث الملخص
            </button>
          </div>
        </div>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        {v.rings.map((r) => (
          <div key={r.id} className={cardCls + ' flex items-center gap-3'}>
            <Ring pct={r.pct} size={64} stroke={6}>
              <span className="text-sm font-semibold">{r.pct}%</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{r.label}</div>
              <div className="truncate text-xs text-muted" title={r.detail}>
                {r.detail}
              </div>
              {r.editable && (
                <label className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                  غلط؟ صلّحو:
                  <select
                    className="rounded-lg border border-outline bg-surface2 px-1 py-0.5 text-xs text-fg"
                    value={r.editable.current}
                    onChange={async (e) => {
                      await window.api.learn.correct(r.editable!.kind, e.target.value)
                      void load()
                    }}
                  >
                    <option value="">(تلقائي)</option>
                    {r.editable.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={cardCls + ' mb-3'}>
        <div className="mb-2 text-sm font-medium">اهتماماتك</div>
        {v.topics.length === 0 ? (
          <p className="text-xs text-muted">لسا ما في بيانات كفاية.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {v.topics.map((t) => (
              <span key={t.id} className="group inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-primary" style={{ fontSize: 12 + Math.round((t.n / maxTopic) * 12) }} title={`${t.n} طلب (${t.pct}%)`}>
                {t.label}
                <button
                  className="opacity-40 hover:opacity-100"
                  aria-label={'انسَ ' + t.label}
                  title="غلط، انسَ هيدا"
                  onClick={async () => {
                    await window.api.learn.forget('topic', t.id)
                    void load()
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={cardCls + ' mb-3'}>
        <div className="mb-2 text-sm font-medium">الأدوات اللي بتعتمد عليها</div>
        {v.tools.length === 0 ? (
          <p className="text-xs text-muted">لسا ما استعملت أدوات.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {v.tools.map((t) => (
              <span key={t.key} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-3 py-1 text-xs">
                <span dir="ltr">{t.key}</span>
                <span className="text-muted">×{t.n}</span>
                <button
                  className="opacity-40 hover:opacity-100"
                  aria-label={'انسَ ' + t.key}
                  title="انسَ هالأداة (ما بيرجع يتعلّمها)"
                  onClick={async () => {
                    await window.api.learn.forget('tool', t.key)
                    void load()
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={cardCls + ' mb-3'}>
        <div className="mb-2 text-sm font-medium">التقدّم عبر الزمن</div>
        <History points={v.history} />
      </div>

      <div className={cardCls + ' space-y-3'}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">التعلّم شغّال</div>
            <div className="text-xs text-muted">إذا طفيتو بيوقف التسجيل كلياً، وما بيتغيّر شي بالأدوات.</div>
          </div>
          <Toggle checked={prefs.learningEnabled} label="تفعيل التعلّم" onChange={() => void setPref({ learningEnabled: !prefs.learningEnabled })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">وضع خاص</div>
            <div className="text-xs text-muted">بيوقف التعلّم مؤقتاً: ما بيتسجّل ولا طلب لحد ما تطفيه.</div>
          </div>
          <Toggle checked={prefs.learningPaused} label="وضع خاص" onChange={() => void setPref({ learningPaused: !prefs.learningPaused })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">ابدأ من الصفر</div>
            <div className="text-xs text-muted">بيمسح كل شي تعلّمو (الدائرة، الاهتمامات، الأدوات، الأسلوب).</div>
          </div>
          <button
            className={ghostBtn + ' flex items-center gap-1 border border-outline text-danger'}
            onClick={async () => {
              if (!confirm('بدك تمسح كل شي تعلّمو البرنامج عنك؟')) return
              await window.api.learn.reset()
              void load()
            }}
          >
            <RotateCcw size={14} /> صفّر
          </button>
        </div>
      </div>
    </section>
  )
}
