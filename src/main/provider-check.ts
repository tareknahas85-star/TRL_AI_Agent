import { ipcMain } from 'electron'
import { hostOf } from '../core/hosts'
import { getApiKey } from '../store/secure-store'

// "Test key + discover models": one call per provider that hits its model-list endpoint with the saved key.
export type ProviderCheck = { ok: boolean; message: string; models: string[] }
type P = 'openai' | 'anthropic' | 'gemini' | 'openrouter'

const SPEC: Record<P, { key: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY'; label: string; url: () => string; headers: (k: string) => Record<string, string>; pick: (j: unknown) => string[] }> = {
  openai: {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI',
    url: () => 'https://api.openai.com/v1/models',
    headers: (k) => ({ authorization: 'Bearer ' + k }),
    pick: (j) => ((j as { data?: { id: string }[] }).data ?? []).map((m) => m.id)
  },
  anthropic: {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    url: () => 'https://api.anthropic.com/v1/models?limit=100',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
    pick: (j) => ((j as { data?: { id: string }[] }).data ?? []).map((m) => m.id)
  },
  gemini: {
    key: 'GEMINI_API_KEY',
    label: 'Gemini',
    url: () => hostOf('gemini') + '/models',
    headers: (k) => ({ authorization: 'Bearer ' + k }),
    pick: (j) => ((j as { data?: { id: string }[] }).data ?? []).map((m) => m.id.replace(/^models\//, ''))
  },
  openrouter: {
    key: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    url: () => hostOf('openrouter') + '/models',
    headers: (k) => ({ authorization: 'Bearer ' + k }),
    pick: (j) => ((j as { data?: { id: string }[] }).data ?? []).map((m) => m.id)
  }
}

export async function checkProvider(p: P): Promise<ProviderCheck> {
  const s = SPEC[p]
  const key = getApiKey(s.key)
  if (!key) return { ok: false, message: 'ما في مفتاح محفوظ', models: [] }
  try {
    const r = await fetch(s.url(), { headers: s.headers(key.trim()), signal: AbortSignal.timeout(20000) })
    if (r.status === 401 || r.status === 403) {
      const body = (await r.text().catch(() => '')).slice(0, 300)
      // 403 with a region/forbidden body = the provider blocks this country/IP, not a bad key (a bad key returns 401)
      if (r.status === 403 && /unsupported_country|country, region|territory|request not allowed|forbidden/i.test(body))
        return { ok: false, message: `محجوب حسب المنطقة/الـIP (403) — مش مشكلة بالمفتاح. شغّل VPN أو استعمل OpenRouter. رد المزوّد: ${body.replace(/\s+/g, ' ').slice(0, 120)}`, models: [] }
      return { ok: false, message: r.status === 401 ? `المفتاح مرفوض (401)` : `ممنوع (403): ${body.replace(/\s+/g, ' ').slice(0, 140)}`, models: [] }
    }
    if (!r.ok) return { ok: false, message: `خطأ ${r.status}: ` + (await r.text().catch(() => '')).slice(0, 140), models: [] }
    const models = [...new Set(s.pick(await r.json()))].sort()
    return { ok: true, message: `المفتاح شغّال، ${models.length} موديل متاح`, models }
  } catch (e) {
    return { ok: false, message: 'ما قدرت أوصل: ' + (e instanceof Error ? e.message : String(e)), models: [] }
  }
}

export function registerProviderCheck(): void {
  ipcMain.handle('provider:check', (_e, p: unknown) => (typeof p === 'string' && p in SPEC ? checkProvider(p as P) : { ok: false, message: 'مزوّد غير معروف', models: [] }))
}
