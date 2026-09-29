import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer. All core logic (OpenRouter calls, skills, tools, key storage)
// runs in the main process; the UI only talks to it through these calls.
const api = {
  chat: (userInput: string): Promise<{ content: string; meta?: string }> =>
    ipcRenderer.invoke('chat:send', userInput),
  getKey: (key: string): Promise<string> => ipcRenderer.invoke('keys:get', key),
  setKey: (key: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke('keys:set', key, value)
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
