import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot, Clock, Cpu, FolderKanban, FolderOpen, MessageSquare, Moon, Palette, Pin, PinOff, Plug, Plus, Settings as SettingsIcon,
  Sun, Trash2, User, Download, Search, X, Bell, BellOff, Pencil, FolderPlus
} from 'lucide-react'
import appIcon from './assets/icon.png'
import { ChatWindow } from '../../ui/ChatWindow'
import { DONE_KEY, Onboarding, readName } from '../../ui/Onboarding'
import { MCPPage } from '../../ui/MCPPage'
import { ModelsPage } from '../../ui/ModelsPage'
import { ProjectsPage } from '../../ui/ProjectsPage'
import { SchedulePage } from '../../ui/SchedulePage'
import { TasksReportPage } from '../../ui/TasksReportPage'
import { Settings } from '../../ui/Settings'
import { SkillsPage } from '../../ui/SkillsPage'
import { ToolsPage } from '../../ui/ToolsPage'
import { ThemeProvider, useTheme } from '../../ui/ThemeContext'
import { Hub } from '../../ui/components/ui'
import type { ChatMode, ConversationSummary, ProjectInfo, StoredMessage } from '../../preload/index.d'

const OWNER = { name: 'Tarek Nahhas', email: 'tareknahas@live.com', github: 'https://github.com/tareknahas85-star' }

