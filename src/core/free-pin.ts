import { readJson, writeJson } from './json-store'
import { sendTelegram } from './telegram'

// A free model the user approved as the new first choice. It is never applied automatically:
// the weekly check only suggests it. If the pinned model fails 2 requests in a row (another model had to answer),
// the pin is removed and the router goes back to its default ranking.
export type Suggestion = { model: string; current: string; newScore: number; oldScore: number; at: string }
type PinFile = { pinned?: string; since?: string; fails: number; suggestion?: Suggestion; lastCheck: number }
const FILE = 'free-pin.json'
const load = (): PinFile => ({ fails: 0, lastCheck: 0, ...readJson<Partial<PinFile>>(FILE, {}) })
const save = (p: PinFile): void => writeJson(FILE, p)
const tell = (text: string): void => void sendTelegram(text).catch(() => undefined)

export const pinnedFree = (): string | null => load().pinned ?? null
export const pinState = (): PinFile => load()
export const lastFreeCheck = (): number => load().lastCheck
export const markFreeCheck = (): void => save({ ...load(), lastCheck: Date.now() })

export function setSuggestion(s: Suggestion | null): void {
  const p = load()
  if (s) p.suggestion = s
  else delete p.suggestion
  save(p)
  if (s) tell(`💡 اقتراح موديل مجاني أقوى\nالحالي: ${s.current} (${s.oldScore}/100)\nالمقترح: ${s.model} (${s.newScore}/100)\nافتح صفحة الموديلات وقرر: موافقة أو تجاهل. ما انغيّر شي لحد ما توافق.`)
}

export function applyPin(model: string): void {
  const p = load()
  save({ ...p, pinned: model, since: new Date().toISOString(), fails: 0, suggestion: undefined })
}

export function clearPin(): void {
  const p = load()
  delete p.pinned
  delete p.since
  save({ ...p, fails: 0 })
}

// Called when a request finished successfully with `usedModel` after trying `tried`.
export function notePinOutcome(usedModel: string, tried: string[]): void {
  const p = load()
  if (!p.pinned) return
  if (usedModel === p.pinned) {
    if (p.fails) save({ ...p, fails: 0 })
    return
  }
  if (!tried.includes(p.pinned)) return
  p.fails += 1
  if (p.fails >= 2) {
    const bad = p.pinned
    clearPin()
    tell(`↩️ رجعنا للديفولت: الموديل ${bad} فشل بطلبين ورا بعض، فانلغى التثبيت.`)
    return
  }
  save(p)
}