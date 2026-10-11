import fs from 'fs'
import path from 'path'

const CREATE = /(عملت|أنشأت|انشأت|أنشئ|خلقت|حفظت|كتبت|جهّزت|جهزت|صار عندك|تم\s+(?:إنشاء|انشاء|حفظ|إنجاز)|created|saved|wrote|written|generated)/i
const EXT = '(?:docx|xlsx|pptx|pdf|csv|txt|md|json|png|jpg|jpeg|html|py|ps1|js|ts|zip)'
const WIN = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n`]+\\)*[^\\/:*?"<>|\r\n`]+?\.[A-Za-z0-9]{1,5}(?![A-Za-z0-9])/g
const BARE = new RegExp('(?<![\\w\\\\/:.])([\\w\\-\\u0600-\\u06FF][\\w\\-\\u0600-\\u06FF.]*\\.' + EXT + ')(?![\\w])', 'gi')

/** Paths the answer says were created/saved but that do not exist on disk. Pure check, no side effects. */
export function missingFileClaims(content: string, projectPath?: string): string[] {
  if (!content || /^Error:/.test(content.trim())) return []
  const text = content.replace(/\\\\/g, '\\')
  const missing = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!CREATE.test(line)) continue
    const seen: string[] = []
    for (const m of line.matchAll(WIN)) seen.push(m[0].trim())
    for (const p of seen) {
      let ok = false
      try { ok = fs.existsSync(p) } catch { ok = false }
      if (!ok) missing.add(p)
    }
    if (projectPath) {
      const rest = seen.reduce((l, p) => l.split(p).join(' '), line)
      for (const m of rest.matchAll(BARE)) {
        const name = m[1]
        let ok = false
        try { ok = fs.existsSync(path.join(projectPath, name)) } catch { ok = false }
        if (!ok) missing.add(name)
      }
    }
  }
  return [...missing].slice(0, 5)
}

export function claimsWarning(missing: string[]): string {
  if (!missing.length) return ''
  return '\n\n⚠️ فحص تلقائي: الجواب بيذكر إنو عمل/حفظ ملف، بس ما لقيتو على الجهاز: ' + missing.map((m) => '`' + m + '`').join('، ') + '. لا تعتمد عليه، وجرّب "جرّب بموديل تاني" أو اطلب منو يعيد العملية.'
}
