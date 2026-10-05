import { useEffect, useState } from 'react'
import type { TelegramInfo } from '../preload/index.d'

export function TelegramPanel() {
  const [st, setSt] = useState<TelegramInfo>({ enabled: false, chatId: '', minSeconds: 20, hasToken: false })
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.telegram.get().then((s) => {
      setSt(s)
      setChatId(s.chatId)
    })
  }, [])

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try {
      setMsg(await fn())
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
    setBusy(false)
  }
  const saveCreds = (): Promise<void> =>
    run(async () => {
      const s = await window.api.telegram.set({ token: token || undefined, chatId })
      setSt(s)
      setToken('')
      return 'انحفظ.'
    })

  return (
    <section className="mt-4 rounded-card border border-outline bg-surface p-4 shadow-card">
      <h3 className="text-base font-semibold">تنبيه عالموبايل (Telegram)</h3>
      <p className="mt-1 text-xs text-muted">
        لما تخلص مهمة وإنت بعيد عن البرنامج (النافذة مخفية أو مش بالتركيز) بتوصلك رسالة قصيرة عتيليغرام. للمشاريع السرية بتوصل رسالة عامة بدون أي تفاصيل. عملياً: افتح @BotFather، اعمل بوت
        جديد، حطّ التوكن هون، وابعت للبوت أي كلمة، وبعدين دوس "جيب Chat ID".
      </p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <input
          type="password"
          dir="ltr"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={st.hasToken ? 'التوكن محفوظ (اكتب توكن جديد لتغييرو)' : 'Bot token'}
          className="rounded-lg border border-outline bg-bg px-3 py-1.5 outline-none focus:border-primary"
        />
        <input
          dir="ltr"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="Chat ID"
          className="rounded-lg border border-outline bg-bg px-3 py-1.5 outline-none focus:border-primary"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button disabled={busy} onClick={() => void saveCreds()} className="rounded-full bg-primary px-3 py-1.5 text-white disabled:opacity-50">
          حفظ
        </button>
        <button
          disabled={busy || !st.hasToken}
          onClick={() =>
            void run(async () => {
              const r = await window.api.telegram.detect()
              if (r.ok && r.chatId) {
                setChatId(r.chatId)
                const s = await window.api.telegram.set({ chatId: r.chatId })
                setSt(s)
                return 'لقيت Chat ID' + (r.name ? ' (' + r.name + ')' : '') + ' وانحفظ.'
              }
              return r.error ?? 'ما لقيت'
            })
          }
          className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2 disabled:opacity-50"
        >
          جيب Chat ID
        </button>
        <button
          disabled={busy || !st.hasToken || !st.chatId}
          onClick={() =>
            void run(async () => {
              const r = await window.api.telegram.test()
              return r.ok ? 'انبعتت رسالة تجربة.' : 'فشل: ' + (r.error ?? '')
            })
          }
          className="rounded-full border border-outline px-3 py-1.5 hover:bg-surface2 disabled:opacity-50"
        >
          ابعت تجربة
        </button>
        {st.hasToken && (
          <button
            disabled={busy}
            onClick={() => void run(async () => (setSt(await window.api.telegram.clearToken()), 'انمسح التوكن.'))}
            className="rounded-full border border-outline px-3 py-1.5 text-danger hover:bg-surface2 disabled:opacity-50"
          >
            امسح التوكن
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={st.enabled}
            disabled={!st.hasToken || !st.chatId}
            onChange={async (e) => setSt(await window.api.telegram.set({ enabled: e.target.checked }))}
          />
          فعّل التنبيه
        </label>
        <label className="flex items-center gap-2">
          بس إذا المهمة أطول من
          <input
            type="number"
            min={0}
            value={st.minSeconds}
            onChange={async (e) => setSt(await window.api.telegram.set({ minSeconds: Math.max(0, Number(e.target.value) || 0) }))}
            className="w-16 rounded-lg border border-outline bg-bg px-2 py-1 text-center"
          />
          ثانية
        </label>
      </div>
      {msg && <div className="mt-2 text-xs text-muted">{msg}</div>}
    </section>
  )
}
