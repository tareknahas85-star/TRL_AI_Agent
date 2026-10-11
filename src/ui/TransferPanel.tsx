import { useState } from 'react'

type Sel = { keys: boolean; skills: boolean; memory: boolean; mcp: boolean; conversations: boolean }
const LABELS: [keyof Sel, string][] = [
  ['keys', 'المفاتيح والموديلات المخصصة والإعدادات (OpenRouter، Gemini، Telegram، API host...)'],
  ['skills', 'السكيلز'],
  ['memory', 'الذاكرة (العامة وذاكرة الماستر)'],
  ['mcp', 'سيرفرات MCP (مسارات ويندوز ما بتنفع على لينكس)'],
  ['conversations', 'المحادثات (كبيرة وممكن فيها محتوى مشاريع)']
]

export function TransferPanel() {
  const [sel, setSel] = useState<Sel>({ keys: true, skills: true, memory: true, mcp: false, conversations: false })
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try {
      setMsg(await fn())
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
    setBusy(false)
  }

  return (
    <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
      <h3 className="text-base font-semibold">نقل الإعدادات بين الأجهزة (يدوي)</h3>
      <p className="mt-1 text-xs text-muted">
        بتصدّر الإعدادات لملف واحد مشفّر بكلمة سر بتختارها (فيه مفاتيح API)، وبتفتحو على جهاز تاني (ويندوز ← Ubuntu مثلاً). ما في أي نسخ تلقائي ولا جدولة، وما بينرفع شي لأي مكان. عند الاستيراد بيتعمل نسخة
        .bak من الملفات اللي بتنكتب فوقها، والسكيلز الموجودة ما بتتغيّر. بعد الاستيراد سكّر البرنامج وافتحو.
      </p>
      <div className="mt-3 grid gap-1 text-xs">
        {LABELS.map(([k, l]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={sel[k]} onChange={(e) => setSel({ ...sel, [k]: e.target.checked })} />
            {l}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          type="password"
          dir="ltr"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="كلمة السر (6 أحرف+)"
          className="w-52 rounded-lg border border-outline bg-bg px-3 py-1.5 outline-none focus:border-primary"
        />
        <button
          disabled={busy || pw.length < 6}
          onClick={() =>
            void run(async () => {
              const r = await window.api.transfer.export(sel, pw)
              return r.ok ? `انحفظ: ${r.path} (${r.files} ملف إعدادات، ${r.skills} ملف سكيل)` : (r.error ?? 'فشل')
            })
          }
          className="rounded-full bg-primary px-3 py-1.5 text-white disabled:opacity-50"
        >
          تصدير
        </button>
        <button
          disabled={busy || !pw}
          onClick={() =>
            void run(async () => {
              const r = await window.api.transfer.import(pw)
              return r.ok ? `تم الاستيراد: ${r.files} ملف إعدادات، ${r.skills} ملف سكيل جديد. سكّر البرنامج وافتحو.` : (r.error ?? 'فشل')
            })
          }
          className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2 disabled:opacity-50"
        >
          استيراد
        </button>
      </div>
      {msg && <div className="mt-2 break-all text-xs text-muted">{msg}</div>}
    </section>
  )
}
