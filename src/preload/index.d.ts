import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      chat: (userInput: string) => Promise<{ content: string; meta?: string }>
      getKey: (key: string) => Promise<string>
      setKey: (key: string, value: string) => Promise<boolean>
    }
  }
}
