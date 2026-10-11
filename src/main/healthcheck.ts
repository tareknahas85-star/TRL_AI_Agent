import { ipcMain, type WebContents } from 'electron'
import { spawn } from 'child_process'
import { loadMCPConfig, testMCPServer } from '../mcp/client'
import { AVAILABLE_TOOLS } from '../tools/file-tools'
import { listCustomTools } from '../core/workspace'
import { readState } from '../core/state'
import { getApiKey } from '../store/secure-store'
import { listCustomModels, testCustomModel } from '../core/custom-models'
import { checkProvider } from './provider-check'
import { hfVisionModels } from './hf'
import { connectorsHealth } from './connectors-ipc'
import { getPrefs } from '../core/prefs'
import { getFix } from '../tools/place-tools'

// "Full check" buttons: one click checks every item of a tab in parallel, each with its own short timeout.
// Nothing runs automatically at startup; a check can be cancelled; items the user disabled by hand are not checked.
export type CheckKind = 'mcp' | 'tools' | 'connectors' | 'models'
export type CheckItem = { id: string; label: string; state: 'ok' | 'fail' | 'skip'; message: string; ms: number }
export type CheckResult = { kind: CheckKind; items: CheckItem[]; ok: number; fail: number; skipped: number; cancelled: boolean }

const PER_ITEM_MS = 20000
const runs = new Map<CheckKind, { cancelled: boolean }>()

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        resolve({ ok: false, message: e instanceof Error ? e.message : String(e) } as unknown as T)
      }
    )
  })
}

async function pool<T>(arr: T[], n: number, fn: (x: T) => Promise<void>, cancelled: () => boolean): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, arr.length) }, async () => {
      while (i < arr.length && !cancelled()) await fn(arr[i++])
    })
  )
}

const onPath = (cmd: string): Promise<boolean> =>
  new Promise((resolve) => {
    const c = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], { shell: process.platform === 'win32', windowsHide: true, stdio: 'ignore' })
    c.on('error', () => resolve(false))
    c.on('exit', (code) => resolve(code === 0))
  })

type Job = { id: string; label: string; run: () => Promise<{ state: CheckItem['state']; message: string }> }

