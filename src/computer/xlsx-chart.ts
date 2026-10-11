import fsp from 'fs/promises'

// Adds native Excel charts to a finished .xlsx (exceljs can't draw charts itself). Chart spec per sheet:
// { type: 'bar'|'column'|'line'|'pie', title?, cats: 'A2:A5', series: [{ name?: 'B1', values: 'B2:B5' }], anchor?: 'I2' }
export type ChartSpec = { type?: string; title?: string; cats?: string; series?: { name?: string; values?: string }[]; anchor?: string }

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const abs = (ref: string): string => ref.replace(/\$/g, '').replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')
const colNum = (c: string): number => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)

function anchorXml(anchor: string, id: number): string {
  const m = /^([A-Z]+)(\d+)$/.exec(anchor.toUpperCase()) ?? ['', 'J', '2']
  const col = colNum(m[1]) - 1
  const row = parseInt(m[2], 10) - 1
  return (
    `<xdr:twoCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${col + 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id + 1}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${id}"/>` +
    `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  )
}

function chartXml(sheet: string, c: ChartSpec): string {
  const q = "'" + sheet.replace(/'/g, "''") + "'!"
  const type = (c.type ?? 'column').toLowerCase()
  const series = (c.series ?? []).map((s, i) => {
    const tx = s.name ? `<c:tx><c:strRef><c:f>${esc(q + abs(s.name))}</c:f></c:strRef></c:tx>` : ''
    const cat = c.cats ? `<c:cat><c:strRef><c:f>${esc(q + abs(c.cats))}</c:f></c:strRef></c:cat>` : ''
    const val = `<c:val><c:numRef><c:f>${esc(q + abs(s.values ?? ''))}</c:f></c:numRef></c:val>`
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${cat}${val}</c:ser>`
  })
  const axes = '<c:axId val="111"/><c:axId val="222"/>'
  let plot: string
  if (type === 'pie') plot = `<c:pieChart><c:varyColors val="1"/>${series.join('')}</c:pieChart>`
  else if (type === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.join('')}<c:marker val="1"/>${axes}</c:lineChart>`
  else plot = `<c:barChart><c:barDir val="${type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series.join('')}${axes}</c:barChart>`
  const axisXml =
    type === 'pie'
      ? ''
      : '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222"/></c:catAx>' +
        '<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="111"/></c:valAx>'
  const title = c.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>'
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<c:chart>${title}<c:plotArea><c:layout/>${plot}${axisXml}</c:plotArea><c:legend><c:legendPos val="r"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
  )
}

export async function addCharts(file: string, sheets: { name: string; charts: ChartSpec[] }[]): Promise<number> {
  const withCharts = sheets.map((s, i) => ({ ...s, idx: i + 1 })).filter((s) => s.charts.length)
  if (!withCharts.length) return 0
  const mod: any = await import('jszip')
  const JSZip = mod.default ?? mod
  const zip = await JSZip.loadAsync(await fsp.readFile(file))
  let ct: string = await zip.file('[Content_Types].xml').async('string')
  let chartNo = 0
  let drawNo = 0
  for (const sh of withCharts) {
    const sheetPath = `xl/worksheets/sheet${sh.idx}.xml`
    if (!zip.file(sheetPath)) continue
    drawNo++
    let anchors = ''
    let drels = ''
    sh.charts.forEach((c, k) => {
      chartNo++
      const local = k + 1
      zip.file(`xl/charts/chart${chartNo}.xml`, chartXml(sh.name, c))
      ct = ct.replace('</Types>', `<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`)
      anchors += anchorXml(c.anchor ?? 'J' + (2 + k * 20), local)
      drels += `<Relationship Id="rId${local}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`
    })
    zip.file(
      `xl/drawings/drawing${drawNo}.xml`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors + '</xdr:wsDr>'
    )
    zip.file(`xl/drawings/_rels/drawing${drawNo}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drels + '</Relationships>')
    ct = ct.replace('</Types>', `<Override PartName="/xl/drawings/drawing${drawNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
    // sheet relationships
    const relPath = `xl/worksheets/_rels/sheet${sh.idx}.xml.rels`
    let rel: string = zip.file(relPath) ? await zip.file(relPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    const rid = 'rIdDraw' + drawNo
    rel = rel.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawNo}.xml"/></Relationships>`)
    zip.file(relPath, rel)
    let xml: string = await zip.file(sheetPath).async('string')
    if (!/xmlns:r=/.test(xml)) xml = xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
    const tag = `<drawing r:id="${rid}"/>`
    const before = xml.search(/<(legacyDrawing|tableParts|extLst)[ >\/]/)
    xml = before >= 0 ? xml.slice(0, before) + tag + xml.slice(before) : xml.replace('</worksheet>', tag + '</worksheet>')
    zip.file(sheetPath, xml)
  }
  zip.file('[Content_Types].xml', ct)
  await fsp.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return chartNo
}
