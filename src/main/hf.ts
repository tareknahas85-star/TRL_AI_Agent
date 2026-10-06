import { ipcMain } from 'electron'
import { getApiKey } from '../store/secure-store'
import { readJson, writeJson } from '../core/json-store'

// Hugging Face Inference Providers (OpenAI-compatible). Used as an extra image-description source.
export type HfModel = { id: string; providers: string[]; recommended: boolean }
const FILE = 'vision.json'
const RECOMMENDED = /gemma|qwen|llama-4|vl\b/i
// 1x1 red PNG, only used to check that a model really accepts an image.
const TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

export const hfChosen = (): string => readJson<{ hfModel?: string }>(FILE, {}).hfModel ?? ''

export async function hfVisionModels(): Promise<{ ok: boolean; error?: string; total: number; models: HfModel[] }> {
  const key = getApiKey('HUGGINGFACE_API_KEY')
  if (!key) return { ok: false, error: 'ما في مفتاح Hugging Face', total: 0, models: [] }
  try {
    const r = await fetch('https://router.huggingface.co/v1/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) })
    if (!r.ok) return { ok: false, error: r.status === 401 ? 'المفتاح مرفوض (401)' : 'خطأ ' + r.status, total: 0, models: [] }
    const j = (await r.json()) as { data?: { id: string; architecture?: { input_modalities?: string[] }; providers?: { provider: string }[] }[] }
    const all = j.data ?? []
    const models = all
      .filter((m) => m.architecture?.input_modalities?.includes('image'))
      .map((m) => ({ id: m.id, providers: (m.providers ?? []).map((p) => p.provider), recommended: RECOMMENDED.test(m.id) }))
      .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.id.localeCompare(b.id))
    return { ok: true, total: all.length, models }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), total: 0, models: [] }
  }
}

async function hfTestModel(model: string): Promise<{ ok: boolean; message: string }> {
  const key = getApiKey('HUGGINGFACE_API_KEY')
  if (!key) return { ok: false, message: 'ما في مفتاح' }
  const t0 = Date.now()
  try {
    const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What color is this image? Answer in one word.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + TEST_PNG } }] }]
      }),
      signal: AbortSignal.timeout(60000)
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    if (!r.ok) return { ok: false, message: r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160) }
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const text = (j.choices?.[0]?.message?.content ?? '').trim()
    return { ok: true, message: 'اشتغل بـ' + secs + ' ثانية' + (text ? ' — ردّ: ' + text.slice(0, 60) : ' (رد فاضي، ممكن موديل تفكير: جرّب غيرو)') }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function registerHfHandlers(): void {
  ipcMain.handle('hf:models', () => hfVisionModels())
  ipcMain.handle('hf:getModel', () => hfChosen())
  ipcMain.handle('hf:setModel', (_e, id: unknown) => {
    writeJson(FILE, { hfModel: typeof id === 'string' ? id : '' })
    return true
  })
  ipcMain.handle('hf:testModel', (_e, id: unknown) => hfTestModel(typeof id === 'string' ? id : ''))
}