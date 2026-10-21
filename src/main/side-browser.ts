// F28: side browser panel. A WebContentsView attached to the main window, on its own isolated session.
// Layout: the panel sits on the LEFT edge, below a TOOLBAR_HEIGHT strip that the renderer draws (address bar).
// The window widens to fit the panel. While a popup/approval is open, the page is detached so the popup shows on top.
// Hardening (see spec): no preload, no IPC access, no contextIsolation bypass, permissions denied,
// downloads blocked, external popups opened in the system browser, http(s) only.
import { WebContentsView, session, shell, screen, type BrowserWindow } from 'electron'
import { checkSideUrl, clampSideWidth, windowWidthFor } from '../core/side-url'

const PARTITION = 'persist:side-browser'
// Must match the height of the toolbar the renderer draws (h-11 = 44px).
export const TOOLBAR_HEIGHT = 44

export type SideState = { open: boolean; url: string | null; width: number; canGoBack: boolean }

let view: WebContentsView | null = null
let attachedTo: BrowserWindow | null = null
let width = 420
let currentUrl: string | null = null
let hardened = false
// True while a popup/approval is open: the page is detached (kept alive) so the popup can draw over it.
let overlayHidden = false
// Window content width before the panel widened it. Restored when the panel closes.
let widthBeforeSide: number | null = null

function hardenSession(): void {
  if (hardened) return
  hardened = true
  const sess = session.fromPartition(PARTITION)
  // Every permission (camera, mic, location, notifications, ...) is refused.
  sess.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
  sess.setPermissionCheckHandler(() => false)
  // Downloads are off in v1.
  sess.on('will-download', (event) => event.preventDefault())
}

function createView(): WebContentsView {
  hardenSession()
  const v = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  })

  const wc = v.webContents
  // Only http(s) may navigate; anything else (file:, custom schemes) is cancelled.
  wc.on('will-navigate', (event, url) => {
    if (!checkSideUrl(url).ok) event.preventDefault()
  })
  wc.on('will-redirect', (event, url) => {
    if (!checkSideUrl(url).ok) event.preventDefault()
  })
  // New windows never open inside the panel; safe links go to the system browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (checkSideUrl(url).ok) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('did-navigate', (_e, url) => {
    currentUrl = url
    notifyChanged()
  })
  wc.on('did-navigate-in-page', (_e, url) => {
    currentUrl = url
    notifyChanged()
  })
  return v
}

// Tells the renderer the panel state changed (page navigated, went back, etc.).
function notifyChanged(): void {
  if (attachedTo && !attachedTo.isDestroyed()) attachedTo.webContents.send('side:changed', sideState())
}

// Grows the window so the sidebar, the chat, and the panel all fit on screen (never shrinks it).
function fitWindow(win: BrowserWindow): void {
  if (win.isMaximized() || win.isFullScreen()) return
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  const current = win.getContentBounds().width
  const target = windowWidthFor(current, width, area.width)
  if (target === current) return
  // Remember the width from before the first expansion, so closing the panel can restore it.
  if (widthBeforeSide === null) widthBeforeSide = current
  win.setContentSize(target, win.getContentBounds().height)
  // If the window now runs past the right edge of the screen, slide it left.
  const b = win.getBounds()
  const maxX = area.x + area.width - b.width
  if (b.x > maxX) win.setPosition(Math.max(area.x, maxX), b.y)
}

function layout(win: BrowserWindow): void {
  if (!view) return
  fitWindow(win)
  const { height: totalH } = win.getContentBounds()
  width = clampSideWidth(width)
  view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, totalH - TOOLBAR_HEIGHT) })
}

function detachFrom(win: BrowserWindow): void {
  if (view && !overlayHidden) win.contentView.removeChildView(view)
}

function ensureAttached(win: BrowserWindow): void {
  if (!view) view = createView()
  if (attachedTo !== win) {
    if (attachedTo) detachFrom(attachedTo)
    attachedTo = win
    if (!overlayHidden) win.contentView.addChildView(view)
  }
  layout(win)
}

export function openSide(win: BrowserWindow, rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  const checked = checkSideUrl(rawUrl)
  if (!checked.ok) return { ok: false, error: checked.reason }
  ensureAttached(win)
  currentUrl = checked.url
  void view!.webContents.loadURL(checked.url).catch(() => undefined)
  return { ok: true, url: checked.url }
}

export function navigateSide(rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  if (!view) return { ok: false, error: 'المتصفح الجانبي مغلق' }
  const checked = checkSideUrl(rawUrl)
  if (!checked.ok) return { ok: false, error: checked.reason }
  currentUrl = checked.url
  void view.webContents.loadURL(checked.url).catch(() => undefined)
  return { ok: true, url: checked.url }
}

export function backSide(): SideState {
  if (view && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
  return sideState()
}

export function reloadSide(): SideState {
  if (view) view.webContents.reload()
  return sideState()
}

export function setSideWidth(w: number): SideState {
  width = w
  if (attachedTo && view) layout(attachedTo)
  return sideState()
}

// Called by the renderer when a popup/approval opens or closes. Hiding keeps the page loaded.
export function setSideOverlay(on: boolean): SideState {
  overlayHidden = on
  if (!view || !attachedTo || attachedTo.isDestroyed()) return sideState()
  if (on) {
    attachedTo.contentView.removeChildView(view)
  } else {
    attachedTo.contentView.addChildView(view)
    layout(attachedTo)
  }
  return sideState()
}

export function closeSide(): SideState {
  const win = attachedTo
  if (win && view) detachFrom(win)
  // Put the window back to the width it had before the panel widened it.
  if (win && !win.isDestroyed() && widthBeforeSide !== null && !win.isMaximized() && !win.isFullScreen()) {
    win.setContentSize(widthBeforeSide, win.getContentBounds().height)
  }
  widthBeforeSide = null
  attachedTo = null
  overlayHidden = false
  if (view) {
    view.webContents.close()
    view = null
  }
  currentUrl = null
  return sideState()
}

// Keeps the panel sized to the window when the window is resized.
export function onWindowResized(win: BrowserWindow): void {
  if (attachedTo === win) layout(win)
}

export async function clearSideData(): Promise<void> {
  const sess = session.fromPartition(PARTITION)
  await sess.clearStorageData()
  await sess.clearCache()
}

export function sideState(): SideState {
  return {
    open: view !== null && attachedTo !== null,
    url: currentUrl,
    width,
    canGoBack: view !== null && view.webContents.navigationHistory.canGoBack()
  }
}
