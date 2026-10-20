import { pathToFileURL } from 'url'

// Pure trust check for IPC senders (F11). Kept free of electron imports so it can be unit-tested.
// A sender is trusted only when its frame URL belongs to the app's own renderer:
// - production: a file:// URL under the renderer build directory
// - development: the same origin as the electron-vite dev server
export type TrustOptions = { devUrl?: string; rendererDir: string }

const norm = (s: string): string => s.replace(/\\/g, '/').toLowerCase()

export function isTrustedSenderUrl(senderUrl: string | undefined | null, opts: TrustOptions): boolean {
  if (!senderUrl) return false
  let u: URL
  try {
    u = new URL(senderUrl)
  } catch {
    return false
  }
  if (u.protocol === 'file:') {
    const base = norm(pathToFileURL(opts.rendererDir).href).replace(/\/?$/, '/')
    return norm(senderUrl).startsWith(base)
  }
  if (opts.devUrl) {
    try {
      return u.origin === new URL(opts.devUrl).origin
    } catch {
      return false
    }
  }
  return false
}
