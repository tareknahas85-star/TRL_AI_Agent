import { useState } from 'react'
import { MessageSquare, Moon, Plus, Settings as SettingsIcon, Sun } from 'lucide-react'
import { ChatWindow } from '../../ui/ChatWindow'
import { Settings } from '../../ui/Settings'
import { ThemeProvider, useTheme } from '../../ui/ThemeContext'

// Mock conversations for now
const MOCK_CONVERSATIONS = ['مقارنة أسعار الموديلات', 'كتابة فانكشن بايثون', 'ملخص مقال بحثي']

const sidebarButton =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#0d0d0d] hover:bg-black/5 dark:text-[#ececec] dark:hover:bg-white/10'

function Shell() {
  const { theme, toggleTheme } = useTheme()
  const [showSettings, setShowSettings] = useState(false)
  const [chatKey, setChatKey] = useState(0)

  return (
    <div className="flex h-screen w-full bg-white text-[#0d0d0d] dark:bg-[#212121] dark:text-[#ececec]">
      <aside className="flex w-[260px] shrink-0 flex-col bg-[#f9f9f9] p-2 dark:bg-[#171717]">
        <button className={sidebarButton + ' justify-between'} onClick={() => setChatKey((k) => k + 1)}>
          <span>محادثة جديدة</span>
          <Plus size={18} />
        </button>

        <div className="mt-4 flex-1 space-y-1 overflow-y-auto">
          {MOCK_CONVERSATIONS.map((title) => (
            <button key={title} className={sidebarButton}>
              <MessageSquare size={16} className="shrink-0 opacity-60" />
              <span className="truncate">{title}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1 border-t border-black/10 pt-2 dark:border-white/10">
          <button className={sidebarButton} onClick={() => setShowSettings(true)}>
            <SettingsIcon size={18} />
            <span>الإعدادات</span>
          </button>
          <button className={sidebarButton} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="py-3 text-center text-sm font-semibold">AI Router OS</header>
        <ChatWindow key={chatKey} />
      </main>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  )
}
export default App