function AboutBadge({ onSetup }: { onSetup: () => void }) {
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
          <div className="text-[11px] text-muted">مايسترو الموديلات</div>
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
                    {copied === 'mail' ? 'اننسخ' : 'نسخ'}
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
              onClick={() => {
                setOpen(false)
                onSetup()
              }}
              className="mt-4 w-full rounded-full border border-outline px-4 py-2 text-sm hover:bg-surface2"
            >
              معالج الإعداد (شغّله من جديد)
            </button>
            <button
              disabled={!info}
              onClick={() => copy(sys, 'sys')}
              className="mt-4 w-full rounded-full border border-outline px-4 py-2 text-sm hover:bg-surface2 disabled:opacity-50"
            >
              {copied === 'sys' ? 'اننسخ' : 'نسخ معلومات النظام (للدعم)'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

type Nav = 'chat' | 'projects' | 'tasks' | 'models' | 'extensions' | 'settings'

const NAV_ITEMS: { id: Nav; label: string; icon: typeof Bot }[] = [
  { id: 'chat', label: 'المحادثات', icon: MessageSquare },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban },
  { id: 'tasks', label: 'المهام', icon: Clock },
  { id: 'models', label: 'الموديلات', icon: Cpu },
  { id: 'extensions', label: 'الإضافات', icon: Plug },
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
  const { theme, toggleTheme, palette, togglePalette } = useTheme()
  const [activeNav, setActiveNav] = useState<Nav>('chat')
  const [convs, setConvs] = useState<ConversationSummary[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [ready, setReady] = useState(false)
  const [wizard, setWizard] = useState(false)
  const [uname, setUname] = useState(readName)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [sound, setSound] = useState<boolean>(() => {
    try {
      return localStorage.getItem('air.sound') !== '0'
    } catch {
      return true
    }
  })
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string; sub: boolean } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [flash, setFlash] = useState('')
  const activeRef = useRef<{ tab: string | null; nav: Nav }>({ tab: null, nav: 'chat' })
  const prevBusy = useRef<Record<string, boolean>>({})
  const tabsRef = useRef<Tab[]>([])
  useEffect(() => {
    window.api
      .status()
      .then((s) => {
        let done = false
        try {
          done = localStorage.getItem(DONE_KEY) === '1'
        } catch {
          /* ignore */
        }
        if (!s.key && !done) setWizard(true)
      })
      .catch(() => undefined)
  }, [])
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
    setDone((d) => (d[id] ? { ...d, [id]: false } : d))
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
      if (!confirm('هالتبويب عم يشتغل على طلب. تسكيره بيوقف الطلب. تكمل؟')) return
      void window.api.cancelChat(id)
    }
    const idx = tabs.findIndex((t) => t.id === id)
    let next = tabs.filter((t) => t.id !== id)
    if (!next.length) next = [{ id: newId(), convId: null, initial: [], projectId: null, mode: defaultMode.current, title: 'محادثة جديدة' }]
    setTabs(next)
    if (activeTabId === id) setActiveTabId(next[Math.min(idx, next.length - 1)].id)
  }
  const patchTab = (id: string, patch: Partial<Tab>): void => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  // ---- completion alert: dot on the tab + sound + system notification + taskbar flash (only when you are not looking at that chat)
  const beep = (): void => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AC()
      ;[660, 880].forEach((f, i) => {
        const o = ac.createOscillator()
        const g = ac.createGain()
        o.frequency.value = f
        o.connect(g)
        g.connect(ac.destination)
        const t = ac.currentTime + i * 0.18
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
        o.start(t)
        o.stop(t + 0.18)
      })
      setTimeout(() => void ac.close().catch(() => undefined), 900)
    } catch {
      /* no audio available */
    }
  }
  const onBusyTab = (id: string, b: boolean): void => {
    setBusy((x) => (x[id] === b ? x : { ...x, [id]: b }))
    const was = prevBusy.current[id] === true
    prevBusy.current[id] = b
    if (!(was && !b)) return
    const here = activeRef.current.tab === id && activeRef.current.nav === 'chat' && document.hasFocus()
    if (here) return
    setDone((d) => ({ ...d, [id]: true }))
    if (sound) beep()
    try {
      const title = tabsRef.current.find((x) => x.id === id)?.title ?? 'محادثة'
      const n = new Notification('TRL_AI_Agent', { body: title + ' — خلصت المهمة', silent: true })
      n.onclick = () => {
        void window.api.app.show()
        focusTab(id)
      }
    } catch {
      /* notifications unavailable */
    }
    void window.api.app.flash()
  }

  const flashMsg = (m: string): void => {
    setFlash(m)
    setTimeout(() => setFlash(''), 3500)
  }
  const moveToProject = async (convId: string, projectId: string | null): Promise<void> => {
    setCtx(null)
    const ok = await window.api.conversations.setProject(convId, projectId)
    if (!ok) return flashMsg('ما قدرت أنقل المحادثة')
    setTabs((ts) => ts.map((t) => (t.convId === convId ? { ...t, projectId } : t)))
    const p = projects.find((x) => x.id === projectId)
    flashMsg(projectId ? 'انضافت لمشروع «' + (p?.name ?? '') + '»' + (p?.confidential ? ' 🔒' : '') : 'انشالت من المشروع')
    void loadConvs()
  }
  const commitRename = async (): Promise<void> => {
    const r = renaming
    setRenaming(null)
    if (!r || !r.value.trim()) return
    const title = r.value.trim()
    await window.api.conversations.rename(r.id, title)
    setTabs((ts) => ts.map((t) => (t.convId === r.id && !t.projectId ? { ...t, title: title.slice(0, 30) } : t)))
    void loadConvs()
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  useEffect(() => {
    activeRef.current = { tab: activeTabId, nav: activeNav }
    tabsRef.current = tabs
  })
  // Ctrl+Tab / Ctrl+Shift+Tab: next / previous chat tab. Esc closes the context menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const ts = tabsRef.current
        if (ts.length < 2) return
        const i = ts.findIndex((t) => t.id === activeRef.current.tab)
        const n = ts[(i + (e.shiftKey ? -1 : 1) + ts.length) % ts.length]
        setActiveTabId(n.id)
        setActiveNav('chat')
        setDone((d) => (d[n.id] ? { ...d, [n.id]: false } : d))
      } else if (e.key === 'Escape') {
        setCtx(null)
        setRenaming(null)
      }
    }
    const onFocus = (): void => {
      const id = activeRef.current.tab
      if (id && activeRef.current.nav === 'chat') setDone((d) => (d[id] ? { ...d, [id]: false } : d))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return (
    <div className="flex h-screen w-full bg-bg text-fg">
      <aside className="flex w-[280px] shrink-0 flex-col border-e border-outline bg-surface p-3">
        <AboutBadge onSetup={() => setWizard(true)} />

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
            {shownConvs.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted">{hits ? 'ما في نتائج' : 'ما في محادثات بعد'}</p>}
            {shownConvs.map((c) => (
              <div
                key={c.id}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtx({ x: e.clientX, y: e.clientY, id: c.id, sub: false })
                }}
                className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm hover:bg-surface2 ${c.id === activeTab?.convId ? 'bg-surface2' : ''}`}
              >
                {renaming?.id === c.id ? (
                  <input
                    autoFocus
                    dir="auto"
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => void commitRename()}
                    className="min-w-0 flex-1 rounded-lg border border-primary bg-bg px-2 py-1 text-sm outline-none"
                  />
                ) : (
                <button onClick={() => openConv(c.id)} className="min-w-0 flex-1 text-start">
                  <div className="truncate">{c.title}</div>
                  <div className="text-[11px] text-muted">
                    {hits ? hits[c.id] : `${new Date(c.updatedAt).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })} · ${c.count} رسالة`}
                  </div>
                </button>
                )}
                <button
                  aria-label={c.pinned ? 'شيل التثبيت' : 'تثبيت'}
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
                    if (!confirm('بدك تحذف هالمحادثة؟')) return
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

        {flash && <div className="mt-2 rounded-xl bg-primary/15 px-3 py-2 text-xs text-primary">{flash}</div>}
        <div className="mt-2 space-y-1 border-t border-outline pt-2">
          <button onClick={toggleTheme} className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm hover:bg-surface2">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
          </button>
          <button onClick={togglePalette} className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm hover:bg-surface2">
            <Palette size={18} />
            <span>{palette === 'syrian' ? 'الألوان الافتراضية' : 'الهوية السورية'}</span>
          </button>
          <button
            onClick={() => {
              const v = !sound
              setSound(v)
              try {
                localStorage.setItem('air.sound', v ? '1' : '0')
              } catch {
                /* ignore */
              }
              if (v) beep()
            }}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm hover:bg-surface2"
          >
            {sound ? <Bell size={18} /> : <BellOff size={18} />}
            <span>{sound ? 'صوت التنبيه: شغال' : 'صوت التنبيه: مطفي'}</span>
          </button>
          <div className="flex items-center gap-3 px-4 py-2 text-sm">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface2">
              <User size={16} />
            </div>
            <span>{uname}</span>
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
                  {done[t.id] && !busy[t.id] && <span className="h-2 w-2 shrink-0 rounded-full bg-success" title="خلصت المهمة" />}
                </button>
                <button aria-label="سكّر التبويب" onClick={() => closeTab(t.id)} className="rounded-full p-0.5 hover:bg-outline">
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
              onBusy={(b) => onBusyTab(t.id, b)}
              onSaved={(id, title) => {
                patchTab(t.id, { convId: id, ...(t.projectId || !title ? {} : { title: title.slice(0, 30) }) })
                loadConvs()
              }}
            />
          ))}
        {activeNav === 'tasks' && (
            <Hub
              title="المهام"
              subtitle="المهام المجدولة وتقرير كل ما اشتغل"
              storageKey="air.tasks.tab"
              tabs={[
                { id: 'schedule', label: 'المجدولة', node: <SchedulePage /> },
                { id: 'report', label: 'التقرير', node: <TasksReportPage onOpenConv={(id) => void openConv(id)} /> }
              ]}
            />
          )}
      {activeNav === 'projects' && (
          <ProjectsPage onChanged={loadProjects} onOpen={openProject} openIds={tabs.map((t) => t.projectId).filter(Boolean) as string[]} />
        )}
        {activeNav === 'models' && <ModelsPage />}
        {activeNav === 'extensions' && (
            <Hub
              title="الإضافات"
              subtitle="سيرفرات MCP والسكيلز والأدوات: كل شي بيوسّع قدرات الوكيل"
              storageKey="air.ext.tab"
              tabs={[
                { id: 'mcp', label: 'MCP Servers', node: <MCPPage /> },
                { id: 'skills', label: 'السكيلز', node: <SkillsPage /> },
                { id: 'tools', label: 'الأدوات', node: <ToolsPage /> }
              ]}
            />
          )}
        {activeNav === 'settings' && <Settings variant="page" />}
      </main>
      {ctx &&
        (() => {
          const c = convs.find((x) => x.id === ctx.id)
          if (!c) return null
          const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start hover:bg-surface2'
          return (
            <div className="fixed inset-0 z-50" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null) }}>
              <div
                className="absolute w-56 rounded-xl border border-outline bg-surface p-1 text-sm shadow-card"
                style={{ left: Math.max(4, Math.min(ctx.x, window.innerWidth - 232)), top: Math.max(4, Math.min(ctx.y, window.innerHeight - 300)) }}
                onClick={(e) => e.stopPropagation()}
              >
                <button className={item} onClick={() => setCtx({ ...ctx, sub: !ctx.sub })}>
                  <FolderPlus size={14} /> إضافة لمشروع {ctx.sub ? '▴' : '▾'}
                </button>
                {ctx.sub && (
                  <div className="max-h-48 overflow-y-auto border-y border-outline py-1">
                    {projects.length === 0 && <div className="px-3 py-2 text-xs text-muted">ما في مشاريع. ضيف مشروع من صفحة المشاريع.</div>}
                    {projects.map((p) => (
                      <button key={p.id} className={item} onClick={() => void moveToProject(c.id, p.id)}>
                        📁 <span className="truncate">{p.name}</span>
                        {p.confidential ? ' 🔒' : ''}
                        {c.projectId === p.id ? ' ✓' : ''}
                      </button>
                    ))}
                    {c.projectId && (
                      <button className={item} onClick={() => void moveToProject(c.id, null)}>
                        ✖ بدون مشروع
                      </button>
                    )}
                  </div>
                )}
                <button
                  className={item}
                  onClick={() => {
                    setCtx(null)
                    setRenaming({ id: c.id, value: c.title })
                  }}
                >
                  <Pencil size={14} /> إعادة تسمية
                </button>
                <button
                  className={item}
                  onClick={async () => {
                    setCtx(null)
                    await window.api.conversations.pin(c.id)
                    void loadConvs()
                  }}
                >
                  {c.pinned ? <PinOff size={14} /> : <Pin size={14} />} {c.pinned ? 'شيل التثبيت' : 'تثبيت'}
                </button>
                <button
                  className={item}
                  onClick={() => {
                    setCtx(null)
                    void window.api.conversations.exportMd(c.id)
                  }}
                >
                  <Download size={14} /> تصدير Markdown
                </button>
                <button
                  className={item + ' text-danger'}
                  onClick={async () => {
                    setCtx(null)
                    if (!confirm('بدك تحذف هالمحادثة؟')) return
                    await window.api.conversations.delete(c.id)
                    const t = tabs.find((x) => x.convId === c.id)
                    if (t) closeTab(t.id)
                    void loadConvs()
                  }}
                >
                  <Trash2 size={14} /> حذف
                </button>
              </div>
            </div>
          )
        })()}
      {wizard && (
        <Onboarding
          onClose={() => {
            setUname(readName())
            setWizard(false)
          }}
        />
      )}
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
