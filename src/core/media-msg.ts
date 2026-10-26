// A generated image / video / audio lives in the chat as an ordinary assistant message whose text carries a small
// marker. That keeps it inside the normal conversation storage (which only keeps role/content/meta/at) and
// the renderer turns the marker into a card with a preview. Pure helpers, no electron.

export type MediaMsgKind = 'image' | 'video' | 'audio'
export interface MediaRef {
  /** kind */
  k: MediaMsgKind
  /** file path on this PC */
  p: string
  /** model label */
  m: string
  /** model id (to offer "try another model") */
  i: string
  /** prompt */
  q: string
  /** badge color */
  c?: string
}

const TAG = '[[media:v1:'
const LABEL: Record<MediaMsgKind, string> = { image: 'صورة', video: 'فيديو', audio: 'صوت' }

export function encodeMediaMsg(ref: MediaRef): string {
  return `${LABEL[ref.k]} من ${ref.m}\n\n${TAG}${encodeURIComponent(JSON.stringify(ref))}]]`
}

export function parseMediaMsg(content: string): { ref: MediaRef; text: string } | null {
  const a = content.indexOf(TAG)
  if (a < 0) return null
  const b = content.indexOf(']]', a)
  if (b < 0) return null
  try {
    const j = JSON.parse(decodeURIComponent(content.slice(a + TAG.length, b))) as Partial<MediaRef>
    if ((j.k !== 'image' && j.k !== 'video' && j.k !== 'audio') || typeof j.p !== 'string' || typeof j.m !== 'string' || typeof j.i !== 'string' || typeof j.q !== 'string') return null
    return { ref: { k: j.k, p: j.p, m: j.m, i: j.i, q: j.q, c: typeof j.c === 'string' ? j.c : undefined }, text: content.slice(0, a).trim() }
  } catch {
    return null
  }
}

/** First model after the used one (same kind, available, not a site) so "try another" really changes the model. */
export function nextModelId(ids: string[], used: string): string {
  const rest = ids.filter((x) => x !== used)
  return rest[0] ?? 'auto'
}
