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
export type ChatMode = { kind: 'free' } | { kind: 'auto' } | { kind: 'model'; id: string }
export type ChatOpts = { tabId: string; projectId: string | null; mode: ChatMode }
export type ChatResult = { content: string; meta?: string; cancelled?: boolean; failed?: boolean; needsChoice?: boolean }
export type ProjectMemoryInfo = { id: string; name: string; path: string; summary: string; tech: string[]; ports: number[]; decisions: string[]; updatedAt: number }
export type MasterMemoryView = { projects: ProjectMemoryInfo[]; general: { text: string; at: number }[]; conflicts: { kind: string; detail: string }[] }
export type ProjectInfo = { id: string; name: string; path: string }
export type StoredMessage = { role: 'user' | 'assistant'; content: string; meta?: string }
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
        get: () => Promise<{ enabled: boolean; sessionAllowed: boolean }>
        set: (on: boolean) => Promise<{ enabled: boolean; sessionAllowed: boolean }>
        reset: () => Promise<{ enabled: boolean; sessionAllowed: boolean }>
      }
      onStream: (cb: (tabId: string, kind: 'chunk' | 'reset', text?: string) => void) => () => void
      status: () => Promise<{ key: boolean; ollama: boolean; localMaster: boolean; mcpOn: number; mcpTotal: number }>
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
      projects: {
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
        rename: (id: string, title: string) => Promise<boolean>
      }
    }
  }
}
