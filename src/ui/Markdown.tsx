import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

// Small, dependency-free and XSS-safe Markdown renderer (React elements only, no innerHTML).

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (m[1])
      out.push(
        <code key={k++} dir="ltr" className="rounded bg-surface2 px-1 py-0.5 text-[0.85em]">
          {t.slice(1, -1)}
        </code>
      )
    else if (m[2]) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    else
      out.push(
        <a key={k++} href={m[5]} target="_blank" rel="noreferrer" className="text-primary underline">
          {t.slice(1, t.indexOf(']'))}
        </a>
      )
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-outline bg-surface2" dir="ltr">
      <div className="flex items-center justify-between border-b border-outline px-3 py-1 text-[11px] text-muted">
        <span>{lang || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-outline">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'تم النسخ' : 'نسخ'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-6">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const splitRow = (l: string): string[] =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++])
      i++ // closing fence (or end of a still-streaming block)
      blocks.push(<CodeBlock key={key++} code={buf.join('\n')} lang={fence[1]} />)
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const size = ['text-xl', 'text-lg', 'text-base', 'text-sm'][h[1].length - 1]
      blocks.push(
        <div key={key++} className={`mb-1 mt-3 font-semibold ${size}`}>
          <Inline text={h[2]} />
        </div>
      )
      i++
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-outline" />)
      i++
      continue
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]))
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} className="border border-outline bg-surface2 px-2 py-1 text-start font-medium">
                    <Inline text={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="border border-outline px-2 py-1">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(
        <blockquote key={key++} className="my-2 border-s-4 border-primary/50 ps-3 text-muted">
          <Inline text={buf.join(' ')} />
        </blockquote>
      )
      continue
    }
    const ul = /^\s*[-*+]\s+/
    const ol = /^\s*\d+[.)]\s+/
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line)
      const re = ordered ? ol : ul
      const items: string[] = []
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''))
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag key={key++} className={`my-2 ms-6 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, j) => (
            <li key={j}>
              <Inline text={it} />
            </li>
          ))}
        </Tag>
      )
      continue
    }
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,4}\s|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i])
    )
      buf.push(lines[i++])
    blocks.push(
      <p key={key++} className="my-1.5 whitespace-pre-wrap leading-7">
        <Inline text={buf.join('\n')} />
      </p>
    )
  }
  return <div className="min-w-0 break-words">{blocks}</div>
}
