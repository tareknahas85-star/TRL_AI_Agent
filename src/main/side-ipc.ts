// F28: IPC handlers for the side browser. Every handler runs behind the F11 sender guard (set up in index.ts),
// so only the app's own renderer can call them. Arguments are type-checked here (F12).
import { ipcMain, type BrowserWindow } from 'electron'
import { openSide, navigateSide, closeSide, setSideWidth, setSideOverlay, clearSideData, backSide, reloadSide, sideState } from './side-browser'

export function registerSideIpc(getWin: () => BrowserWindow | null): void {
  const withWin = (fn: (win: BrowserWindow) => unknown): unknown => {
    const win = getWin()
    if (!win || win.isDestroyed()) return { ok: false, error: 'النافذة الرئيسية مش متاحة' }
    return fn(win)
  }

  ipcMain.handle('side:open', (_e, url: unknown) => {
    if (typeof url !== 'string') return { ok: false, error: 'قيمة مو صالحة' }
    return withWin((win) => openSide(win, url))
  })

  ipcMain.handle('side:navigate', (_e, url: unknown) => {
    if (typeof url !== 'string') return { ok: false, error: 'قيمة مو صالحة' }
    return navigateSide(url)
  })

  ipcMain.handle('side:back', () => backSide())
  ipcMain.handle('side:reload', () => reloadSide())
  ipcMain.handle('side:close', () => closeSide())

  ipcMain.handle('side:setWidth', (_e, w: unknown) => {
    if (typeof w !== 'number' || !Number.isFinite(w)) return sideState()
    return setSideWidth(w)
  })

  ipcMain.handle('side:setOverlay', (_e, on: unknown) => {
    if (typeof on !== 'boolean') return sideState()
    return setSideOverlay(on)
  })

  ipcMain.handle('side:clearData', async () => {
    await clearSideData()
    return true
  })

  ipcMain.handle('side:state', () => sideState())
}
