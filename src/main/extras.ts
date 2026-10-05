import { dialog, ipcMain, nativeImage, shell } from 'electron'
import fsp from 'fs/promises'
import path from 'path'
import { prepareFile } from './attach'
import { listCatalog } from '../core/catalog'
import { readJson, writeJson } from '../core/json-store'
import { getConversation, listConversations } from '../core/workspace'
import { clearTelegramToken, detectChatId, sendTelegram, setTelegram, telegramState } from '../core/telegram'

// ---------- files created by the model: exists / preview / open / reveal ----------
const RUNNABLE = new Set('exe bat cmd com msi scr vbs vbe js jse wsf wsh ps1 psm1 lnk reg dll jar hta cpl'.split(' '))
const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4'
}
const IMG = new Set('png jpg jpeg gif webp bmp ico'.split(' '))
const extOf = (p: string): string => path.extname(p).slice(1).toLowerCase()
const asPath = (p: unknown): string => (typeof p === 'string' && path.isAbsolute(p) ? path.normalize(p) : '')

export type FilePreview = { ok: boolean; kind?: string; name?: string; size?: number; text?: string; dataUrl?: string; mime?: string; note?: string }

async function preview(file: string): Promise<FilePreview> {
  let st
  try {
    st = await fsp.stat(file)
    if (!st.isFile()) return { ok: false, note: 'مش ملف' }
  } catch {
    return { ok: false, note: 'الملف مش موجود' }
  }
  const ext = extOf(file)
  const name = path.basename(file)
  if (IMG.has(ext)) {
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const s = Math.min(1, 1400 / Math.max(width, height))
      const out = s < 1 ? img.resize({ width: Math.round(width * s), height: Math.round(height * s) }) : img
      return { ok: true, kind: 'image', name, size: st.size, dataUrl: 'data:image/png;base64,' + out.toPNG().toString('base64') }
    }
  }
  if (MIME[ext]) {
    if (st.size > 25_000_000) return { ok: true, kind: 'media-big', name, size: st.size, note: 'الملف كبير للمعاينة، افتحو بالزر' }
    const buf = await fsp.readFile(file)
    return { ok: true, kind: MIME[ext].startsWith('video') ? 'video' : 'audio', name, size: st.size, mime: MIME[ext], dataUrl: `data:${MIME[ext]};base64,${buf.toString('base64')}` }
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico'].includes(ext)) {
    return { ok: true, kind: 'other', name, size: st.size, note: 'ما قدرت أعرض الصورة، افتحها بالزر' }
  }
  // text / office / pdf: reuse the attach extractor (no model calls for these kinds)
  const a = await prepareFile(file)
  if (a.text) return { ok: true, kind: a.kind, name, size: st.size, text: a.text, note: a.note }
  return { ok: true, kind: a.kind, name, size: st.size, note: a.note ?? 'ما في معاينة لهالنوع، افتحو بالزر' }
}

// ---------- tasks report (from saved conversations) ----------
export type TaskRow = {
  at: number
  convId: string
  convTitle: string
  projectId: string | null
  cost: number
  model: string
  tried: string[]
  escalated: boolean
  failures: number
  tools: string[]
  totalMs: number
  tokens: number
  tier: 'free' | 'cheap' | 'sub' | 'custom' | 'other'
  prompt: string
}

function parseMeta(meta: string): Omit<TaskRow, 'at' | 'convId' | 'convTitle' | 'prompt' | 'projectId' | 'cost'> | null {
  const model = meta.match(/^Model:\s*([^|\[]+?)(?:\s*\[[^\]]*\])?(?:\s*·[^|]*)?\s*(?:🔒)?\s*\|/)?.[1]?.trim()
  if (!model) return null
  const tried = (meta.match(/\| Tried:\s*([^|]*?)\s*\|\s*Stats:/)?.[1] ?? '').split('->').map((s) => s.trim()).filter(Boolean)
  let st: { totalMs?: number; promptTokens?: number; completionTokens?: number; tools?: string[]; failures?: unknown[] } = {}
  try {
    st = JSON.parse(meta.slice(meta.indexOf('Stats:') + 6).trim())
  } catch {
    /* old messages without stats */
  }
  const tier = meta.includes('استخدمت موديل مجاني') || meta.includes('مجاني') ? 'free' : meta.includes('اشتراكك') ? 'sub' : meta.includes('المخصص') ? 'custom' : meta.includes('رخيص') ? 'cheap' : 'other'
  return {
    model,
    tried,
    escalated: tried.length > 1,
    failures: Array.isArray(st.failures) ? st.failures.length : Math.max(0, tried.length - 1),
    tools: st.tools ?? [],
    totalMs: st.totalMs ?? 0,
    tokens: (st.promptTokens ?? 0) + (st.completionTokens ?? 0),
    tier
  }
}

