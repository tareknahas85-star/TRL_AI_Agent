import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fsp from 'fs/promises'
import path from 'path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { describeImage, transcribe } from './media'
import { listProjects } from '../core/workspace'

export type Attachment = {
  path: string
  name: string
  kind: 'text' | 'office' | 'pdf' | 'image' | 'audio' | 'video' | 'other'
  size: number
  text?: string
  note?: string
}

const TEXT_EXT = new Set(
  'txt md markdown csv tsv json jsonl xml yaml yml log ini cfg conf toml js jsx ts tsx mjs cjs py ps1 psm1 sh bash bat cmd html htm css scss sql java kt c h cpp hpp cs go rs rb php swift tf tfvars hcl dockerfile gradle properties srt vtt rtf eml'.split(' ')
)
const IMG_EXT = new Set('png jpg jpeg gif webp bmp svg heic tif tiff ico'.split(' '))
const AUDIO_EXT = new Set('wav mp3 m4a ogg oga flac aac opus wma amr'.split(' '))
const VIDEO_EXT = new Set('mp4 mkv avi mov webm wmv flv m4v'.split(' '))
const MAX_EACH = 20000

const clip = (t: string): string => (t.length > MAX_EACH ? t.slice(0, MAX_EACH) + '\n…[انقص النص، الملف أطول]' : t)
const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

async function docxText(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fsp.readFile(file))
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) return ''
  return decode(
    xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function pptxText(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fsp.readFile(file))
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]))
  const out: string[] = []
  let i = 0
  for (const n of slides) {
    i++
    const xml = (await zip.file(n)?.async('string')) ?? ''
    const parts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decode(m[1]))
    out.push('## Slide ' + i + '\n' + parts.join('\n'))
  }
  return out.join('\n\n')
}

async function pdfText(file: string): Promise<{ text: string; pages: number }> {
  const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> }
  const r = await mod.default(await fsp.readFile(file))
  return { text: (r.text ?? '').replace(/\n{3,}/g, '\n\n').trim(), pages: r.numpages }
}

async function xlsxText(file: string): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const out: string[] = []
  for (const ws of wb.worksheets.slice(0, 6)) {
    out.push('## Sheet: ' + ws.name + ' (' + ws.rowCount + ' rows x ' + ws.columnCount + ' cols)')
    let r = 0
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (r++ >= 200) return
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (c) => cells.push(c.text ?? ''))
      out.push(cells.join(' | '))
    })
  }
  return out.join('\n')
}

export async function prepareFile(file: string, confidential = false): Promise<Attachment> {
  const name = path.basename(file)
  const ext = path.extname(file).slice(1).toLowerCase()
  let size = 0
  try {
    size = (await fsp.stat(file)).size
  } catch {
    return { path: file, name, kind: 'other', size: 0, note: 'الملف مش موجود أو ما بينقرا' }
  }
  const base = { path: file, name, size }
  try {
    if (TEXT_EXT.has(ext) || (!ext && size < 200000)) {
      if (size > 5_000_000) return { ...base, kind: 'text', note: 'ملف نصي كبير جداً، اقراه بالأدوات حسب الحاجة' }
      return { ...base, kind: 'text', text: clip(await fsp.readFile(file, 'utf-8')) }
    }
    if (ext === 'docx') return { ...base, kind: 'office', text: clip(await docxText(file)) }
    if (ext === 'pptx') return { ...base, kind: 'office', text: clip(await pptxText(file)) }
    if (ext === 'xlsx' || ext === 'xlsm') return { ...base, kind: 'office', text: clip(await xlsxText(file)) }
    if (ext === 'doc' || ext === 'xls' || ext === 'ppt') return { ...base, kind: 'office', note: 'صيغة Office قديمة: لازم تتحول لـ docx/xlsx/pptx أول (بأداة PowerShell أو Office) قبل القراءة' }
    if (ext === 'pdf') {
      const r = await pdfText(file)
      if (r.text.length < 20) return { ...base, kind: 'pdf', note: 'PDF (' + r.pages + ' صفحة) بس ما فيه نص قابل للاستخراج (ممكن يكون ممسوح ضوئياً/صور)' }
      return { ...base, kind: 'pdf', text: clip(r.text), note: r.pages + ' صفحة' }
    }
    if (IMG_EXT.has(ext)) {
      const r = await describeImage(file, confidential)
      return { ...base, kind: 'image', text: r.text ? clip(r.text) : undefined, note: r.note }
    }
    if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) {
      const r = await transcribe(file, confidential)
      const v = VIDEO_EXT.has(ext)
      return { ...base, kind: v ? 'video' : 'audio', text: r.text ? clip(r.text) : undefined, note: (v ? 'تفريغ صوت الفيديو فقط (الصورة ما بتتحلل). ' : '') + r.note }
    }
  } catch (e) {
    return { ...base, kind: 'other', note: 'فشلت القراءة: ' + (e instanceof Error ? e.message : String(e)) }
  }
  return { ...base, kind: 'other', note: 'نوع ملف غير معروف: المسار محفوظ، والموديل بيقرر بأي أداة بيفتحو، وإذا ما في أداة بيقولك' }
}

export function registerAttachHandlers(): void {
  const isConf = (projectId: unknown): boolean =>
    typeof projectId === 'string' && !!listProjects().projects.find((p) => p.id === projectId)?.confidential
  ipcMain.handle('attach:pick', async (event, projectId?: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = { properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[] }
    const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    if (r.canceled) return []
    return Promise.all(r.filePaths.slice(0, 20).map((p) => prepareFile(p, isConf(projectId))))
  })
  ipcMain.handle('attach:prepare', async (_e, paths: unknown, projectId?: unknown) =>
    Array.isArray(paths) ? Promise.all(paths.filter((p) => typeof p === 'string').slice(0, 20).map((p) => prepareFile(p as string, isConf(projectId)))) : []
  )
  ipcMain.handle('attach:savePasted', async (_e, name: unknown, data: unknown, projectId?: unknown) => {
    const safe = String(name ?? 'pasted.png').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'pasted.png'
    const dir = path.join(app.getPath('userData'), 'attachments', String(Date.now()))
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, safe)
    await fsp.writeFile(file, Buffer.from(data as ArrayBuffer))
    return [await prepareFile(file, isConf(projectId))]
  })
}
