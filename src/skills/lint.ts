// Local safety lint for a skill's text (a skill is instructions that get fed to the model, so the risks are prompt injection and dangerous commands, not malware).
// Nothing leaves the PC. Findings are WARNINGS: the user reads them and decides.
export type LintFinding = { id: string; message: string }

const RULES: { id: string; re: RegExp; message: string }[] = [
  { id: 'pipe-shell', re: /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]*\|\s*(sh|bash|zsh|iex|invoke-expression|powershell|pwsh)\b/i, message: 'بينزّل سكربت من النت وبشغّلو مباشرة (curl | sh أو iex). هاد أخطر نمط.' },
  { id: 'iex', re: /\b(invoke-expression|iex)\b\s*[(\s$]/i, message: 'فيه Invoke-Expression/iex: بينفّذ نص كأمر.' },
  { id: 'encoded-cmd', re: /(-enc(odedcommand)?\s+[A-Za-z0-9+/=]{20,}|base64\s+(-d|--decode)|frombase64string)/i, message: 'أمر مشفّر بـ base64: مخبّى شو بيعمل.' },
  { id: 'destructive', re: /(rm\s+-rf\s+[\/~$]|remove-item\b[^\n]*-recurse[^\n]*-force|del\s+\/[sqf]|format\s+[a-z]:|mkfs\.|dd\s+if=)/i, message: 'فيه أمر حذف/فرمتة خطير.' },
  { id: 'injection', re: /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts)|تجاهل\s+(كل\s+)?(التعليمات|القواعد)|انسى\s+(كل\s+)?(التعليمات|القواعد)/i, message: 'بيطلب من الموديل يتجاهل تعليماتو السابقة (prompt injection).' },
  { id: 'secrecy', re: /(do\s+not|don'?t|never)\s+(tell|inform|show|reveal)\s+(this\s+to\s+)?the\s+user|without\s+(telling|informing|asking)\s+the\s+user|ما\s+(تخبر|تقول|تعلم)\s+المستخدم|بدون\s+(ما\s+)?(تسأل|تخبر)\s+المستخدم/i, message: 'بيطلب إخفاء شي عنك أو التصرف بدون ما يسألك.' },
  { id: 'secrets', re: /(\.ssh[\\/]|id_rsa|\.aws[\\/]credentials|secure-keys|\bcookies?\.sqlite|login data|wallet\.dat)/i, message: 'بيذكر ملفات حساسة (مفاتيح SSH، بيانات AWS، كوكيز المتصفح، مفاتيح البرنامج).' },
  { id: 'exfil', re: /(send|post|upload|exfiltrate|forward|ارسل|ابعت|ارفع)[^\n]{0,80}https?:\/\/(?!localhost|127\.0\.0\.1)/i, message: 'بيطلب إرسال شي لرابط خارجي.' },
  { id: 'hidden-chars', re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/, message: 'فيه رموز مخفية (بتغيّر شو بتشوف مقابل شو بيقرأ الموديل).' },
  { id: 'blob', re: /[A-Za-z0-9+/]{240,}={0,2}/, message: 'فيه نص طويل مشفّر/مضغوط (ممكن يخبّي شي).' }
]

export function lintSkill(content: string): LintFinding[] {
  const out: LintFinding[] = []
  for (const r of RULES) if (r.re.test(content)) out.push({ id: r.id, message: r.message })
  return out
}