// Estimated cost in USD: total tokens x the catalog's blended price per million (free / subscription / unknown = 0).
function estCost(model: string, tokens: number): number {
  if (!tokens) return 0
  try {
    const id = model.replace(/:free$/, '')
    const m = listCatalog().models.find((x) => x.id === model || x.id === id)
    return m && m.pricePerM > 0 && !model.endsWith(':free') ? (tokens / 1e6) * m.pricePerM : 0
  } catch {
    return 0
  }
}

function tasksReport(limit = 400): TaskRow[] {
  const rows: TaskRow[] = []
  const convs = [...listConversations()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 120)
  for (const s of convs) {
    const c = getConversation(s.id)
    if (!c) continue
    c.messages.forEach((m, i) => {
      if (m.role !== 'assistant' || !m.meta) return
      const p = parseMeta(m.meta)
      if (!p) return
      const prev = [...c.messages.slice(0, i)].reverse().find((x) => x.role === 'user')
      rows.push({ ...p, at: m.at ?? 0, convId: s.id, convTitle: s.title, projectId: s.projectId ?? null, cost: estCost(p.model, p.tokens), prompt: (prev?.content ?? '').split('\n')[0].slice(0, 90) })
    })
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}

export function registerExtrasHandlers(): void {
  ipcMain.handle('report:export', async (_e, csv: unknown) => {
    if (typeof csv !== 'string') return { ok: false }
    const r = await dialog.showSaveDialog({ defaultPath: 'tasks-report-' + new Date().toISOString().slice(0, 10) + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return { ok: false }
    await fsp.writeFile(r.filePath, '\uFEFF' + csv, 'utf8')
    return { ok: true, path: r.filePath }
  })
  ipcMain.handle('report:budget', (_e, v?: unknown) => {
    if (typeof v === 'number' && v >= 0) writeJson('budget.json', { monthly: v })
    return readJson<{ monthly?: number }>('budget.json', {}).monthly ?? 0
  })
  ipcMain.handle('file:exists', async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return []
    return Promise.all(
      paths.slice(0, 30).map(async (p) => {
        const f = asPath(p)
        if (!f) return false
        try {
          return (await fsp.stat(f)).isFile()
        } catch {
          return false
        }
      })
    )
  })
  ipcMain.handle('file:preview', async (_e, p: unknown): Promise<FilePreview> => {
    const f = asPath(p)
    return f ? preview(f) : { ok: false, note: 'مسار غير صالح' }
  })
  ipcMain.handle('file:open', async (_e, p: unknown) => {
    const f = asPath(p)
    if (!f) return { ok: false, error: 'مسار غير صالح' }
    if (RUNNABLE.has(extOf(f))) return { ok: false, error: 'ما بفتح ملفات تنفيذية/سكربتات من هون (أمان). افتحها بنفسك من المجلد' }
    const err = await shell.openPath(f)
    return err ? { ok: false, error: err } : { ok: true }
  })
  ipcMain.handle('file:reveal', (_e, p: unknown) => {
    const f = asPath(p)
    if (f) shell.showItemInFolder(f)
    return !!f
  })
  ipcMain.handle('report:tasks', () => tasksReport())

  ipcMain.handle('telegram:get', () => telegramState())
  ipcMain.handle('telegram:set', (_e, p: unknown) => setTelegram((p ?? {}) as never))
  ipcMain.handle('telegram:clearToken', () => {
    clearTelegramToken()
    return telegramState()
  })
  ipcMain.handle('telegram:detect', () => detectChatId())
  ipcMain.handle('telegram:test', () => sendTelegram('✅ تجربة من TRL_AI_Agent — التنبيه شغّال'))
}
