import { ipcMain } from 'electron'
import { getPrefs, setPrefs } from '../core/prefs'
import { testLocation } from '../tools/place-tools'
import { correctStyle, forgetItem, learnView, refreshSummary, resetLearning } from '../core/learning'

// Preferences (location tools, learning on/off, private mode, first-run interests) and the "what the app learned" page.
export function registerLearnHandlers(): void {
  ipcMain.handle('prefs:get', () => getPrefs())
  ipcMain.handle('prefs:set', (_e, patch: unknown) => setPrefs((patch ?? {}) as never))
  ipcMain.handle('prefs:testLocation', () => testLocation())
  ipcMain.handle('learn:get', () => learnView())
  ipcMain.handle('learn:forget', (_e, kind: unknown, key: unknown) => typeof kind === 'string' && typeof key === 'string' && forgetItem(kind, key))
  ipcMain.handle('learn:correct', (_e, kind: unknown, value: unknown) => typeof kind === 'string' && typeof value === 'string' && correctStyle(kind, value))
  ipcMain.handle('learn:reset', () => {
    resetLearning()
    return true
  })
  ipcMain.handle('learn:refreshSummary', () => refreshSummary())
}
