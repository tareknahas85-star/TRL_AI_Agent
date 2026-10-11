import { ipcMain } from 'electron'
import { answerPairing, cancelPairing, initRemote, phoneApproval, removeDevice, setRemote, startPairing, status } from '../remote/host'
import { setPhoneApprovalHook } from '../computer/control'

export function registerRemoteHandlers(): void {
  setPhoneApprovalHook(phoneApproval)
  void initRemote().catch((e) => console.error('[remote] init failed:', e))
  ipcMain.handle('remote:get', () => status())
  ipcMain.handle('remote:set', (_e, p: unknown) => setRemote((p ?? {}) as never))
  ipcMain.handle('remote:pairStart', async () => {
    try {
      return { ok: true as const, ...(await startPairing()) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('remote:pairAnswer', (_e, ok: unknown) => answerPairing(ok === true))
  ipcMain.handle('remote:pairCancel', () => cancelPairing())
  if (process.env.AIR_BENCH === '1') {
    // test harness only: ask the paired phone for an approval exactly like the computer tools do
    ipcMain.handle('remote:benchApprove', async (_e, title: unknown, detail: unknown) => {
      const r = phoneApproval({ title: String(title), detail: String(detail), danger: false })
      return r ? await r.promise : null
    })
  }
  ipcMain.handle('remote:revoke', (_e, id: unknown) => {
    if (typeof id === 'string') removeDevice(id)
    return status()
  })
}
