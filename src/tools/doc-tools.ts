import fs from 'fs/promises'
import path from 'path'
import type OpenAI from 'openai'

// Local PDF + image tools. Everything runs on this PC: nothing is uploaded anywhere. Results are always written to a NEW file (an existing file is never overwritten).
// PDF: pdf-lib (pure JS). Images: Electron's nativeImage (PNG/JPEG in, PNG/JPEG out).

type Handlers = Map<string, (a: Record<string, unknown>) => Promise<string>>
const MAX_PDF_FILES = 50
const MAX_PDF_BYTES = 200 * 1024 * 1024

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const abs = (p: string, base?: string): string => (path.isAbsolute(p) ? p : path.resolve(base || process.cwd(), p))

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  for (let i = 0; i < 1000; i++) {
    const p = path.join(dir, i === 0 ? name : `${stem}-${i}${ext}`)
    try {
      await fs.access(p)
    } catch {
      return p
    }
  }
  throw new Error('could not find a free file name')
}

async function readPdf(p: string): Promise<Uint8Array> {
  const st = await fs.stat(p)
  if (!st.isFile()) throw new Error(`${p} is not a file`)
  if (st.size > MAX_PDF_BYTES) throw new Error(`${p} is larger than 200 MB`)
  return new Uint8Array(await fs.readFile(p))
}

// "1-3,5,8-" -> zero-based page indexes (1-based input, open end allowed). Throws on anything out of range.
export function parsePages(spec: string, total: number): number[] {
  const out: number[] = []
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/)
    let from: number
    let to: number
    if (m && (m[1] || m[2])) {
      from = m[1] ? Number(m[1]) : 1
      to = m[2] ? Number(m[2]) : total
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part)
    } else throw new Error(`bad page range "${part}" (use e.g. 1-3,5,8-)`)
    if (from < 1 || to < from || to > total) throw new Error(`page range "${part}" is outside 1-${total}`)
    for (let i = from; i <= to; i++) out.push(i - 1)
  }
  if (!out.length) throw new Error('no pages selected')
  return out
}

export async function pdfMerge(files: string[], output: string | undefined, base?: string): Promise<string> {
  if (!files.length || files.length > MAX_PDF_FILES) throw new Error(`give 1-${MAX_PDF_FILES} PDF files`)
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  let pages = 0
  const paths = files.map((f) => abs(f, base))
  for (const p of paths) {
    const src = await PDFDocument.load(await readPdf(p))
    const copied = await merged.copyPages(src, src.getPageIndices())
    copied.forEach((pg) => merged.addPage(pg))
    pages += copied.length
  }
  const outPath = output ? await uniquePath(path.dirname(abs(output, base)), path.basename(output)) : await uniquePath(path.dirname(paths[0]), 'merged.pdf')
  await fs.writeFile(outPath, await merged.save())
  return JSON.stringify({ output: outPath, pages, files: paths.length })
}

export async function pdfSplit(file: string, pagesSpec: string, output: string | undefined, base?: string): Promise<string> {
  const { PDFDocument } = await import('pdf-lib')
  const p = abs(file, base)
  const src = await PDFDocument.load(await readPdf(p))
  const idx = parsePages(pagesSpec, src.getPageCount())
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, idx)
  copied.forEach((pg) => out.addPage(pg))
  const stem = path.basename(p, path.extname(p))
  const outPath = output ? await uniquePath(path.dirname(abs(output, base)), path.basename(output)) : await uniquePath(path.dirname(p), `${stem}-pages.pdf`)
  await fs.writeFile(outPath, await out.save())
  return JSON.stringify({ output: outPath, pages: idx.length, of_total: src.getPageCount() })
}

export async function pdfInfo(file: string, base?: string): Promise<string> {
  const { PDFDocument } = await import('pdf-lib')
  const p = abs(file, base)
  const bytes = await readPdf(p)
  const d = await PDFDocument.load(bytes)
  return JSON.stringify({ file: p, pages: d.getPageCount(), size_bytes: bytes.length, title: d.getTitle() || undefined, author: d.getAuthor() || undefined, creator: d.getCreator() || undefined })
}

