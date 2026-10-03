/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs'
import { addCharts } from './xlsx-chart'
import fsp from 'fs/promises'
import path from 'path'

// Office files done by the app itself (no model skill needed): create, read and edit .docx / .xlsx / .pptx.
// Create/read use bundled libraries (work without Office installed); editing Word/PowerPoint uses the installed Office through COM,
// editing Excel uses exceljs. Every edit makes a timestamped backup copy first (optimize, never destroy).

type Def = (name: string, description: string, props: Record<string, unknown>, required: string[], h: (a: Record<string, unknown>) => Promise<string>) => void
type Deps = {
  def: Def
  ask: (title: string, detail: string) => Promise<boolean>
  runPs: (script: string, args?: unknown, timeoutMs?: number, signal?: AbortSignal) => Promise<string>
  getSignal?: () => AbortSignal | undefined
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const AR = /[؀-ۿ]/g
const isRtlText = (t: string): boolean => (t.match(AR)?.length ?? 0) > Math.max(2, t.length * 0.2)
const extOf = (p: string): string => path.extname(p).toLowerCase().replace('.', '')
const xmlText = (x: string): string =>
  x.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function backupOf(p: string): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  const b = p + '.bak-' + stamp
  fs.copyFileSync(p, b)
  return b
}

const asArr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const parseSpec = (v: unknown): any => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return {}
    }
  }
  return v && typeof v === 'object' ? v : {}
}

// ---------------- create ----------------
async function createDocx(file: string, spec: any): Promise<void> {
  const D: any = await import('docx')
  const all = JSON.stringify(spec)
  const rtl = spec.rtl ?? isRtlText(all)
  const run = (t: string, o: any = {}): any => new D.TextRun({ text: t, rightToLeft: rtl, ...o })
  const para = (t: string, o: any = {}): any => new D.Paragraph({ bidirectional: rtl, children: [run(t, o.run)], ...o.p })
  const kids: any[] = []
  if (spec.title) kids.push(para(s(spec.title), { run: { bold: true, size: 40 }, p: { heading: D.HeadingLevel.TITLE } }))
  const H: Record<string, any> = { h1: D.HeadingLevel.HEADING_1, h2: D.HeadingLevel.HEADING_2, h3: D.HeadingLevel.HEADING_3 }
  for (const b of asArr(spec.blocks)) {
    if (typeof b === 'string') kids.push(para(b))
    else if (b.h1 || b.h2 || b.h3) {
      const k = b.h1 ? 'h1' : b.h2 ? 'h2' : 'h3'
      kids.push(para(s(b[k]), { p: { heading: H[k] } }))
    } else if (b.p != null) kids.push(para(s(b.p), { run: { bold: !!b.bold } }))
    else if (b.bullets) for (const t of asArr(b.bullets)) kids.push(new D.Paragraph({ bidirectional: rtl, bullet: { level: 0 }, children: [run(s(t))] }))
    else if (b.numbered) asArr(b.numbered).forEach((t, i) => kids.push(para(`${i + 1}. ${s(t)}`)))
    else if (b.table) {
      const head = asArr(b.table.header)
      const rows = asArr(b.table.rows)
      const cell = (t: unknown, bold = false): any =>
        new D.TableCell({ children: [new D.Paragraph({ bidirectional: rtl, children: [run(s(t), { bold })] })] })
      const trs = [
        ...(head.length ? [new D.TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) })] : []),
        ...rows.map((r) => new D.TableRow({ children: asArr(r).map((c) => cell(c)) }))
      ]
      kids.push(new D.Table({ rows: trs, width: { size: 100, type: D.WidthType.PERCENTAGE }, visuallyRightToLeft: rtl }))
      kids.push(new D.Paragraph({ children: [] }))
    } else if (b.pagebreak) kids.push(new D.Paragraph({ children: [new D.PageBreak()] }))
  }
  const doc = new D.Document({ sections: [{ children: kids.length ? kids : [new D.Paragraph('')] }] })
  await fsp.writeFile(file, await D.Packer.toBuffer(doc))
}

