import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot, Cpu, FolderKanban, FolderOpen, MessageSquare, Moon, Pin, PinOff, Plug, Plus, Settings as SettingsIcon,
  Sparkles, Sun, Trash2, User, Wrench, Download, Search, X
} from 'lucide-react'
import appIcon from './assets/icon.png'
import { ChatWindow } from '../../ui/ChatWindow'
import { MCPPage } from '../../ui/MCPPage'
import { ModelsPage } from '../../ui/ModelsPage'
import { ProjectsPage } from '../../ui/ProjectsPage'
import { Settings } from '../../ui/Settings'
import { SkillsPage } from '../../ui/SkillsPage'
import { ToolsPage } from '../../ui/ToolsPage'
import { ThemeProvider, useTheme } from '../../ui/ThemeContext'
import type { ChatMode, ConversationSummary, ProjectInfo, StoredMessage } from '../../preload/index.d'

const OWNER = { name: 'Tarek Nahhas', email: 'tareknahas@live.com', github: 'https://github.com/tareknahas85-star' }

function AboutBadge() {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<{ version: string; electron: string; chrome: string; node: string; platform: string } | null>(null)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    if (open && !info) window.api.app.about().then(setInfo).catch(() => undefined)
  }, [open, info])
  const copy = (text: string, key: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key)
        setTimeout(() => setCopied(''), 1500)
      })
      .catch(() => undefined)
  }
  const sys = info ? `TRL_AI_Agent v${info.version} | Electron ${info.electron} | Chromium ${info.chrome} | Node ${info.node} | ${info.platform}` : ''
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="عن البرنامج"
        className="mb-4 flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-start hover:bg-surface2"
      >
        <img src={appIcon} alt="" className="h-9 w-9 rounded-2xl shadow-card" />
        <div className="leading-tight">
          <div className="text-base font-semibold">TRL_AI_Agent</div>
          <div className="text-[11px] text-muted">مايسترو النماذج</div>
        </div>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="w-[380px] max-w-[92vw] rounded-card border border-outline bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <img src={appIcon} alt="" className="h-14 w-14 rounded-2xl shadow-card" />
              <div className="flex-1">
                <div className="text-lg font-semibold">TRL_AI_Agent</div>
                <div className="text-xs text-muted" dir="ltr">
                  {info ? 'v' + info.version : '…'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:bg-surface2">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">المطوّر</span>
                <span dir="ltr">{OWNER.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">البريد</span>
                <span className="flex items-center gap-2" dir="ltr">
                  <a href={'mailto:' + OWNER.email} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {OWNER.email}
                  </a>
                  <button onClick={() => copy(OWNER.email, 'mail')} className="text-[11px] text-muted hover:text-fg">
                    {copied === 'mail' ? 'تم النسخ' : 'نسخ'}
                  </button>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">GitHub</span>
                <a href={OWNER.github} target="_blank" rel="noreferrer" className="text-primary hover:underline" dir="ltr">
                  github.com/tareknahas85-star
                </a>
              </div>
              {info && (
                <div className="rounded-xl bg-surface2 p-2 text-[11px] text-muted" dir="ltr">
                  Electron {info.electron} · Chromium {info.chrome} · Node {info.node} · {info.platform}
                </div>
              )}
            </div>
            <button
              disabled={!info}
              onClick={() => copy(sys, 'sys')}
              className="mt-4 w-full rounded-full border border-outline px-4 py-2 text-sm hover:bg-surface2 disabled:opacity-50"
            >
              {copied === 'sys' ? 'تم النسخ' : 'نسخ معلومات النظام (للدعم)'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

type Nav = 'chat' | 'projects' | 'models' | 'skills' | 'mcp' | 'tools' | 'settings'

const NAV_ITEMS: { id: Nav; label: string; icon: typeof Bot }[] = [
  { id: 'chat', label: 'المحادثات', icon: MessageSquare },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban },
  { id: 'models', label: 'النماذج', icon: Cpu },
  { id: 'skills', label: 'السكيلز', icon: Sparkles },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'tools', label: 'الأدوات', icon: Wrench },
  { id: 'settings', label: 'الإعدادات', icon: SettingsIcon }
]

type Tab = {
  id: string
  convId: string | null
  initial: StoredMessage[]
  projectId: string | null
  mode: ChatMode
  title: string
}

const TABS_KEY = 'air.tabs.v1'
const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const readSaved = (): { tabs: Omit<Tab, 'initial'>[]; active: string | null } | null => {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function Shell() {
  const { theme, toggleTheme } = useTheme()
  const [activeNav, setActiveNav] = useState<Nav>('chat')
  const [convs, setConvs] = useState<ConversationSummary[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [ready, setReady] = useState(false)
  const defaultMode = useRef<ChatMode>({ kind: 'free' })
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    const t = setTimeout(() => {
      window.api.conversations.search(q).then((r) => setHits(Object.fromEntries(r.map((x) => [x.id, x.snippet]))))
    }, 250)
    return () => clearTimeout(t)
  }, [query])
  const shownConvs = hits ? convs.filter((c) => c.id in hits) : convs

  const loadConvs = useCallback(() => window.api.conversations.list().then(setConvs), [])
  const loadProjects = useCallback(async () => {
    const d = await window.api.projects.list()
    setProjects(d.projects)
  }, [])

  // Restore the tabs that were open last time (messages come from the saved conversations).
  useEffect(() => {
    let alive = true
    void (async () => {
      loadConvs()
      loadProjects()
      try {
        // New tabs start on free-only unless the user turned the global guard off.
        defaultMode.current = (await window.api.spend.get()) ? { kind: 'free' } : { kind: 'auto' }
      } catch {
        /* keep free */
      }
      const saved = readSaved()
      const restored: Tab[] = []
      for (const t of saved?.tabs ?? []) {
        let initial: StoredMessage[] = []
        if (t.convId) {
          const c = await window.api.conversations.get(t.convId)
          if (!c) continue
          initial = c.messages
        }
        restored.push({ ...t, mode: t.mode ?? { kind: 'free' }, initial })
      }
      if (!alive) return
      if (!restored.length) restored.push({ id: newId(), convId: null, initial: [], projectId: null, mode: defaultMode.current, title: 'محادثة جديدة' })
      setTabs(restored)
      setActiveTabId(restored.find((t) => t.id === saved?.active)?.id ?? restored[0].id)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [loadConvs, loadProjects])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(
        TABS_KEY,
        JSON.stringify({ tabs: tabs.map((t) => ({ id: t.id, convId: t.convId, projectId: t.projectId, mode: t.mode, title: t.title })), active: activeTabId })
      )
    } catch {
      /* storage unavailable */
    }
  }, [tabs, activeTabId, ready])

  const focusTab = (id: string): void => {
    setActiveTabId(id)
    setActiveNav('chat')
  }
  const newTab = (projectId: string | null = null, title = 'محادثة جديدة'): void => {
    const t: Tab = { id: newId(), convId: null, initial: [], projectId, mode: defaultMode.current, title }
    setTabs((ts) => [...ts, t])
    focusTab(t.id)
  }
  const openConv = async (id: string): Promise<void> => {
    const existing = tabs.find((t) => t.convId === id)
    if (existing) return focusTab(existing.id)
    const c = await window.api.conversations.get(id)
    if (!c) return
    const t: Tab = { id: newId(), convId: id, initial: c.messages, projectId: c.projectId, mode: defaultMode.current, title: c.title }
    setTabs((ts) => [...ts, t])
    focusTab(t.id)
  }
  const openProject = (p: ProjectInfo): void => {
    const existing = tabs.find((t) => t.projectId === p.id)
    if (existing) return focusTab(existing.id)
    newTab(p.id, p.name)
  }
  const closeTab = (id: string): void => {
    if (busy[id]) {
      if (!confirm('هالتبويب عم يشتغل على طلب. إغلاقه بيوقف الطلب. تكمل؟')) return
      void window.api.cancelChat(id)
    }
    const idx = tabs.findIndex((t) => t.id === id)
    let next = tabs.filter((t) => t.id !== id)
    if (!next.length) next = [{ id: newId(), convId: null, initial: [], projectId: null, mode: defaultMode.current, title: 'محادثة جديدة' }]
    setTabs(next)
    if (activeTabId === id) setActiveTabId(next[Math.min(idx, next.length - 1)].id)
  }
  const patchTab = (id: string, patch: Partial<Tab>): void => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div className="flex h-screen w-full bg-bg text-fg">
      <aside className="flex w-[280px] shrink-0 flex-col border-e border-outline bg-surface p-3">
        <AboutBadge />

        <nav className="space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm ${
                activeNav === id ? 'bg-primary/15 font-medium text-primary' : 'hover:bg-surface2'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-outline pt-3">
          <button onClick={() => newTab(null)} className="mb-2 flex items-center justify-between rounded-full border border-outline px-4 py-2 text-sm hover:bg-surface2">
            <span>محادثة جديدة</span>
            <Plus size={16} />
          </button>
          <div className="mb-2 flex items-center gap-2 rounded-full border border-outline px-3 py-1.5">
            <Search size={14} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث بالمحادثات…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {shownConvs.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted">{hits ? 'لا نتائج' : 'لا محادثات بعد'}</p>}
            {shownConvs.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm hover:bg-surface2 ${c.id === activeTab?.convId ? 'bg-surface2' : ''}`}
              >
                <button onClick={() => openConv(c.id)} className="min-w-0 flex-1 text-start">
                  <div className="truncate">{c.title}</div>
                  <div className="text-[11px] text-muted">
                    {hits ? hits[c.id] : `${new Date(c.updatedAt).toLocaleDateString('ar')} · ${c.count} رسالة`}
                  </div>
                </button>
                <button
                  aria-label={c.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
                  className={`rounded-full p-1 hover:bg-outline ${c.pinned ? 'text-primary' : 'text-muted opacity-0 group-hover:opacity-100'}`}
                  onClick={async () => {
                    await window.api.conversations.pin(c.id)
                    loadConvs()
                  }}
                >
                  {c.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                </button>
                <button
                  aria-label="تصدير"
                  title="تصدير كملف Markdown"
                  className="rounded-full p-1 text-muted opacity-0 hover:bg-outline group-hover:opacity-100"
                  onClick={() => window.api.conversations.exportMd(c.id)}
                >
                  <Download size={14} />
                </button>
                <button
                  aria-label="حذف"
                  className="rounded-full p-1 text-muted opacity-0 hover:bg-outline hover:text-danger group-hover:opacity-100"
                  onClick={async () => {
                    if (!confirm('حذف هالمحادثة؟')) return
                    await window.api.conversations.delete(c.id)
                    const t = tabs.find((x) => x.convId === c.id)
                    if (t) closeTab(t.id)
                    loadConvs()
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2 space-y-1 border-t border-outline pt-2">
          <button onClick={toggleTheme} className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm hover:bg-surface2">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
          </button>
          <div className="flex items-center gap-3 px-4 py-2 text-sm">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface2">
              <User size={16} />
            </div>
            <span>Tarek</span>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-outline bg-surface px-2 pt-2" role="tablist">
          {tabs.map((t) => {
            const on = t.id === activeTabId && activeNav === 'chat'
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={on}
                className={`group flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-xl border border-b-0 px-3 py-1.5 text-xs ${
                  on ? 'border-outline bg-bg font-medium text-fg' : 'border-transparent text-muted hover:bg-surface2'
                }`}
              >
                <button onClick={() => focusTab(t.id)} className="flex min-w-0 items-center gap-1.5">
                  {t.projectId ? <FolderOpen size={13} className="shrink-0 text-primary" /> : <MessageSquare size={13} className="shrink-0" />}
                  <span className="truncate">{t.title}</span>
                  {busy[t.id] && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" title="عم يشتغل" />}
                </button>
                <button aria-label="إغلاق التبويب" onClick={() => closeTab(t.id)} className="rounded-full p-0.5 hover:bg-outline">
                  <X size={12} />
                </button>
              </div>
            )
          })}
          <button aria-label="تبويب جديد" title="محادثة جديدة" onClick={() => newTab(null)} className="mb-1 shrink-0 rounded-full p-1.5 text-muted hover:bg-surface2">
            <Plus size={14} />
          </button>
        </div>

        {ready &&
          tabs.map((t) => (
            <ChatWindow
              key={t.id}
              tabId={t.id}
              active={activeNav === 'chat' && t.id === activeTabId}
              conversationId={t.convId}
              initialMessages={t.initial}
              project={projects.find((p) => p.id === t.projectId) ?? null}
              mode={t.mode}
              onModeChange={(m) => patchTab(t.id, { mode: m })}
              onBusy={(b) => setBusy((x) => (x[t.id] === b ? x : { ...x, [t.id]: b }))}
              onSaved={(id, title) => {
                patchTab(t.id, { convId: id, ...(t.projectId || !title ? {} : { title: title.slice(0, 30) }) })
                loadConvs()
              }}
            />
          ))}
        {activeNav === 'projects' && (
          <ProjectsPage onChanged={loadProjects} onOpen={openProject} openIds={tabs.map((t) => t.projectId).filter(Boolean) as string[]} />
        )}
        {activeNav === 'models' && <ModelsPage />}
        {activeNav === 'skills' && <SkillsPage />}
        {activeNav === 'mcp' && <MCPPage />}
        {activeNav === 'tools' && <ToolsPage />}
        {activeNav === 'settings' && <Settings variant="page" />}
      </main>
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
