import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isTrustedSenderUrl, type TrustOptions } from './ipc-trust'

// F11: central sender check. Wraps ipcMain.handle / ipcMain.on once at startup, so every handler
// registered afterwards is verified without editing each registration. Untrusted invoke calls get an error;
// untrusted one-way messages are dropped silently and logged.
let installed = false

function senderUrl(e: IpcMainEvent | IpcMainInvokeEvent): string | undefined {
  return e.senderFrame?.url ?? e.sender?.getURL()
}

export function installIpcSenderGuard(opts: TrustOptions): void {
  if (installed) return
  installed = true

  const rawHandle = ipcMain.handle.bind(ipcMain)
  const rawOn = ipcMain.on.bind(ipcMain)

  ipcMain.handle = ((channel: string, listener: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    rawHandle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSenderUrl(senderUrl(e), opts)) {
        console.warn('[ipc-guard] blocked invoke from untrusted sender:', channel, senderUrl(e))
        throw new Error('IPC sender not trusted')
      }
      return listener(e, ...args)
    })) as typeof ipcMain.handle

  ipcMain.on = ((channel: string, listener: (e: IpcMainEvent, ...args: unknown[]) => void) =>
    rawOn(channel, (e: IpcMainEvent, ...args: unknown[]) => {
      if (!isTrustedSenderUrl(senderUrl(e), opts)) {
        console.warn('[ipc-guard] dropped message from untrusted sender:', channel, senderUrl(e))
        return
      }
      listener(e, ...args)
    })) as typeof ipcMain.on
}