async function createXlsx(file: string, spec: any): Promise<void> {
  const mod: any = await import('exceljs')
  const Excel = mod.default ?? mod
  const wb = new Excel.Workbook()
  const rtl = spec.rtl ?? isRtlText(JSON.stringify(spec))
  const sheets = asArr(spec.sheets).length ? asArr(spec.sheets) : [{ name: 'Sheet1', rows: asArr(spec.rows) }]
  for (const sh of sheets) {
    const ws = wb.addWorksheet(s(sh.name || 'Sheet1').slice(0, 31), { views: [{ rightToLeft: rtl }] })
    const rows = asArr(sh.rows)
    rows.forEach((r, i) => {
      const vals = asArr(r).map((v) => (typeof v === 'string' && v.startsWith('=') && v.length > 1 ? { formula: v.slice(1) } : v))
      const row = ws.addRow(vals)
      if (i === 0 && sh.header !== false) row.font = { bold: true }
    })
    const widths = asArr(sh.widths)
    ws.columns.forEach((c: any, i: number) => {
      const max = Math.max(8, ...rows.map((r) => s(asArr(r)[i]).length))
      c.width = widths[i] ?? Math.min(60, max + 2)
    })
  }
  await wb.xlsx.writeFile(file)
  await addCharts(file, sheets.map((sh: any) => ({ name: s(sh.name || 'Sheet1').slice(0, 31), charts: asArr(sh.charts).concat(sh.chart ? [sh.chart] : []) })))
}

async function createPptx(file: string, spec: any): Promise<void> {
  const mod: any = await import('pptxgenjs')
  const P = mod.default ?? mod
  const pptx = new P()
  pptx.layout = 'LAYOUT_WIDE'
  const rtl = spec.rtl ?? isRtlText(JSON.stringify(spec))
  const align = rtl ? 'right' : 'left'
  const slides = asArr(spec.slides)
  if (spec.title && !slides.length) slides.push({ title: spec.title })
  for (const sd of slides) {
    const sl = pptx.addSlide()
    sl.addText(s(sd.title), { x: 0.5, y: 0.3, w: 12.3, h: 1, fontSize: 32, bold: true, align, rtlMode: rtl })
    let y = 1.5
    if (sd.text) {
      sl.addText(s(sd.text), { x: 0.5, y, w: 12.3, h: 1.2, fontSize: 20, align, rtlMode: rtl, valign: 'top' })
      y += 1.3
    }
    if (asArr(sd.bullets).length)
      sl.addText(
        asArr(sd.bullets).map((t) => ({ text: s(t), options: { bullet: true, breakLine: true } })),
        { x: 0.5, y, w: 12.3, h: 7.3 - y - 0.4, fontSize: 22, align, rtlMode: rtl, valign: 'top' }
      )
    if (sd.table) {
      const rows = [asArr(sd.table.header), ...asArr(sd.table.rows)].filter((r) => r.length)
      sl.addTable(rows.map((r, i) => asArr(r).map((c) => ({ text: s(c), options: { bold: i === 0 && !!asArr(sd.table.header).length, align } }))), { x: 0.5, y, w: 12.3, fontSize: 16, border: { type: 'solid', color: 'BBBBBB', pt: 1 } })
    }
    if (sd.notes) sl.addNotes(s(sd.notes))
  }
  await pptx.writeFile({ fileName: file })
}

// ---------------- read ----------------
async function readOffice(file: string): Promise<string> {
  const ext = extOf(file)
  if (ext === 'xlsx') {
    const mod: any = await import('exceljs')
    const wb = new (mod.default ?? mod).Workbook()
    await wb.xlsx.readFile(file)
    const out: string[] = []
    wb.eachSheet((ws: any) => {
      out.push(`## Sheet: ${ws.name} (${ws.rowCount} rows x ${ws.columnCount} cols)`)
      let n = 0
      ws.eachRow({ includeEmpty: false }, (row: any, rn: number) => {
        if (n++ >= 300) return
        const cells: string[] = []
        row.eachCell({ includeEmpty: true }, (c: any) => {
          const v = c.value
          cells.push(v && typeof v === 'object' ? (v.formula ? `=${v.formula} → ${v.result ?? ''}` : v.text ?? v.result ?? JSON.stringify(v)) : s(v))
        })
        out.push(`${rn}: ` + cells.join(' | '))
      })
    })
    return out.join('\n')
  }
  const JSZip: any = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await fsp.readFile(file))
  if (ext === 'docx') {
    const xml: string = await zip.file('word/document.xml').async('string')
    return xml
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .split('\n')
      .map((l) => xmlText(l.replace(/<w:tab\/>/g, '\t')))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  if (ext === 'pptx') {
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]))
    const out: string[] = []
    let i = 1
    for (const n of names) {
      const xml: string = await zip.file(n).async('string')
      out.push(`## Slide ${i++}\n` + xml.replace(/<\/a:p>/g, '\n').split('\n').map(xmlText).filter(Boolean).join('\n'))
    }
    return out.join('\n\n')
  }
  throw new Error('unsupported file type: .' + ext)
}

