// F28: validates the address the user types in the side browser.
// Only http and https pages are allowed. Anything else (file:, javascript:, data:, credentials in the URL) is refused.

export type SideUrlResult = { ok: true; url: string } | { ok: false; reason: string }

const MAX_LENGTH = 2048

export function checkSideUrl(input: string): SideUrlResult {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, reason: 'اكتب رابط أول' }
  if (raw.length > MAX_LENGTH) return { ok: false, reason: 'الرابط طويل زيادة' }

  // A bare address like "example.com" is treated as https.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { ok: false, reason: 'الرابط مش صحيح' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'بس صفحات http و https مسموحة' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'ما بنقبل روابط فيها كلمة مرور' }
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'الرابط ما فيه موقع' }
  }

  return { ok: true, url: parsed.toString() }
}

// Layout sizes in DIP (logical pixels).
export const SIDE_MIN_WIDTH = 320
export const SIDE_MAX_WIDTH = 900
export const SIDEBAR_WIDTH = 280
export const MAIN_MIN_WIDTH = 420

// The side panel width, clamped to its own limits. The window grows to fit it (see windowWidthFor).
export function clampSideWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDE_MIN_WIDTH
  return Math.round(Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, width)))
}

// The window width needed so the sidebar, the chat, and the panel all fit.
// Never shrinks the window, and never exceeds the screen's work area.
export function windowWidthFor(currentWidth: number, panelWidth: number, screenWidth: number): number {
  const needed = SIDEBAR_WIDTH + MAIN_MIN_WIDTH + panelWidth
  return Math.min(screenWidth, Math.max(currentWidth, needed))
}
