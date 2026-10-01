import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer. All core logic (OpenRouter calls, skills, tools, key storage)
// runs in the main process; the UI only talks to it through these calls.
type ChatMode = { kind: 'free' } | { kind: 'auto' } | { kind: 'council' } | { kind: 'model'; id: string }
type ChatOpts = { tabId: string; projectId: string | null; mode: ChatMode }
type ChatResult = { content: string; meta?: string; cancelled?: boolean; failed?: boolean; needsChoice?: boolean }

const api = {
  chat: (userInput: string, history: { role: 'user' | 'assistant'; content: string }[] | undefined, opts: ChatOpts): Promise<ChatResult> =>
    ipcRenderer.invoke('chat:send', userInput, history, opts),
  retryChat: (opts: ChatOpts): Promise<ChatResult> => ipcRenderer.invoke('chat:retry', opts),
  cancelChat: (tabId: string): Promise<boolean> => ipcRenderer.invoke('chat:cancel', tabId),
  modelPicker: (): Promise<{ value: string; label: string; tier: string }[]> => ipcRenderer.invoke('models:picker'),
  spend: {
    get: (): Promise<boolean> => ipcRenderer.invoke('spend:get'),
    set: (on: boolean): Promise<boolean> => ipcRenderer.invoke('spend:set', on)
  },
  computer: {
    get: (): Promise<{ enabled: boolean; sessionAllowed: boolean }> => ipcRenderer.invoke('computer:get'),
    set: (on: boolean): Promise<{ enabled: boolean; sessionAllowed: boolean }> => ipcRenderer.invoke('computer:set', on),
    reset: (): Promise<{ enabled: boolean; sessionAllowed: boolean }> => ipcRenderer.invoke('computer:reset')
  },
  onStream: (cb: (tabId: string, kind: 'chunk' | 'reset', text?: string) => void): (() => void) => {
    const h = (_e: unknown, tabId: string, k: 'chunk' | 'reset', t?: string): void => cb(tabId, k, t)
    ipcRenderer.on('chat:stream', h)
    return () => ipcRenderer.removeListener('chat:stream', h)
  },
  status: (): Promise<{ key: boolean; ollama: boolean; localMaster: boolean; mcpOn: number; mcpTotal: number }> =>
    ipcRenderer.invoke('status:get'),
  onProgress: (cb: (tabId: string, text: string) => void): (() => void) => {
    const h = (_e: unknown, tabId: string, t: string): void => cb(tabId, t)
    ipcRenderer.on('chat:progress', h)
    return () => ipcRenderer.removeListener('chat:progress', h)
  },
  getKey: (key: string): Promise<string> => ipcRenderer.invoke('keys:get', key),
  setKey: (key: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke('keys:set', key, value),
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    get: (name: string) => ipcRenderer.invoke('skills:get', name),
    create: (name: string, content: string) => ipcRenderer.invoke('skills:create', name, content),
    delete: (name: string) => ipcRenderer.invoke('skills:delete', name),
    toggle: (name: string) => ipcRenderer.invoke('skills:toggle', name)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    get: (name: string) => ipcRenderer.invoke('mcp:get', name),
    add: (server: unknown) => ipcRenderer.invoke('mcp:add', server),
    remove: (name: string) => ipcRenderer.invoke('mcp:remove', name),
    test: (name: string) => ipcRenderer.invoke('mcp:test', name),
    toggle: (name: string) => ipcRenderer.invoke('mcp:toggle', name)
  },
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    toggle: (name: string) => ipcRenderer.invoke('tools:toggle', name),
    add: (tool: unknown) => ipcRenderer.invoke('tools:add', tool),
    remove: (name: string) => ipcRenderer.invoke('tools:remove', name)
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    detectLocal: () => ipcRenderer.invoke('models:detectLocal'),
    setPosition: (id: string, last: boolean) => ipcRenderer.invoke('models:setPosition', id, last),
    setKey: (id: string, key: string) => ipcRenderer.invoke('models:setKey', id, key),
    add: (m: unknown) => ipcRenderer.invoke('models:add', m),
    remove: (id: string) => ipcRenderer.invoke('models:remove', id),
    toggle: (id: string) => ipcRenderer.invoke('models:toggle', id),
    test: (id: string) => ipcRenderer.invoke('models:test', id),
    fetchRemote: (id: string, all?: boolean) => ipcRenderer.invoke('models:fetchRemote', id, all),
    importRemote: (id: string, items: (string | { id: string; free: boolean })[]) => ipcRenderer.invoke('models:importRemote', id, items)
  },
  connectors: {
    list: () => ipcRenderer.invoke('connectors:list'),
    active: (load?: boolean) => ipcRenderer.invoke('connectors:active', load),
    connect: (id: string) => ipcRenderer.invoke('connectors:connect', id),
    setup: (id: string, values: string[]) => ipcRenderer.invoke('connectors:setup', id, values),
    test: (id: string) => ipcRenderer.invoke('connectors:test', id),
    disconnect: (id: string) => ipcRenderer.invoke('connectors:disconnect', id),
    onCode: (cb: (id: string, code: string, url: string) => void) => {
      const h = (_e: unknown, id: string, code: string, url: string): void => cb(id, code, url)
      ipcRenderer.on('connectors:code', h)
      return () => ipcRenderer.removeListener('connectors:code', h)
    }
  },
  app: {
    about: () => ipcRenderer.invoke('app:about')
  },
  accounts: {
    get: () => ipcRenderer.invoke('accounts:get'),
    setEmail: (v: string) => ipcRenderer.invoke('accounts:setEmail', v),
    setWrite: (server: string, on: boolean) => ipcRenderer.invoke('accounts:setWrite', server, on),
    google: (action: 'connect' | 'test') => ipcRenderer.invoke('accounts:google', action),
    googleDisconnect: () => ipcRenderer.invoke('accounts:googleDisconnect'),
    googleCreds: () => ipcRenderer.invoke('accounts:googleCreds'),
    googleSetup: (idOrJson: string, secret: string) => ipcRenderer.invoke('accounts:googleSetup', idOrJson, secret)
  },
  masterMemory: {
    get: () => ipcRenderer.invoke('mm:get'),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('mm:update', id, patch),
    clearGeneral: () => ipcRenderer.invoke('mm:clearGeneral')
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    save: (e: { id?: string; title: string; content: string; enabled?: boolean }) => ipcRenderer.invoke('memory:save', e),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    toggle: (id: string) => ipcRenderer.invoke('memory:toggle', id),
    import: (entries: { title: string; content: string }[], source?: string) =>
      ipcRenderer.invoke('memory:import', entries, source),
    preview: () => ipcRenderer.invoke('memory:preview')
  },
  catalog: {
    list: () => ipcRenderer.invoke('catalog:list'),
    test: () => ipcRenderer.invoke('catalog:test'),
    fetch: () => ipcRenderer.invoke('catalog:fetch'),
    setEnabled: (ids: string[], on: boolean) => ipcRenderer.invoke('catalog:setEnabled', ids, on),
    move: (id: string, dir: 'up' | 'down') => ipcRenderer.invoke('catalog:move', id, dir)
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: (dir: string) => ipcRenderer.invoke('projects:add', dir),
    pick: () => ipcRenderer.invoke('projects:pick'),
    remove: (id: string) => ipcRenderer.invoke('projects:remove', id),
    setActive: (id: string | null) => ipcRenderer.invoke('projects:setActive', id)
  },
  conversations: {
    search: (q: string): Promise<{ id: string; snippet: string }[]> => ipcRenderer.invoke('conv:search', q),
    exportMd: (id: string): Promise<{ ok: boolean; error?: string; path?: string }> => ipcRenderer.invoke('conv:export', id),
    list: () => ipcRenderer.invoke('conv:list'),
    get: (id: string) => ipcRenderer.invoke('conv:get', id),
    save: (conv: unknown) => ipcRenderer.invoke('conv:save', conv),
    delete: (id: string) => ipcRenderer.invoke('conv:delete', id),
    pin: (id: string) => ipcRenderer.invoke('conv:pin', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('conv:rename', id, title)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