// ---------------- edit ----------------
async function editXlsx(file: string, ops: any[]): Promise<string> {
  const mod: any = await import('exceljs')
  const wb = new (mod.default ?? mod).Workbook()
  await wb.xlsx.readFile(file)
  const sheetOf = (n?: string): any => (n ? wb.getWorksheet(n) : wb.worksheets[0])
  let changed = 0
  for (const o of ops) {
    if (o.set) {
      const ws = sheetOf(o.set.sheet)
      if (!ws) throw new Error('sheet not found: ' + o.set.sheet)
      const v = o.set.formula ? { formula: s(o.set.formula).replace(/^=/, '') } : typeof o.set.value === 'string' && o.set.value.startsWith('=') ? { formula: o.set.value.slice(1) } : o.set.value
      ws.getCell(s(o.set.cell)).value = v
      changed++
    } else if (o.append_row) {
      const ws = sheetOf(o.append_row.sheet)
      if (!ws) throw new Error('sheet not found: ' + o.append_row.sheet)
      ws.addRow(asArr(o.append_row.values).map((v) => (typeof v === 'string' && v.startsWith('=') ? { formula: v.slice(1) } : v)))
      changed++
    } else if (o.replace) {
      wb.eachSheet((ws: any) =>
        ws.eachRow((row: any) =>
          row.eachCell((c: any) => {
            if (typeof c.value === 'string' && c.value.includes(s(o.replace.find))) {
              c.value = c.value.split(s(o.replace.find)).join(s(o.replace.with))
              changed++
            }
          })
        )
      )
    } else if (o.add_sheet) {
      wb.addWorksheet(s(o.add_sheet.name).slice(0, 31)).addRows(asArr(o.add_sheet.rows))
      changed++
    }
  }
  await wb.xlsx.writeFile(file)
  return `${changed} change(s) applied`
}

const WORD_PS = `
$w=New-Object -ComObject Word.Application; $w.Visible=$false; $w.DisplayAlerts=0
$d=$null
try{
  $d=$w.Documents.Open($A.path)
  $n=0
  foreach($o in @($A.ops)){
    if($o.replace){ $f=$d.Content.Find; $f.ClearFormatting(); $f.Replacement.ClearFormatting(); [void]$f.Execute([string]$o.replace.find,$false,$false,$false,$false,$false,$true,1,$false,[string]$o.replace.with,2); $n++ }
    elseif($null -ne $o.append){ $d.Content.InsertParagraphAfter(); $r=$d.Paragraphs.Last.Range; $r.Text=[string]$o.append; $n++ }
  }
  $d.Save(); $d.Close($false); $d=$null; "OK: $n operation(s) applied"
} catch { "Error: " + $_.Exception.Message; if($d){ try{ $d.Close($false) }catch{} } }
finally { try{ $w.Quit() }catch{} }
`
const PPT_PS = `
$p=New-Object -ComObject PowerPoint.Application
$pr=$null
try{
  $pr=$p.Presentations.Open($A.path,0,0,0)
  $n=0
  foreach($o in @($A.ops)){
    if($o.replace){
      foreach($sl in $pr.Slides){ foreach($sh in $sl.Shapes){ if($sh.HasTextFrame){ $guard=0; do { $r=$sh.TextFrame.TextRange.Replace([string]$o.replace.find,[string]$o.replace.with); if($r){$n++}; $guard++ } while($r -and $guard -lt 50) } } }
    }
    elseif($o.add_slide){
      $lay=$pr.SlideMaster.CustomLayouts
      $sl=$pr.Slides.AddSlide($pr.Slides.Count+1,$lay.Item([Math]::Min(2,$lay.Count)))
      $boxes=@($sl.Shapes | Where-Object { $_.HasTextFrame })
      $bul=(@($o.add_slide.bullets) -join [string][char]13)
      if($boxes.Count -ge 2){ $boxes[0].TextFrame.TextRange.Text=[string]$o.add_slide.title; $boxes[1].TextFrame.TextRange.Text=$bul }
      else {
        if($boxes.Count -eq 1){ $boxes[0].TextFrame.TextRange.Text=[string]$o.add_slide.title } else { $t=$sl.Shapes.AddTextbox(1,40,20,640,60); $t.TextFrame.TextRange.Text=[string]$o.add_slide.title }
        $b=$sl.Shapes.AddTextbox(1,40,110,640,340); $b.TextFrame.TextRange.Text=$bul
      }
      $n++
    }
  }
  $pr.Save(); $pr.Close(); $pr=$null; "OK: $n operation(s) applied"
} catch { "Error: " + $_.Exception.Message; if($pr){ try{ $pr.Saved=-1; $pr.Close() }catch{} } }
finally { try{ $p.Quit() }catch{} }
`

