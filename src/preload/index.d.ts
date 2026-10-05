import { ElectronAPI } from '@electron-toolkit/preload'

export type SkillInfo = { name: string; description: string; content: string; enabled: boolean }
export type MCPServerInfo = {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}
export type ToolInfo = { name: string; description: string; enabled: boolean; custom?: boolean; command?: string }
export type Tier = 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'
export type CustomModelInfo = {
  id: string
  name: string
  model: string
  baseURL: string
  tier: Tier
  enabled: boolean
  hasKey: boolean
  last?: boolean
}
export type ChatMode = { kind: 'free' } | { kind: 'auto' } | { kind: 'council'; author?: string; critic?: string } | { kind: 'model'; id: string }
export type ChatOpts = { tabId: string; projectId: string | null; mode: ChatMode }
export type ChatResult = { content: string; meta?: string; cancelled?: boolean; failed?: boolean; needsChoice?: boolean }
export type ProjectMemoryInfo = { id: string; name: string; path: string; summary: string; tech: string[]; ports: number[]; decisions: string[]; updatedAt: number }
export type MasterMemoryView = { projects: ProjectMemoryInfo[]; general: { text: string; at: number }[]; conflicts: { kind: string; detail: string }[] }
export type ProjectInfo = { id: string; name: string; path: string; confidential?: boolean }
export type ScheduleInfo = {
  id: string
  name: string
  prompt: string
  projectId: string | null
  mode: 'free' | 'auto'
  kind: 'daily' | 'weekly' | 'interval'
  time: string
  days: number[]
  everyMin: number
  enabled: boolean
  createdAt: number
  lastRun?: number
  lastStatus?: 'ok' | 'failed' | 'running'
  lastResult?: string
  lastConversationId?: string
}
export type StoredMessage = { role: 'user' | 'assistant'; content: string; meta?: string; at?: number }
export type ConversationSummary = {
  id: string
  title: string
  projectId: string | null
  pinned: boolean
  createdAt: number
  updatedAt: number
  count: number
}
export type ConversationFull = Omit<ConversationSummary, 'count'> & { messages: StoredMessage[] }

