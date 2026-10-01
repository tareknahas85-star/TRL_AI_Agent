import { BrowserWindow, dialog } from 'electron'
import { readJson, writeJson } from './json-store'

// Connected accounts (Google first). Write access is OFF by default and every write action asks the user first.
export type Accounts = { googleEmail: string; writeServers: string[]; connected: string[] }
const FILE = 'accounts.json'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function getAccounts(): Accounts {
  const a = readJson<Partial<Accounts>>(FILE, {})
  return {
    googleEmail: typeof a.googleEmail === 'string' ? a.googleEmail : '',
    writeServers: Array.isArray(a.writeServers) ? a.writeServers.filter((x): x is string => typeof x === 'string') : [],
    connected: Array.isArray(a.connected) ? a.connected.filter((x): x is string => typeof x === 'string') : []
  }
}

export function setGoogleEmail(email: string): { ok: boolean; error?: string } {
  const v = email.trim()
  if (v && !EMAIL_RE.test(v)) return { ok: false, error: 'صيغة الإيميل غير صحيحة' }
  writeJson(FILE, { ...getAccounts(), googleEmail: v })
  return { ok: true }
}

export function setWriteServer(server: string, on: boolean): string[] {
  const a = getAccounts()
  const next = on ? [...new Set([...a.writeServers, server])] : a.writeServers.filter((s) => s !== server)
  writeJson(FILE, { ...a, writeServers: next })
  if (!on) sessionAllowed.delete(server)
  return next
}

export function setConnected(id: string, on: boolean): void {
  const a = getAccounts()
  writeJson(FILE, { ...a, connected: on ? [...new Set([...a.connected, id])] : a.connected.filter((s) => s !== id) })
}

export const writeAllowed = (server: string): boolean => getAccounts().writeServers.includes(server)

const sessionAllowed = new Set<string>()

/** Asks the user before a tool that changes data runs. Returns false when denied. */
export async function approveWrite(server: string, tool: string, args: Record<string, unknown>): Promise<boolean> {
  if (sessionAllowed.has(server)) return true
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win && !win.isVisible()) win.show()
  let detail = ''
  try {
    detail = JSON.stringify(args, null, 2)
  } catch {
    detail = String(args)
  }
  const opts = {
    type: 'warning' as const,
    title: 'الحسابات - طلب موافقة',
    message: `النموذج بدو ينفّذ: ${server} ← ${tool}`,
    detail: detail.slice(0, 1500),
    buttons: ['سماح مرة واحدة', 'سماح لهالسيرفر بهالجلسة', 'رفض'],
    defaultId: 2,
    cancelId: 2,
    noLink: true
  }
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (r.response === 1) sessionAllowed.add(server)
  return r.response === 0 || r.response === 1
}
