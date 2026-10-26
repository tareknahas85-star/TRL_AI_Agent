// Pure helpers for custom (user-added) models that make images or speech instead of chat.

export type CustomKind = 'chat' | 'image' | 'audio' | 'video'

/** Rough guess of what a model id does, from its name. The user confirms it in the add form. */
export function guessKind(model: string, name = ''): CustomKind {
  const s = (model + ' ' + name).toLowerCase()
  if (/(^|[/\-_ .:])(veo|sora|kling|runway|video)([/\-_ .:\d]|$)/.test(s)) return 'video'
  if (/(^|[/\-_ .:])(tts|speech|voice)([/\-_ .:]|$)|eleven|kokoro|xtts|piper|bark\b/.test(s)) return 'audio'
  if (/flux|diffusion|dall-?e|imagen|image|sdxl|stable-?|midjourney|nano.?banana|seedream|ideogram|recraft/.test(s)) return 'image'
  return 'chat'
}

export const isChatKind = (k: unknown): boolean => k === undefined || k === null || k === 'chat'
export const normKind = (k: unknown): CustomKind => (k === 'image' || k === 'audio' || k === 'video' ? k : 'chat')

export interface VideoJob {
  id?: string
  status?: string
  url?: string
  b64?: string
  error?: string
}

/** A video response in the OpenAI /videos shape (job id + status) or one that already carries the file (data[0].url / b64_json / url). */
export function parseVideoJob(j: unknown): VideoJob {
  const o = (j ?? {}) as { id?: unknown; status?: unknown; url?: unknown; error?: unknown; data?: { url?: unknown; b64_json?: unknown }[]; video?: { url?: unknown } }
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const err = typeof o.error === 'string' ? o.error : s((o.error as { message?: unknown } | undefined)?.message)
  return {
    id: s(o.id),
    status: s(o.status)?.toLowerCase(),
    url: s(o.data?.[0]?.url) ?? s(o.video?.url) ?? s(o.url),
    b64: s(o.data?.[0]?.b64_json),
    error: err
  }
}

/** Image out of either an OpenAI images response or an OpenRouter chat response (modalities: image). */
export function parseImageResponse(j: unknown): { b64?: string; url?: string } | null {
  const o = j as {
    data?: { b64_json?: string; url?: string }[]
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]
  }
  const d = o?.data?.[0]
  if (d?.b64_json) return { b64: d.b64_json }
  if (d?.url) return { url: d.url }
  const u = o?.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (typeof u === 'string' && u) {
    const m = u.match(/^data:image\/[\w+.-]+;base64,(.+)$/)
    return m ? { b64: m[1] } : { url: u }
  }
  return null
}
