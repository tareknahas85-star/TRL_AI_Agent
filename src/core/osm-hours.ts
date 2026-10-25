// OSM opening_hours (the common subset) -> open right now? true / false, or null when it cannot be told (missing or unsupported syntax).
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const RULE = /^(.*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*)?)+|off|closed)$/i

function expandDays(spec: string): number[] | null {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const t = part.trim()
    if (!t) continue
    const m = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(t)
    if (!m) return null
    const a = DAYS.indexOf(m[1])
    const b = m[2] ? DAYS.indexOf(m[2]) : a
    if (a < 0 || b < 0) return null
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d)
      if (d === b) break
    }
  }
  return [...out]
}

function parseTimes(s: string): [number, number][] | null {
  if (/^(off|closed)$/i.test(s.trim())) return []
  const out: [number, number][] = []
  for (const r of s.split(',')) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(r)
    if (!m) return null
    out.push([Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])])
  }
  return out
}

export function isOpenNow(spec: string | undefined, now: Date = new Date()): boolean | null {
  if (!spec) return null
  const s = spec.trim()
  if (/^24\/7$/i.test(s)) return true
  const day = now.getDay()
  const min = now.getHours() * 60 + now.getMinutes()
  let today: [number, number][] | undefined
  let yest: [number, number][] | undefined
  for (const r of s.split(';').map((x) => x.trim()).filter(Boolean)) {
    if (/^24\/7$/i.test(r)) return true
    const m = RULE.exec(r)
    if (!m) return null
    const dtxt = m[1].trim()
    const days = dtxt ? expandDays(dtxt) : [0, 1, 2, 3, 4, 5, 6]
    const times = parseTimes(m[2])
    if (!days || !times) return null
    if (days.includes(day)) today = times
    if (days.includes((day + 6) % 7)) yest = times
  }
  for (const [a, b] of today ?? []) if (a <= b ? min >= a && min < b : min >= a) return true
  for (const [a, b] of yest ?? []) if (b < a && min < b) return true
  return false
}
