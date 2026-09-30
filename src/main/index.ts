import 'dotenv/config'
import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers, hydrateEnvFromStore } from './ipc'
import { closeAllMcp } from '../mcp/runtime'
import { stopOwnedOllama } from '../core/ollama'

let mainWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function showMain(): void {
  if (!mainWin || mainWin.isDestroyed()) return
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

// Closing the window (X) only hides it to the system tray; the app keeps running until the tray's "خروج".
function createTray(): void {
  if (tray) return
  const img = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('AI Router OS')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'فتح AI Router OS', click: showMain },
      { type: 'separator' },
      {
        label: 'خروج',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showMain)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWin = mainWindow
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  hydrateEnvFromStore()
  registerIpcHandlers()

  createWindow()
  createTray()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMain()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('before-quit', () => {
  quitting = true
  tray?.destroy()
  closeAllMcp()
  stopOwnedOllama()
})

app.on('window-all-closed', () => {
  // Stay alive in the tray; quitting happens from the tray menu.
})

// A second launch just brings the existing window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMain)
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