export type FilePreviewInfo = { ok: boolean; kind?: string; name?: string; size?: number; text?: string; dataUrl?: string; mime?: string; note?: string }
export type TelegramInfo = { enabled: boolean; chatId: string; minSeconds: number; hasToken: boolean }
export type TaskRowInfo = {
  at: number
  convId: string
  convTitle: string
  projectId: string | null
  cost: number
  model: string
  tried: string[]
  escalated: boolean
  failures: number
  tools: string[]
  totalMs: number
  tokens: number
  tier: 'free' | 'cheap' | 'sub' | 'custom' | 'other'
  prompt: string
}
export type AttachmentInfo = {
  path: string
  name: string
  kind: 'text' | 'office' | 'pdf' | 'image' | 'audio' | 'video' | 'other'
  size: number
  text?: string
  note?: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      chat: (userInput: string, history: { role: 'user' | 'assistant'; content: string }[] | undefined, opts: ChatOpts) => Promise<ChatResult>
      retryChat: (opts: ChatOpts) => Promise<ChatResult>
      cancelChat: (tabId: string) => Promise<boolean>
      modelPicker: () => Promise<{ value: string; label: string; tier: string }[]>
      spend: {
        get: () => Promise<boolean>
        set: (on: boolean) => Promise<boolean>
      }
      computer: {
        get: () => Promise<{ enabled: boolean; sessionAllowed: boolean; autoApprove: boolean; fullAccess: boolean }>
        set: (on: boolean) => Promise<{ enabled: boolean; sessionAllowed: boolean; autoApprove: boolean; fullAccess: boolean }>
        reset: () => Promise<{ enabled: boolean; sessionAllowed: boolean; autoApprove: boolean; fullAccess: boolean }>
        setAuto: (on: boolean) => Promise<{ enabled: boolean; sessionAllowed: boolean; autoApprove: boolean; fullAccess: boolean }>
        setFull: (on: boolean) => Promise<{ enabled: boolean; sessionAllowed: boolean; autoApprove: boolean; fullAccess: boolean }>
      }
      onStream: (cb: (tabId: string, kind: 'chunk' | 'reset', text?: string) => void) => () => void
      status: () => Promise<{ key: boolean; ollama: boolean; localMaster: boolean; mcpOn: number; mcpTotal: number; free: { count: number; limit: number; limited: boolean } }>
      onProgress: (cb: (tabId: string, text: string) => void) => () => void
      getKey: (key: string) => Promise<string>
      setKey: (key: string, value: string) => Promise<boolean>
      skills: {
        list: () => Promise<SkillInfo[]>
        get: (name: string) => Promise<SkillInfo | null>
        create: (name: string, content: string) => Promise<{ ok: boolean; skill?: SkillInfo; error?: string }>
        delete: (name: string) => Promise<boolean>
        toggle: (name: string) => Promise<boolean | null>
      }
      mcp: {
        list: () => Promise<MCPServerInfo[]>
        get: (name: string) => Promise<MCPServerInfo | null>
        add: (server: MCPServerInfo) => Promise<{ ok: boolean; server?: MCPServerInfo; error?: string }>
        remove: (name: string) => Promise<boolean>
        test: (name: string) => Promise<{ ok: boolean; message: string }>
        toggle: (name: string) => Promise<boolean | null>
        scan: () => Promise<{ source: string; file: string; servers: MCPServerInfo[] }[]>
        scanPlugins: () => Promise<{ id: string; name: string; origin: string; version: string; skills: string[]; mcp: string[]; remoteMcp: number }[]>
        importPlugins: (ids: string[]) => Promise<{ skills: string[]; skippedSkills: string[]; mcp: string[]; skippedMcp: string[] }>
        parse: (text: string) => Promise<MCPServerInfo[]>
        import: (servers: MCPServerInfo[]) => Promise<{ added: string[]; skipped: string[] }>
      }
      schedules: {
        list: () => Promise<{ tasks: ScheduleInfo[]; running: string[] }>
        add: (t: Partial<ScheduleInfo>) => Promise<{ ok: boolean; task?: ScheduleInfo; error?: string }>
        update: (id: string, p: Partial<ScheduleInfo>) => Promise<{ ok: boolean; error?: string }>
        remove: (id: string) => Promise<boolean>
        run: (id: string) => Promise<boolean>
      }
      tools: {
        list: () => Promise<ToolInfo[]>
        toggle: (name: string) => Promise<boolean | null>
        add: (tool: { name: string; description: string; command: string }) => Promise<{ ok: boolean; error?: string }>
        remove: (name: string) => Promise<boolean>
      }
      models: {
        list: () => Promise<CustomModelInfo[]>
        detectLocal: () => Promise<{ runtime: string; baseURL: string; models: string[] }[]>
        fetchRemote: (id: string, all?: boolean) => Promise<{ ok: boolean; models?: { id: string; recommended: boolean; added: boolean; free: boolean }[]; error?: string }>
        importRemote: (id: string, items: (string | { id: string; free: boolean })[]) => Promise<number>
        setPosition: (id: string, last: boolean) => Promise<boolean>
        setKey: (id: string, key: string) => Promise<boolean>
        add: (m: {
          name: string
          model: string
          baseURL?: string
          apiKey?: string
          tier: Tier
        }) => Promise<{ ok: boolean; error?: string }>
        remove: (id: string) => Promise<boolean>
        toggle: (id: string) => Promise<boolean | null>
        test: (id: string) => Promise<{ ok: boolean; message: string }>
      }
      connectors: {
        active: (load?: boolean) => Promise<{ id: string; title: string; prefix: string; running: boolean; tools: number; names: string[] }[]>
        list: () => Promise<
          { id: string; title: string; subtitle: string; group: 'accounts' | 'device'; kind: 'remote' | 'local' | 'special' | 'token'; hint: string; fields?: string[]; connected: boolean; write: boolean; unavailable: string | null }[]
        >
        connect: (id: string) => Promise<{ ok: boolean; message: string }>
        setup: (id: string, values: string[]) => Promise<{ ok: boolean; message: string }>
        test: (id: string) => Promise<{ ok: boolean; message: string }>
        disconnect: (id: string) => Promise<{ ok: boolean; message: string }>
        onCode: (cb: (id: string, code: string, url: string) => void) => () => void
      }
      app: {
        about: () => Promise<{ version: string; electron: string; chrome: string; node: string; platform: string }>
        show: () => Promise<void>
        flash: () => Promise<void>
      }
      files: {
        exists: (paths: string[]) => Promise<boolean[]>
        preview: (p: string) => Promise<FilePreviewInfo>
        open: (p: string) => Promise<{ ok: boolean; error?: string }>
        reveal: (p: string) => Promise<boolean>
      }
      report: {
        tasks: () => Promise<TaskRowInfo[]>
        export: (csv: string) => Promise<{ ok: boolean; path?: string }>
        budget: (v?: number) => Promise<number>
      }
      telegram: {
        get: () => Promise<TelegramInfo>
        set: (p: { enabled?: boolean; chatId?: string; minSeconds?: number; token?: string }) => Promise<TelegramInfo>
        clearToken: () => Promise<TelegramInfo>
        detect: () => Promise<{ ok: boolean; chatId?: string; name?: string; error?: string }>
        test: () => Promise<{ ok: boolean; error?: string }>
      }
      attach: {
        pick: (projectId?: string | null) => Promise<AttachmentInfo[]>
        prepare: (paths: string[], projectId?: string | null) => Promise<AttachmentInfo[]>
        savePasted: (name: string, data: ArrayBuffer, projectId?: string | null) => Promise<AttachmentInfo[]>
        pathFor: (file: File) => string
      }
      accounts: {
        get: () => Promise<{ googleEmail: string; writeServers: string[]; connected: string[] }>
        setEmail: (v: string) => Promise<{ ok: boolean; error?: string }>
        setWrite: (server: string, on: boolean) => Promise<string[]>
        google: (action: 'connect' | 'test') => Promise<{ ok: boolean; message: string }>
        googleDisconnect: () => Promise<{ ok: boolean }>
        googleCreds: () => Promise<{ hasCreds: boolean; clientTail: string }>
        googleSetup: (idOrJson: string, secret: string) => Promise<{ ok: boolean; error?: string }>
      }
      masterMemory: {
        get: () => Promise<MasterMemoryView>
        update: (id: string, patch: Partial<Pick<ProjectMemoryInfo, 'summary' | 'tech' | 'ports' | 'decisions'>>) => Promise<boolean>
        clearGeneral: () => Promise<boolean>
      }
      memory: {
        list: () => Promise<{ id: string; title: string; content: string; enabled: boolean; source?: string }[]>
        save: (e: { id?: string; title: string; content: string; enabled?: boolean }) => Promise<{ ok: boolean; error?: string }>
        delete: (id: string) => Promise<boolean>
        toggle: (id: string) => Promise<boolean | null>
        import: (entries: { title: string; content: string }[], source?: string) => Promise<number>
        preview: () => Promise<{ text: string; count: number; truncated: boolean }>
      }
      catalog: {
        list: () => Promise<{
          fetchedAt: number
          models: {
            id: string
            name: string
            tier: 'TIER_1_FREE' | 'TIER_2_CHEAP' | 'TIER_3_EXPENSIVE'
            pricePerM: number
            context: number
            vision: boolean
            enabled: boolean
          }[]
        }>
        test: () => Promise<{ ok: boolean; message: string }>
        fetch: () => Promise<{ ok: boolean; message: string; added: number; total: number }>
        setEnabled: (ids: string[], on: boolean) => Promise<number>
        move: (id: string, dir: 'up' | 'down') => Promise<boolean>
      }
      claudeAcct: {
        get: () => Promise<{ cfg: { active: 'work' | 'personal'; auto: boolean }; work: { installed: boolean; loggedIn: boolean; email?: string; plan?: string }; personal: { installed: boolean; loggedIn: boolean; email?: string; plan?: string } }>
        set: (p: { active?: string; auto?: boolean }) => Promise<{ active: 'work' | 'personal'; auto: boolean }>
        login: () => Promise<{ ok: boolean; error?: string }>
      }
      effort: {
    get: () => Promise<string>
    set: (v: string) => Promise<string>
  }
  projects: {
    setConfidential: (id: string, on: boolean) => Promise<boolean>
        list: () => Promise<{ projects: ProjectInfo[]; activeId: string | null }>
        add: (dir: string) => Promise<{ ok: boolean; project?: ProjectInfo; error?: string }>
        pick: () => Promise<{ ok: boolean; project?: ProjectInfo; error?: string }>
        remove: (id: string) => Promise<boolean>
        setActive: (id: string | null) => Promise<boolean>
      }
      conversations: {
        search: (q: string) => Promise<{ id: string; snippet: string }[]>
        exportMd: (id: string) => Promise<{ ok: boolean; error?: string; path?: string }>
        list: () => Promise<ConversationSummary[]>
        get: (id: string) => Promise<ConversationFull | null>
        save: (conv: { id?: string; messages: StoredMessage[]; projectId?: string | null }) => Promise<ConversationSummary>
        delete: (id: string) => Promise<boolean>
        pin: (id: string) => Promise<boolean | null>
        setProject: (id: string, projectId: string | null) => Promise<boolean>
        rename: (id: string, title: string) => Promise<boolean>
      }
    }
  }
}
