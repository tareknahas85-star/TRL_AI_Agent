import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, Loader2 } from 'lucide-react'
import { CostDashboard } from './CostDashboard'

type ChatMessage = { role: 'user' | 'assistant'; content: string; meta?: string }

function Avatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#19c37d] text-white">
      <Bot size={18} />
    </div>
  )
}

export function ChatWindow() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const userMsg = input
    setMessages((m) => [...m, { role: 'user', content: userMsg }])
    setInput('')
    setLoading(true)
    try {
      // analyzeRequest -> executeWithSkill -> executeWithFallback all run in the main process.
      const { content, meta } = await window.api.chat(userMsg)
      setMessages((m) => [...m, { role: 'assistant', content, meta }])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Error: ' + (e instanceof Error ? e.message : String(e)) }
      ])
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white text-[#0d0d0d] dark:bg-[#212121] dark:text-[#ececec]">
      <div className="pt-3">
        <CostDashboard messages={messages} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 && !loading && (
            <p className="pt-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              جرب: مرحبا كيفك (بسيط -&gt; مجاني) | اكتبلي فانكشن بايثون ترتب مصفوفة (معقد -&gt; غالي + سكيل)
            </p>
          )}

          {messages.map((msg, i) =>
            msg.role === 'user' ? (
              <div
                key={i}
                className="ml-auto w-fit max-w-[80%] whitespace-pre-wrap rounded-2xl bg-[#f4f4f4] px-4 py-3 dark:bg-[#2f2f2f]"
              >
                {msg.content}
              </div>
            ) : (
              <div key={i} className="flex gap-3 border-t border-[#e5e5e5] pt-4 dark:border-[#2f2f2f]">
                <Avatar />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap leading-7">{msg.content}</div>
                  {msg.meta && (
                    <span className="mt-2 inline-block rounded-full bg-[#e5e5e5] px-2.5 py-1 text-xs text-zinc-600 dark:bg-[#424242] dark:text-zinc-300">
                      {msg.meta}
                    </span>
                  )}
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="flex items-center gap-3 border-t border-[#e5e5e5] pt-4 dark:border-[#2f2f2f]">
              <Avatar />
              <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <span>الماستر يختار أرخص موديل</span>
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="sticky bottom-0 bg-white px-4 pb-4 pt-2 dark:bg-[#212121]">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-[#d9d9d9] bg-[#f4f4f4] px-4 py-2 dark:border-[#424242] dark:bg-[#2f2f2f]">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="اكتب طلبك هنا..."
            className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-zinc-500"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            aria-label="إرسال"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition-opacity disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>
    </div>
  )
}