async function jobsFor(kind: CheckKind): Promise<Job[]> {
  const timeoutMsg = { ok: false, message: 'ما رد بالوقت (' + PER_ITEM_MS / 1000 + ' ث)' }
  if (kind === 'mcp') {
    const cfg = await loadMCPConfig()
    return cfg.servers.map((s) => ({
      id: s.name,
      label: s.name,
      run: async () => {
        if (s.enabled === false) return { state: 'skip' as const, message: 'معطّل يدوياً' }
        const r = await withTimeout(testMCPServer(s, PER_ITEM_MS), PER_ITEM_MS + 2000, () => timeoutMsg)
        return { state: r.ok ? ('ok' as const) : ('fail' as const), message: r.message.slice(0, 120) }
      }
    }))
  }
  if (kind === 'tools') {
    const disabled = readState().disabledTools
    const jobs: Job[] = AVAILABLE_TOOLS.map((t) => ({
      id: t.name,
      label: t.name,
      run: async () => (disabled.includes(t.name) ? { state: 'skip' as const, message: 'معطّلة يدوياً' } : { state: 'ok' as const, message: 'جاهزة' })
    }))
    for (const t of listCustomTools()) {
      jobs.push({
        id: t.name,
        label: t.name,
        run: async () => {
          if (disabled.includes(t.name)) return { state: 'skip' as const, message: 'معطّلة يدوياً' }
          const first = (t.command.trim().match(/^"([^"]+)"|^(\S+)/) ?? [])[1] ?? (t.command.trim().match(/^(\S+)/) ?? [])[1] ?? ''
          if (!first) return { state: 'fail' as const, message: 'أمر فاضي' }
          const builtin = /^(cd|dir|echo|type|set|where|ver|cls)$/i.test(first)
          return (await onPath(first)) || builtin ? { state: 'ok' as const, message: 'الأمر موجود: ' + first } : { state: 'fail' as const, message: 'الأمر مو موجود بالـ PATH: ' + first }
        }
      })
    }
    jobs.push({
      id: 'get_location',
      label: 'get_location',
      run: async () => {
        if (!getPrefs().locationEnabled) return { state: 'skip' as const, message: 'مطفية (الإعدادات ← عام ← الموقع)' }
        const f = await withTimeout(getFix(), PER_ITEM_MS, () => null)
        return f ? { state: 'ok' as const, message: `${f.source === 'phone-gps' ? 'GPS الموبايل' : f.source === 'windows-wifi' ? 'ويندوز (واي فاي)' : 'IP'}${f.accuracyM ? ' ~' + f.accuracyM + ' م' : ''}` } : { state: 'fail' as const, message: 'ما قدرت أحدد الموقع' }
      }
    })
    jobs.push({
      id: 'nearby_places',
      label: 'nearby_places (OpenStreetMap)',
      run: async () => {
        if (!getPrefs().locationEnabled) return { state: 'skip' as const, message: 'مطفية (الإعدادات ← عام ← الموقع)' }
        try {
          const r = await fetch('https://overpass-api.de/api/status', { signal: AbortSignal.timeout(PER_ITEM_MS) })
          return r.ok ? { state: 'ok' as const, message: 'Overpass شغّال' } : { state: 'fail' as const, message: 'Overpass رجّع ' + r.status }
        } catch (e) {
          return { state: 'fail' as const, message: 'ما وصلت لـ Overpass: ' + (e instanceof Error ? e.message : String(e)).slice(0, 80) }
        }
      }
    })
    return jobs
  }
  if (kind === 'connectors') {
    const h = await withTimeout(connectorsHealth(), 40000, () => [])
    return h.map((c) => ({
      id: c.id,
      label: c.title,
      run: async () => {
        if (!c.connected) return { state: 'skip' as const, message: 'مو متصل' }
        if (c.unavailable) return { state: 'fail' as const, message: c.unavailable }
        return c.tools > 0 ? { state: 'ok' as const, message: `شغّال (${c.tools} أداة)` } : { state: 'fail' as const, message: 'ما رجّع أدوات: غالباً بدو تسجيل دخول من جديد' }
      }
    }))
  }
  // models: provider keys + enabled custom models
  const jobs: Job[] = []
  for (const [p, key, label] of [
    ['openrouter', 'OPENROUTER_API_KEY', 'OpenRouter'],
    ['gemini', 'GEMINI_API_KEY', 'Gemini'],
    ['openai', 'OPENAI_API_KEY', 'OpenAI'],
    ['anthropic', 'ANTHROPIC_API_KEY', 'Anthropic']
  ] as const) {
    jobs.push({
      id: p,
      label,
      run: async () => {
        if (!getApiKey(key)) return { state: 'skip' as const, message: 'ما في مفتاح' }
        const r = await withTimeout(checkProvider(p), PER_ITEM_MS + 2000, () => ({ ok: false, message: timeoutMsg.message, models: [] as string[] }))
        return { state: r.ok ? ('ok' as const) : ('fail' as const), message: r.message.slice(0, 140) }
      }
    })
  }
  jobs.push({
    id: 'huggingface',
    label: 'Hugging Face',
    run: async () => {
      if (!getApiKey('HUGGINGFACE_API_KEY')) return { state: 'skip' as const, message: 'ما في مفتاح' }
      const r = await withTimeout(hfVisionModels(), PER_ITEM_MS, () => ({ ok: false, error: timeoutMsg.message, total: 0, models: [] }))
      return r.ok ? { state: 'ok' as const, message: `شغّال (${r.total} موديل رؤية)` } : { state: 'fail' as const, message: String(r.error ?? 'فشل').slice(0, 120) }
    }
  })
  for (const m of listCustomModels()) {
    jobs.push({
      id: 'custom:' + m.id,
      label: m.name,
      run: async () => {
        if (!m.enabled) return { state: 'skip' as const, message: 'معطّل يدوياً' }
        const r = await withTimeout(testCustomModel(m.id), PER_ITEM_MS + 5000, () => timeoutMsg)
        return { state: r.ok ? ('ok' as const) : ('fail' as const), message: r.message.slice(0, 120) }
      }
    })
  }
  return jobs
}

async function runCheck(sender: WebContents, kind: CheckKind): Promise<CheckResult> {
  const state = { cancelled: false }
  runs.set(kind, state)
  const items: CheckItem[] = []
  try {
    const jobs = await jobsFor(kind)
    await pool(
      jobs,
      kind === 'mcp' ? 5 : 6,
      async (j) => {
        const t0 = Date.now()
        let r: { state: CheckItem['state']; message: string }
        try {
          r = await j.run()
        } catch (e) {
          r = { state: 'fail', message: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120) }
        }
        if (state.cancelled) return
        const item: CheckItem = { id: j.id, label: j.label, state: r.state, message: r.message, ms: Date.now() - t0 }
        items.push(item)
        try {
          sender.send('check:item', kind, item)
        } catch {
          /* window closed */
        }
      },
      () => state.cancelled
    )
  } finally {
    if (runs.get(kind) === state) runs.delete(kind)
  }
  return {
    kind,
    items,
    ok: items.filter((i) => i.state === 'ok').length,
    fail: items.filter((i) => i.state === 'fail').length,
    skipped: items.filter((i) => i.state === 'skip').length,
    cancelled: state.cancelled
  }
}

export function registerHealthCheck(): void {
  ipcMain.handle('check:run', (event, kind: unknown) => {
    if (kind !== 'mcp' && kind !== 'tools' && kind !== 'connectors' && kind !== 'models') return null
    if (runs.has(kind)) return null // already running
    return runCheck(event.sender, kind)
  })
  ipcMain.handle('check:cancel', (_e, kind: unknown) => {
    const r = typeof kind === 'string' ? runs.get(kind as CheckKind) : undefined
    if (r) r.cancelled = true
    return !!r
  })
}