export function addOfficeTools({ def, ask, runPs, getSignal }: Deps): void {
  const str = { type: 'string' }
  const obj = { type: 'object' }
  def(
    'office_read',
    'Read the text content of a Word (.docx), Excel (.xlsx, with formulas) or PowerPoint (.pptx) file. Absolute path.',
    { path: str },
    ['path'],
    async (a) => {
      const p = s(a.path)
      try {
        const t = await readOffice(p)
        return t.length > 40000 ? t.slice(0, 40000) + '\n…[truncated]' : t || '(empty)'
      } catch (e) {
        return 'Error: ' + (e instanceof Error ? e.message : String(e))
      }
    }
  )
  def(
    'office_create',
    'Create a NEW Office file (never overwrites; pick a new name). type = docx | xlsx | pptx. spec (object): ' +
      'docx {title, blocks:[{h1|h2|h3:"text"},{p:"text"},{bullets:["a","b"]},{numbered:[..]},{table:{header:[..],rows:[[..]]}},{pagebreak:true}]}; ' +
      'xlsx {sheets:[{name, rows:[[header..],[value or "=FORMULA"..]], widths?, chart?:{type:"column|bar|line|pie", title, cats:"A2:A5", series:[{name:"B1", values:"B2:B5"}], anchor:"J2"}}]} (chart = a real Excel chart over cell ranges; for several charts use charts:[..]); ' +
      'pptx {slides:[{title, text?, bullets?:[..], table?:{header,rows}, notes?}]}. Arabic is detected automatically and set right-to-left. Asks for approval.',
    { path: str, type: { type: 'string', enum: ['docx', 'xlsx', 'pptx'] }, spec: obj },
    ['path', 'type', 'spec'],
    async (a) => {
      const p = s(a.path)
      const type = s(a.type) || extOf(p)
      if (!['docx', 'xlsx', 'pptx'].includes(type)) return 'Error: type must be docx, xlsx or pptx'
      const file = extOf(p) === type ? p : p + '.' + type
      if (fs.existsSync(file)) return 'Error: file already exists; use office_edit to change it, or choose a new name.'
      if (!(await ask('بدو يعمل ملف Office', file))) return 'Error: the user denied this.'
      try {
        await fsp.mkdir(path.dirname(file), { recursive: true })
        const spec = parseSpec(a.spec)
        if (type === 'docx') await createDocx(file, spec)
        else if (type === 'xlsx') await createXlsx(file, spec)
        else await createPptx(file, spec)
        const st = fs.statSync(file)
        return `OK: created ${file} (${st.size} bytes)`
      } catch (e) {
        return 'Error: ' + (e instanceof Error ? e.message : String(e))
      }
    }
  )
  def(
    'office_edit',
    'Edit an EXISTING Office file in place (a timestamped .bak copy is made first). ops = list of operations. ' +
      'docx: {replace:{find,with}} | {append:"paragraph text"}. pptx: {replace:{find,with}} | {add_slide:{title,bullets:[..]}}. ' +
      'xlsx: {set:{sheet?,cell:"B2",value|formula}} | {append_row:{sheet?,values:[..]}} | {replace:{find,with}} | {add_sheet:{name,rows}}. ' +
      'Word/PowerPoint editing uses the installed Office. Asks for approval.',
    { path: str, ops: { type: 'array', items: obj } },
    ['path', 'ops'],
    async (a) => {
      const p = s(a.path)
      const ext = extOf(p)
      const ops = asArr(typeof a.ops === 'string' ? parseSpec(a.ops) : a.ops)
      if (!fs.existsSync(p)) return 'Error: file not found: ' + p
      if (!ops.length) return 'Error: ops is empty'
      if (!['docx', 'xlsx', 'pptx'].includes(ext)) return 'Error: only .docx .xlsx .pptx are supported'
      if (!(await ask('بدو يعدّل ملف Office', p + '\n' + JSON.stringify(ops).slice(0, 700)))) return 'Error: the user denied this.'
      try {
        const bak = backupOf(p)
        let r: string
        if (ext === 'xlsx') r = await editXlsx(p, ops)
        else r = await runPs(ext === 'docx' ? WORD_PS : PPT_PS, { path: p, ops }, 120000, getSignal?.())
        if (/^Error|exception|cannot|failed/i.test(r) && !/^OK/.test(r)) return 'Error: ' + r + `\n(backup kept: ${bak})`
        return `${/^OK/.test(r) ? r : 'OK: ' + r}\nbackup: ${bak}`
      } catch (e) {
        return 'Error: ' + (e instanceof Error ? e.message : String(e))
      }
    }
  )
}
