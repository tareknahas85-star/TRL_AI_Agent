// 5.17.9: حراس وضع بناء مشروع. دوال صافية (بدون Electron) عشان تنختبر.
export const BUILD_DELETE_CMD = /(remove-item|\brm\b|\bdel\b|\berase\b|\brmdir\b|\brd\b)/i

export function isBuildDeleteCommand(cmd: string): boolean {
  return BUILD_DELETE_CMD.test(cmd)
}

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN'

/** حكم المراجعة: PASS ما بينقبل مع أي ملاحظة متوسطة أو خطيرة (بيتحوّل لـ FAIL عشان جولة التصليح). */
export function reviewVerdict(text: string): { findings: number; high: number; medium: number; verdict: Verdict } {
  const findings = text.match(/^\s*FINDING\s*\[/gim)?.length ?? 0
  const high = text.match(/^\s*FINDING\s*\[high\]/gim)?.length ?? 0
  const medium = text.match(/^\s*FINDING\s*\[medium\]/gim)?.length ?? 0
  const raw: Verdict = /VERDICT:\s*FAIL/i.test(text) ? 'FAIL' : /VERDICT:\s*PASS/i.test(text) ? 'PASS' : 'UNKNOWN'
  const verdict: Verdict = raw === 'PASS' && (high > 0 || medium > 0) ? 'FAIL' : raw
  return { findings, high, medium, verdict }
}

export type ProjectRef = { id: string; name: string; path: string }

/** يلاقي المشروع اللي اسمه مذكور بالرسالة (كلمة كاملة). إذا ولا وحدة أو أكثر من وحدة: null. */
export function findProjectByText(text: string, projects: ProjectRef[]): ProjectRef | null {
  const t = (text || '').toLowerCase()
  const hits = projects.filter((p) => {
    const n = (p.name || '').toLowerCase().trim()
    if (!n) return false
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('(^|[^a-z0-9_-])' + esc + '($|[^a-z0-9_-])').test(t)
  })
  return hits.length === 1 ? hits[0] : null
}