export async function imageConvert(a: { file: string; format?: string; maxWidth?: number; quality?: number; output?: string }, base?: string): Promise<string> {
  const { nativeImage } = await import('electron')
  const p = abs(a.file, base)
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) throw new Error('could not read the image (supported: PNG, JPEG)')
  const inExt = path.extname(p).toLowerCase().replace('.', '')
  let fmt = (a.format || (inExt === 'jpg' || inExt === 'jpeg' ? 'jpg' : 'png')).toLowerCase()
  if (fmt === 'jpeg') fmt = 'jpg'
  if (fmt !== 'png' && fmt !== 'jpg') throw new Error('format must be png or jpg')
  const size = img.getSize()
  let out = img
  const mw = Number(a.maxWidth)
  if (Number.isFinite(mw) && mw > 0 && size.width > mw) out = img.resize({ width: Math.round(mw), quality: 'best' })
  const q = Math.min(100, Math.max(1, Math.round(Number(a.quality) || 85)))
  const buf = fmt === 'png' ? out.toPNG() : out.toJPEG(q)
  const stem = path.basename(p, path.extname(p))
  const outPath = a.output ? await uniquePath(path.dirname(abs(a.output, base)), path.basename(a.output)) : await uniquePath(path.dirname(p), `${stem}-converted.${fmt}`)
  await fs.writeFile(outPath, buf)
  const before = (await fs.stat(p)).size
  const os = out.getSize()
  return JSON.stringify({ output: outPath, format: fmt, width: os.width, height: os.height, size_before: before, size_after: buf.length, note: 'JPEG drops transparency; PNG is lossless so it may not get smaller.' })
}

export function addDocTools(defs: OpenAI.Chat.ChatCompletionTool[], handlers: Handlers, projectPath?: string): void {
  const def = (name: string, description: string, properties: Record<string, unknown>, required: string[], h: (a: Record<string, unknown>) => Promise<string>): void => {
    defs.push({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } })
    handlers.set(name, async (a) => {
      try {
        return await h(a)
      } catch (e) {
        return 'Error: ' + errText(e)
      }
    })
  }
  const str = { type: 'string' }
  def(
    'pdf_merge',
    'Merge several PDF files (in the given order) into ONE new PDF, locally on this PC. Never overwrites an existing file. Relative paths resolve against the active project folder.',
    { files: { type: 'array', items: str, description: 'PDF paths in order' }, output: { type: 'string', description: 'optional output file name/path' } },
    ['files'],
    (a) => pdfMerge(Array.isArray(a.files) ? a.files.map(String) : [], typeof a.output === 'string' ? a.output : undefined, projectPath)
  )
  def(
    'pdf_extract_pages',
    'Extract pages from a PDF into a NEW PDF, locally. `pages` uses 1-based ranges like "1-3,5,8-". The original is untouched.',
    { file: str, pages: str, output: str },
    ['file', 'pages'],
    (a) => pdfSplit(String(a.file ?? ''), String(a.pages ?? ''), typeof a.output === 'string' ? a.output : undefined, projectPath)
  )
  def('pdf_info', 'Page count, size and metadata of a local PDF (does not read the text; use the normal file reader for that).', { file: str }, ['file'], (a) =>
    pdfInfo(String(a.file ?? ''), projectPath)
  )
  def(
    'image_convert',
    'Convert / shrink a local PNG or JPEG image, entirely on this PC, into a NEW file: choose format png or jpg, optional max_width (keeps the aspect ratio) and JPEG quality 1-100. Use it to reduce an image size.',
    { file: str, format: { type: 'string', enum: ['png', 'jpg'] }, max_width: { type: 'number' }, quality: { type: 'number' }, output: str },
    ['file'],
    (a) => imageConvert({ file: String(a.file ?? ''), format: typeof a.format === 'string' ? a.format : undefined, maxWidth: Number(a.max_width) || undefined, quality: Number(a.quality) || undefined, output: typeof a.output === 'string' ? a.output : undefined }, projectPath)
  )
}