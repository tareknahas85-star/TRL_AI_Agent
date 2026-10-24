import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { UsageChart } from './UsageChart'
import { UsagePanel } from './UsagePanel'
import { askConfirm } from './components/confirm'
import { Loader2, Plug, Plus, Trash2 } from 'lucide-react'
import type { CustomModelInfo, Tier } from '../preload/index.d'
import { KeyField, type KeyName } from './KeyField'
import { CatalogPanel } from './CatalogPanel'
import { HfPanel } from './HfPanel'
import { CapIcons, guessCaps, type Caps } from './Caps'
import { HostField } from './HostField'
import { FreeProbePanel } from './FreeProbePanel'
import { CheckButton, CheckPanel, useFullCheck } from './FullCheck'
import { Chip, Empty, Modal, PageShell, TIER_LABEL, Toggle, cardCls, ghostBtn, inputCls, primaryBtn, useTab } from './components/ui'
import { SpendPanel } from './SpendPanel'
import { ClaudeAccountsPanel } from './ClaudeAccountsPanel'

const BUILTIN: { tier: Tier; models: string[] }[] = [
  { tier: 'TIER_1_FREE', models: ['qwen/qwen3.8-27b:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3.5-lightning:free'] },
  { tier: 'TIER_2_CHEAP', models: ['deepseek/deepseek-v4.1-flash', 'google/gemini-3.5-flash-lite', 'openai/gpt-4o-mini'] },
  { tier: 'TIER_3_EXPENSIVE', models: ['anthropic/claude-sonnet-5', 'openai/gpt-4o'] }
]
const PROVIDERS = [
  { id: 'general', name: 'عام: المجاني والتكلفة' },
  { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY' },
  { id: 'apinex', name: 'APInex', key: 'APINEX_API_KEY' },
  { id: 'huggingface', name: 'Hugging Face', key: 'HUGGINGFACE_API_KEY' },
  { id: 'gemini', name: 'Gemini', key: 'GEMINI_API_KEY' },
  { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY' },
  { id: 'claude', name: 'الحسابات الأساسية' },
  { id: 'local', name: 'محلي (Ollama / LM Studio)' },
  { id: 'custom', name: 'موديلات مخصصة' }
] as const
// APInex: which free source goes first in the normal chat, and a manual refresh of its free list.
function ApinexPanel() {
  const [first, setFirst] = useState<'openrouter' | 'apinex'>('openrouter')
  const [ids, setIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.freeFirst.get().then(setFirst)
  }, [])
  const choose = (v: 'openrouter' | 'apinex'): void => {
    setFirst(v)
    void window.api.freeFirst.set(v)
  }
  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      setIds(await window.api.apinex.refresh())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`mt-3 ${cardCls}`}>
      <h3 className="mb-2 text-sm font-semibold">أيّ مزوّد يبدأ في المحادثة العادية؟</h3>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="freeFirst" checked={first === 'openrouter'} onChange={() => choose('openrouter')} />
        OpenRouter أولاً (الافتراضي)
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm">
        <input type="radio" name="freeFirst" checked={first === 'apinex'} onChange={() => choose('apinex')} />
        apinex أولاً
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button className={ghostBtn} onClick={() => void refresh()} disabled={busy}>
          {busy ? 'جاري التحديث…' : 'تحديث قائمة apinex الآن'}
        </button>
        {ids.length > 0 && <span className="text-xs text-muted">{ids.length} موديل مجاني</span>}
      </div>
      {ids.length > 0 && (
        <ul className="mt-2 list-disc pr-5 text-xs text-muted">
          {ids.map((id) => (
            <li key={id}>{id.replace('apinex:', '')}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">القائمة بتتحدث تلقائياً مرة باليوم. الموديلات اللي عليها اشتراك مستبعدة.</p>
    </div>
  )
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const empty = { name: '', model: '', baseURL: '', apiKey: '', tier: 'TIER_2_CHEAP' as Tier }

// شرح المفاتيح + التنبيه: البرنامج ما بيستعمل حسابات الاشتراك الشخصية، كل واحد يضيف مفاتيحه من حسابه.
function KeysNotice(): ReactElement {
  return (
    <div className={`${cardCls} mb-4 space-y-2 p-4 text-[12px] leading-6`}>
      <div className="font-semibold">كيف تجيب مفتاح لكل مزوّد</div>
      <ul className="list-disc space-y-1 ps-5">
        <li>Google (Gemini): مفتاح من AI Studio على aistudio.google.com ← API key. فيه طبقة مجانية، بس شوف شروطها الحالية.</li>
        <li>Anthropic (Claude): مفتاح من console.anthropic.com ← API Keys. هذا مدفوع حسب الاستخدام.</li>
        <li>OpenAI (ChatGPT / GPT): مفتاح من platform.openai.com ← API keys. هذا مدفوع حسب الاستخدام.</li>
        <li>OpenRouter: مفتاح واحد يفتح كثير موديلات، وفيه موديلات مجانية (:free).</li>
      </ul>
      <div className="rounded-card border border-warning/40 bg-warning/10 p-2 text-[11px]">
        البرنامج ما يستعمل حسابات الاشتراك الشخصية (Claude أو Google AI أو ChatGPT) لتسجيل الدخول، لأن شروط هالخدمات تمنع ذلك. كل مستخدم يضيف مفاتيح API الخاصة فيه من حسابه. أنت مسؤول عن الالتزام بشروط كل مزوّد، وبالقوانين المعمول فيها ببلدك. المطوّر ما يوفّر حسابات أو مفاتيح، ولا يتحمّل مسؤولية الاستخدام اللي يخالف الشروط.
      </div>
    </div>
  )
}

// Manual price (USD per 1M tokens) for a custom model; empty = use the built-in table (Gemini...) or OpenRouter's price.
function PriceRow({ m, onSaved }: { m: CustomModelInfo; onSaved: () => void }): ReactElement {
  const [pin, setPin] = useState(m.priceIn !== undefined ? String(m.priceIn) : '')
  const [pout, setPout] = useState(m.priceOut !== undefined ? String(m.priceOut) : '')
  const auto = m.autoPrice
  const cls = 'w-16 rounded-lg border border-outline bg-surface px-2 py-0.5 text-xs'
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>سعر $ لكل مليون توكن:</span>
      <label className="flex items-center gap-1">دخل <input dir="ltr" className={cls} value={pin} placeholder={auto ? String(auto.in) : '—'} onChange={(e) => setPin(e.target.value)} /></label>
      <label className="flex items-center gap-1">خرج <input dir="ltr" className={cls} value={pout} placeholder={auto ? String(auto.out) : '—'} onChange={(e) => setPout(e.target.value)} /></label>
      <button
        className="rounded-full border border-outline px-2 py-0.5 text-primary hover:bg-surface2"
        onClick={async () => {
          await window.api.models.setPrice(m.id, pin, pout)
          onSaved()
        }}
      >
        حفظ
      </button>
      {m.priceIn === undefined && auto && <span>(تلقائي من أسعار Google)</span>}
      {m.priceIn === undefined && !auto && <span>(بدون سعر: بتظهر «غير معروفة» بالتقرير)</span>}
    </div>
  )
}

export function ModelsPage() {
  const chk = useFullCheck('models')
  const [prov, pickProv] = useTab('air.models.prov', PROVIDERS.map((x) => x.id), 'openrouter')
  const [has, setHas] = useState<Record<string, boolean>>({})
  useEffect(() => {
    for (const p of PROVIDERS) if ('key' in p) void window.api.getKey(p.key).then((v) => setHas((h) => ({ ...h, [p.key]: !!v.trim() })))
  }, [])
  const setKeyHas = (k: KeyName) => (v: boolean): void => setHas((h) => ({ ...h, [k]: v }))
  const [capMap, setCapMap] = useState<Record<string, Caps>>({})
  useEffect(() => {
    void window.api.catalog.list().then((c) => setCapMap(Object.fromEntries(c.models.map((x) => [x.id, { vision: x.vision, tools: x.tools, reasoning: x.reasoning }]))))
  }, [])
  const [models, setModels] = useState<CustomModelInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [keyFor, setKeyFor] = useState<CustomModelInfo | null>(null)
  const [keyVal, setKeyVal] = useState('')
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [local, setLocal] = useState<{ runtime: string; baseURL: string; models: string[] }[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const scan = async (): Promise<void> => {
    setScanning(true)
    setLocal(await window.api.models.detectLocal())
    setScanning(false)
  }
  const addLocal = async (baseURL: string, model: string, runtime: string): Promise<void> => {
    const r = await window.api.models.add({ name: `${model} (${runtime})`, model, baseURL, tier: 'TIER_1_FREE' })
    if (!r.ok) setError(r.error ?? 'خطأ')
    load()
  }
  const [remote, setRemote] = useState<{ src: CustomModelInfo; list: { id: string; recommended: boolean; added: boolean; free: boolean }[]; sel: Set<string>; all: boolean } | null>(null)
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null)
  const [gem, setGem] = useState<{ list: { id: string; added: boolean }[]; sel: Set<string> } | null>(null)
  const [gemMsg, setGemMsg] = useState('')
  const fetchGem = async (): Promise<void> => {
    setGemMsg('عم أجلب…')
    const r = await window.api.gemini.list()
    if (!r.ok) return setGemMsg('✗ ' + (r.error ?? 'فشل'))
    setGemMsg('')
    setGem({ list: r.models, sel: new Set() })
  }
  const fetchRemote = async (m: CustomModelInfo, all = false): Promise<void> => {
    setRemoteBusy(m.id)
    const r = await window.api.models.fetchRemote(m.id, all)
    setRemoteBusy(null)
    if (!r.ok || !r.models) return setResults((p) => ({ ...p, [m.id]: { ok: false, message: r.error ?? 'فشل الجلب' } }))
    setRemote({ src: m, all, list: r.models, sel: new Set(r.models.filter((x) => x.recommended && x.free && !x.added).map((x) => x.id)) })
  }
  const load = useCallback(() => window.api.models.list().then(setModels), [])
  useEffect(() => {
    load()
  }, [load])

  const add = async (): Promise<void> => {
    const r = await window.api.models.add({
      name: form.name.trim(),
      model: form.model.trim(),
      baseURL: form.baseURL.trim(),
      apiKey: form.apiKey,
      tier: form.tier
    })
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setForm(empty)
    setError('')
    load()
  }

  const isGem = (m: CustomModelInfo): boolean => /generativelanguage|googleapis/i.test(m.baseURL ?? '')
  const isLocal = (m: CustomModelInfo): boolean => /localhost|127\.0\.0\.1|:11434|:1234/i.test(m.baseURL ?? '')
  const gemModels = models.filter(isGem)
  const localModels = models.filter(isLocal)
  const otherModels = models.filter((m) => !isGem(m) && !isLocal(m))
  const openAdd = (baseURL = ''): void => {
    setForm({ ...empty, baseURL })
    setError('')
    setAdding(true)
  }
  const dot = (id: string): boolean => {
    const p = PROVIDERS.find((x) => x.id === id)
    if (p && 'key' in p) return !!has[p.key]
    if (id === 'custom') return otherModels.length > 0
    if (id === 'local') return localModels.length > 0
    return false
  }
  const customList = (list: CustomModelInfo[]): ReactNode => (
    <>
      {list.length === 0 ? (
        <Empty text="ما في موديلات مخصصة - ضيف موديل خارجي (OpenAI-compatible أو OpenRouter)" />
      ) : (
        <div className="space-y-2">
          {list.map((m) => {
            const r = results[m.id]
            return (
              <div key={m.id} className={cardCls + ' flex flex-wrap items-center justify-between gap-3'}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={'font-semibold' + (isLocal(m) ? ' text-success' : '')}>{m.name}</span>
                    {isLocal(m) && <Chip cls="bg-success/15 text-success">محلي</Chip>}
                    <Chip cls={TIER_LABEL[m.tier].cls}>{TIER_LABEL[m.tier].label}</Chip>
                    {m.hasKey && <Chip>مفتاح محفوظ</Chip>}
                    <CapIcons caps={capMap[m.model] ?? guessCaps(m.model)} />
                  </div>
                  <div dir="ltr" className="truncate text-start font-mono text-xs text-muted">
                    {m.model} · {m.baseURL || 'openrouter.ai'}
                  </div>
                  <PriceRow key={m.id + String(m.priceIn) + String(m.priceOut)} m={m} onSaved={load} />
                  {r && <div className={`mt-1 text-xs ${r.ok ? 'text-success' : 'text-danger'}`}>{r.ok ? '✓ ' : '✗ '}{r.message}</div>}
                </div>
                <div className="flex items-center gap-1">
                  {isLocal(m) && (
                    <button
                      className={ghostBtn + ' text-danger'}
                      aria-label={`حذف ${m.name}`}
                      onClick={async () => {
                        if (await askConfirm(`بدك تحذف الموديل ${m.name}؟`)) {
                          await window.api.models.remove(m.id)
                          load()
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  <button
                    className={ghostBtn + ' flex items-center gap-1'}
                    disabled={testing === m.id}
                    onClick={async () => {
                      setTesting(m.id)
                      const res = await window.api.models.test(m.id)
                      setResults((p) => ({ ...p, [m.id]: res }))
                      setTesting(null)
                    }}
                  >
                    {testing === m.id ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} اختبار
                  </button>
                  <button
                    className={ghostBtn}
                    title="ترتيب التجربة داخل طبقته: قبل أو بعد موديلات OpenRouter"
                    onClick={async () => { await window.api.models.setPosition(m.id, !m.last); load() }}
                  >
                    {m.last ? 'بينجرّب: بعد' : 'بينجرّب: أول'}
                  </button>
                  {m.baseURL && m.hasKey && !m.baseURL.includes('11434') && (
                    <button className={ghostBtn} disabled={remoteBusy === m.id} onClick={() => fetchRemote(m)}>{remoteBusy === m.id ? 'عم أجلب…' : 'جلب المجانية'}</button>
                  )}
                  <button className={ghostBtn} onClick={() => { setKeyVal(''); setKeyFor(m) }}>المفتاح</button>
                  {!isLocal(m) && (
                  <button
                    className={ghostBtn + ' text-danger'}
                    aria-label={`حذف ${m.name}`}
                    onClick={async () => {
                      if (await askConfirm(`بدك تحذف الموديل ${m.name}؟`)) {
                        await window.api.models.remove(m.id)
                        load()
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                  )}
                  <Toggle checked={m.enabled} label={`تفعيل ${m.name}`} onChange={async () => { await window.api.models.toggle(m.id); load() }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
  const head = (title: string): ReactNode => <h2 className="mb-4 text-lg font-semibold">{title}</h2>

  return (
    <PageShell title="الموديلات" subtitle="اختار المزوّد من القائمة: المفتاح، الموديلات، والتجربة بمكان واحد." action={<CheckButton c={chk} label="فحص المفاتيح والموديلات" />}>
      <KeysNotice />
      <UsagePanel />
      <CheckPanel c={chk} />
      <div className="flex items-start gap-5">
        <aside className="w-56 shrink-0 space-y-1">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => pickProv(p.id)}
              className={'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start text-sm ' + (prov === p.id ? 'bg-primary/15 font-medium text-primary' : 'hover:bg-surface2')}
            >
              <span className="truncate">{p.name}</span>
              {dot(p.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-label="جاهز" />}
            </button>
          ))}
          <button className={ghostBtn + ' mt-2 flex w-full items-center justify-center gap-1 border border-primary text-primary'} onClick={() => openAdd()}>
            <Plus size={14} /> إضافة
          </button>
        </aside>

        <section className="min-w-0 flex-1">
          {prov === 'general' && (
            <>
              {head('عام: المجاني والتكلفة')}
              <SpendPanel />
              <UsageChart />
              <p className="mt-3 text-xs text-muted">الراوتر بيجرّب الموديلات حسب الطبقة (مجاني، رخيص، قوي) وبينتقل للتالي إذا فشل واحد.</p>
            </>
          )}
          {prov === 'apinex' && (
            <>
              {head('APInex')}
              <p className="mb-3 text-xs text-muted">
                بوابة ثانية فيها موديلات مجانية بدون اشتراك. تضيف مفتاحها هون، وبتقدر تختار إذا تبدأ قبل OpenRouter أو بعده.
              </p>
              <KeyField name="APINEX_API_KEY" onChange={setKeyHas('APINEX_API_KEY')} />
              <ApinexPanel />
            </>
          )}
          {prov === 'openrouter' && (
            <>
              {head('OpenRouter')}
              <KeyField name="OPENROUTER_API_KEY" verify={() => window.api.catalog.test()} onChange={setKeyHas('OPENROUTER_API_KEY')} />
              <HostField id="openrouter" />
              <CatalogPanel />
              <FreeProbePanel />
              <UsageChart />
              <h3 className="mb-2 mt-6 text-sm font-semibold text-muted">الموديلات المدمجة (حسب الطبقة)</h3>
              <div className="grid gap-3 md:grid-cols-3">
                {BUILTIN.map((t) => (
                  <div key={t.tier} className={cardCls}>
                    <Chip cls={TIER_LABEL[t.tier].cls}>{TIER_LABEL[t.tier].label}</Chip>
                    <ul dir="ltr" className="mt-3 space-y-1 text-start font-mono text-xs text-muted">
                      {t.models.map((x) => <li key={x} className="flex items-center justify-between gap-2"><span className="truncate">{x}</span><CapIcons caps={capMap[x]} /></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
          {prov === 'huggingface' && (
            <>
              {head('Hugging Face')}
              <KeyField
                name="HUGGINGFACE_API_KEY"
                onChange={setKeyHas('HUGGINGFACE_API_KEY')}
                verify={async () => {
                  const r = await window.api.hf.models()
                  return { ok: r.ok, message: r.ok ? `المفتاح شغّال، ${r.models.length} موديل بيقبل صور` : (r.error ?? 'فشل') }
                }}
              />
              <HostField id="huggingface" />
              <HfPanel />
            </>
          )}
          {prov === 'gemini' && (
            <>
              {head('Gemini')}
              <KeyField name="GEMINI_API_KEY" onChange={setKeyHas('GEMINI_API_KEY')} verify={() => window.api.providers.check('gemini')} />
              <HostField id="gemini" />
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted">الموديلات</h3>
                <div className="flex items-center gap-2">
                  <button className={ghostBtn + ' border border-outline'} onClick={fetchGem}>جلب</button>
                  <button className={ghostBtn + ' border border-outline'} onClick={() => openAdd(GEMINI_BASE)}>+ جديد</button>
                </div>
              </div>
              {gemMsg && <p className="mb-2 text-xs text-danger">{gemMsg}</p>}
              {customList(gemModels)}
            </>
          )}
          {prov === 'openai' && (
            <>
              {head('OpenAI')}
              <KeyField name="OPENAI_API_KEY" onChange={setKeyHas('OPENAI_API_KEY')} verify={() => window.api.providers.check('openai')} />
            </>
          )}
          {prov === 'anthropic' && (
            <>
              {head('Anthropic')}
              <KeyField name="ANTHROPIC_API_KEY" onChange={setKeyHas('ANTHROPIC_API_KEY')} verify={() => window.api.providers.check('anthropic')} />
            </>
          )}
          {prov === 'claude' && (
            <>
              {head('الحسابات الأساسية (غووغل / Claude / ChatGPT)')}
              <ClaudeAccountsPanel />
            </>
          )}
          {prov === 'local' && (
            <>
              {head('محلي (Ollama / LM Studio)')}
              <OllamaPanel onChanged={scan} />
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted">موديلات محلية (Ollama / LM Studio)</h3>
        <button className={ghostBtn} onClick={scan} disabled={scanning}>{scanning ? 'عم أفحص…' : 'فحص الموديلات المحلية'}</button>
      </div>
      {local !== null && (
        <div className="mb-6 space-y-2">
          {local.length === 0 ? (
            <Empty text="ما لقيت سيرفر محلي شغّال. ثبّت Ollama (أو LM Studio) وشغّله، وحمّل موديل صغير مثل qwen3:1.7b، وبعدين دوس فحص." />
          ) : (
            local.map((rt) => (
              <div key={rt.runtime} className={cardCls}>
                <div className="mb-2 text-sm font-semibold">{rt.runtime} <span dir="ltr" className="font-mono text-xs text-muted">{rt.baseURL}</span></div>
                {rt.models.length === 0 ? (
                  <p className="text-xs text-muted">شغّال بس ما فيه موديلات محمّلة.</p>
                ) : (
                  <ul className="space-y-1">
                    {rt.models.map((m) => {
                      const added = models.some((x) => x.model === m && x.baseURL === rt.baseURL)
                      return (
                        <li key={m} className="flex items-center justify-between gap-3">
                          <span dir="ltr" className="truncate font-mono text-xs">{m}</span>
                          <button className={ghostBtn} disabled={added} onClick={() => addLocal(rt.baseURL, m, rt.runtime)}>{added ? 'مضاف' : 'ضيف'}</button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}
              {customList(localModels)}
            </>
          )}
          {prov === 'custom' && (
            <>
              {head('موديلات مخصصة')}
              <p className="mb-3 text-xs text-muted">أي سيرفر بيدعم واجهة OpenAI (chat/completions): Groq، Together، Mistral، سيرفرك الخاص…</p>
              {customList(otherModels)}
            </>
          )}
        </section>
      </div>
      {adding && (
        <Modal title="ضيف موديل خارجي" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <input className={inputCls} placeholder="اسم للعرض (e.g. Llama محلي)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input dir="ltr" className={inputCls + ' font-mono'} placeholder="Model ID (e.g. gpt-4o-mini)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input dir="ltr" className={inputCls + ' font-mono'} placeholder="Base URL (فاضي = OpenRouter) e.g. http://localhost:11434/v1" value={form.baseURL} onChange={(e) => setForm({ ...form, baseURL: e.target.value })} />
            <input dir="ltr" type="password" className={inputCls} placeholder="API Key (اختياري للسيرفرات المحلية)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            <select className={inputCls} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}>
              {(Object.keys(TIER_LABEL) as Tier[]).map((t) => <option key={t} value={t}>الطبقة: {TIER_LABEL[t].label}</option>)}
            </select>
            <p className="text-xs text-muted">أي سيرفر بيدعم واجهة OpenAI (chat/completions) بيشتغل: OpenAI, Groq, Together, Ollama, LM Studio…</p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!form.name.trim() || !form.model.trim()} onClick={add}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
      {gem && (
        <Modal title="موديلات Gemini" onClose={() => setGem(null)}>
          <div className="space-y-3">
            <p className="text-xs text-muted">{gem.list.length} موديل. بتنضاف بنفس مفتاح Gemini المحفوظ؛ الـ pro بطبقة "قوي" والباقي بـ "رخيص".</p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {gem.list.map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" disabled={x.added} checked={x.added || gem.sel.has(x.id)} onChange={(e) => { const s2 = new Set(gem.sel); if (e.target.checked) s2.add(x.id); else s2.delete(x.id); setGem({ ...gem, sel: s2 }) }} />
                  <span dir="ltr" className="font-mono">{x.id}</span>
                  {x.added && <Chip>مضاف</Chip>}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setGem(null)}>إلغاء</button>
              <button className={primaryBtn} disabled={!gem.sel.size} onClick={async () => { await window.api.gemini.import([...gem.sel]); setGem(null); load() }}>ضيف المحدد ({gem.sel.size})</button>
            </div>
          </div>
        </Modal>
      )}
      {remote && (
        <Modal title={`موديلات مجانية من ${remote.src.baseURL}`} onClose={() => setRemote(null)}>
          <div className="space-y-3">
            <p className="text-xs text-muted">{remote.list.length} موديل مجاني. الـcoding-* مو محددة افتراضي (غالباً محصورة بأدوات البرمجة). بتنضاف بآخر السلسلة وبنفس المفتاح المحفوظ.</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={remote.all} onChange={(e) => fetchRemote(remote.src, e.target.checked)} />
              عرض كل الموديلات (بما فيها المدفوعة). غير المجانية بتنضاف بطبقة "رخيص" فما بتنستخدم إلا إذا سمحت بالمدفوع.
            </label>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {remote.list.map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" disabled={x.added} checked={x.added || remote.sel.has(x.id)} onChange={(e) => { const s = new Set(remote.sel); if (e.target.checked) s.add(x.id); else s.delete(x.id); setRemote({ ...remote, sel: s }) }} />
                  <span dir="ltr" className="font-mono">{x.id}</span>
                  {x.added && <Chip>مضاف</Chip>}
                  {!x.free && <Chip>مدفوع/غير مؤكد</Chip>}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setRemote(null)}>إلغاء</button>
              <button className={primaryBtn} disabled={!remote.sel.size} onClick={async () => { await window.api.models.importRemote(remote.src.id, remote.list.filter((x) => remote.sel.has(x.id)).map((x) => ({ id: x.id, free: x.free }))); setRemote(null); load() }}>ضيف المحدد ({remote.sel.size})</button>
            </div>
          </div>
        </Modal>
      )}
      {keyFor && (
        <Modal title={`مفتاح ${keyFor.name}`} onClose={() => setKeyFor(null)}>
          <div className="space-y-3">
            <input dir="ltr" type="password" className={inputCls} placeholder="API Key الجديد (فاضي = مسح المفتاح)" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setKeyFor(null)}>إلغاء</button>
              <button className={primaryBtn} onClick={async () => { await window.api.models.setKey(keyFor.id, keyVal); setKeyFor(null); load() }}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}

type OllamaInfo = {
  state: 'missing' | 'stopped' | 'running'
  models: string[]
  suggested: string[]
  downloadUrl: string
}

// Manages Ollama from inside the app: detect, start, download and delete models.
function OllamaPanel({ onChanged }: { onChanged: () => void }): ReactElement | null {
  const [st, setSt] = useState<OllamaInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [prog, setProg] = useState<{ model: string; status: string; percent: number } | null>(null)
  const [custom, setCustom] = useState('')
  const refresh = useCallback(async (): Promise<void> => {
    setSt(await window.api.models.ollama.status())
  }, [])
  useEffect(() => {
    let alive = true
    void window.api.models.ollama.status().then((s) => { if (alive) setSt(s) })
    const off = window.api.models.ollama.onProgress((p) => setProg(p))
    return () => { alive = false; off() }

    }, [])

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key)
    setMsg('')
    try {
      await fn()
    } finally {
      setBusy(null)
      setProg(null)
    }
    await refresh()
    onChanged()
  }
  const start = (): Promise<void> =>
    run('start', async () => {
      const ok = await window.api.models.ollama.start()
      setMsg(ok ? '✓ Ollama اشتغل' : '✗ ما قدرت شغّله، تأكد إنه مثبّت')
    })
  const pull = (name: string): Promise<void> =>
    run('pull:' + name, async () => {
      const r = await window.api.models.ollama.pull(name)
      setMsg(r.ok ? '✓ تم تحميل ' + name : '✗ ' + (r.error ?? 'فشل التحميل'))
    })
  const del = (name: string): Promise<void> =>
    run('del:' + name, async () => {
      if (!(await askConfirm(`بدك تحذف ${name} من الجهاز؟`))) return
      const r = await window.api.models.ollama.delete(name)
      setMsg(r.ok ? '✓ تم حذف ' + name : '✗ ' + (r.error ?? 'فشل الحذف'))
    })

  if (!st) return null
  const notice = msg && <p className={'text-xs ' + (msg.startsWith('✗') ? 'text-danger' : 'text-success')}>{msg}</p>

  // Case 1: Ollama is not installed. Open the official page, never download silently.
  if (st.state === 'missing') {
    return (
      <div className={cardCls + ' mb-4 space-y-2'}>
        <p className="text-sm">Ollama مش مثبّت على جهازك.</p>
        <div className="flex flex-wrap gap-2">
          <button className={ghostBtn} onClick={() => void window.api.models.ollama.openDownload()}>تنزيل Ollama</button>
          <button className={ghostBtn} onClick={() => void refresh()}>ثبّته، افحص الآن</button>
        </div>
        {notice}
      </div>
    )
  }

  // Case 2: installed but not running.
  if (st.state === 'stopped') {
    return (
      <div className={cardCls + ' mb-4 space-y-2'}>
        <p className="text-sm">Ollama مثبّت بس مش شغّال.</p>
        <div className="flex flex-wrap gap-2">
          <button className={ghostBtn} disabled={busy !== null} onClick={() => void start()}>
            {busy === 'start' ? 'عم شغّل…' : 'شغّل Ollama'}
          </button>
        </div>
        {notice}
      </div>
    )
  }

  // Case 3: running. Download, delete, and list installed models.
  const installed = new Set(st.models)
  return (
    <div className={cardCls + ' mb-4 space-y-4'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-success">Ollama شغّال</span>
        <button className={ghostBtn} disabled={busy !== null} onClick={() => void refresh()}>فحص</button>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted">تحميل موديل</div>
        <div className="flex flex-wrap gap-2">
          <input
            dir="ltr"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="مثال: qwen3:1.7b"
            className="min-w-[12rem] flex-1 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-xs"
          />
          <button
            className={ghostBtn}
            disabled={busy !== null || !custom.trim()}
            onClick={() => void pull(custom.trim())}
          >
            تحميل
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {st.suggested.map((s) => (
            <button
              key={s}
              dir="ltr"
              className={ghostBtn + ' font-mono text-xs'}
              disabled={busy !== null || installed.has(s)}
              onClick={() => void pull(s)}
            >
              {installed.has(s) ? s + ' ✓' : s}
            </button>
          ))}
        </div>
      </div>

      {prog && (
        <div className="space-y-1">
          <div dir="ltr" className="text-xs text-muted">
            {prog.model} · {prog.status} · {prog.percent}%
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-surface-2">
            <div className="h-full bg-success transition-all" style={{ width: prog.percent + '%' }} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs text-muted">الموديلات المحمّلة على جهازك</div>
        {st.models.length === 0 ? (
          <p className="text-xs text-muted">ما في موديلات محمّلة بعد.</p>
        ) : (
          <ul className="space-y-1">
            {st.models.map((name) => (
              <li key={name} className="flex items-center gap-3">
                <button
                  className={ghostBtn + ' text-danger'}
                  aria-label={`حذف ${name}`}
                  disabled={busy !== null}
                  onClick={() => void del(name)}
                >
                  <Trash2 size={14} />
                </button>
                <span dir="ltr" className="truncate font-mono text-xs text-success">{name}</span>
                <Chip cls="bg-success/15 text-success">محلي</Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
      {notice}
    </div>
  )
}
