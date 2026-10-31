// 5.18.0: أدوات تطوير جديدة: Git/GitHub، Kubernetes/GCP/Terraform، بحث وجلب ويب، ملفات وأرشيف وبيانات.
// القاعدة: أوامر القراءة بتشتغل مباشرة بدون shell (execFile). أي أمر بيغيّر شي بيمر من نفس بوابة pc_run (موافقة المستخدم + حارس الحذف).
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { rp } from './pathbase'
import { currentMode } from '../core/progress'

type Handler = (a: Record<string, unknown>) => Promise<string>
type Def = (name: string, description: string, props: Record<string, unknown>, required: string[], h: Handler) => void

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const cut = (t: string, n = 6000): string => (t.length > n ? '…[start cut]\n' + t.slice(-n) : t)

/** تقسيم سطر أوامر بسيط مع دعم الاقتباس. */
export function splitArgs(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  let has = false
  for (const ch of line.trim()) {
    if (q) {
      if (ch === q) q = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      q = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur)
      cur = ''
      has = false
    } else cur += ch
  }
  if (cur || has) out.push(cur)
  return out
}

type Kit = { bin: string; readOnly: (a: string[]) => boolean; destructive: (a: string[]) => boolean; shell?: boolean }
const first = (a: string[], skip = 0): string => a.filter((x) => !x.startsWith('-'))[skip] ?? ''
const has = (a: string[], ...w: string[]): boolean => a.some((x) => w.includes(x))

export const KITS: Record<string, Kit> = {
  git: {
    bin: 'git',
    readOnly: (a) => {
      const c = first(a)
      if (['status', 'diff', 'log', 'show', 'blame', 'shortlog', 'describe', 'rev-parse', 'ls-files', 'ls-tree', 'grep', 'remote', 'config', 'cat-file', 'reflog', 'tag', 'branch', 'stash', 'worktree', 'version'].includes(c) || a[0] === '--version') {
        if (c === 'remote') return !has(a, 'add', 'remove', 'rm', 'set-url', 'rename', 'prune')
        if (c === 'config') return !!a.find((x) => x === '--get' || x === '--list' || x === '-l' || x === '--get-all')
        if (c === 'tag') return !a.some((x) => !x.startsWith('-') && x !== 'tag') || has(a, '-l', '--list')
        if (c === 'branch') return !has(a, '-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move', '--copy', '--set-upstream-to', '-u') && (a.length === 1 || a.every((x) => x.startsWith('-') || x === 'branch'))
        if (c === 'stash') return has(a, 'list', 'show')
        if (c === 'worktree') return has(a, 'list')
        return true
      }
      return false
    },
    destructive: (a) => {
      const c = first(a)
      return (c === 'reset' && has(a, '--hard')) || c === 'clean' || (c === 'push' && (has(a, '-f', '--force', '--force-with-lease', '--delete', '-d') || a.some((x) => x.startsWith('+')))) || (c === 'branch' && has(a, '-D', '-d', '--delete')) || (c === 'checkout' && (has(a, '--') || has(a, '.'))) || (c === 'stash' && has(a, 'drop', 'clear')) || (c === 'restore' && !has(a, '--staged')) || (c === 'rebase') || (c === 'filter-branch')
    }
  },
  gh: {
    bin: 'gh',
    readOnly: (a) => {
      const g = first(a)
      const act = first(a, 1)
      if (['pr', 'issue', 'repo', 'run', 'release', 'workflow', 'gist', 'label', 'search', 'project'].includes(g)) return ['list', 'view', 'status', 'diff', 'checks', 'watch'].includes(act) || g === 'search'
      if (g === 'api') return !has(a, '-X', '--method') && !has(a, '-f', '-F', '--field', '--raw-field', '--input')
      return g === 'auth' && act === 'status'
    },
    destructive: (a) => (first(a, 1) === 'delete' || (first(a) === 'repo' && first(a, 1) === 'archive') || (first(a) === 'api' && has(a, 'DELETE')))
  },
  kubectl: {
    bin: 'kubectl',
    readOnly: (a) => ['get', 'describe', 'logs', 'top', 'version', 'api-resources', 'api-versions', 'explain', 'cluster-info', 'diff', 'events'].includes(first(a)) || (first(a) === 'config' && ['view', 'get-contexts', 'current-context'].includes(first(a, 1))) || (first(a) === 'auth' && first(a, 1) === 'can-i') || (first(a) === 'rollout' && ['status', 'history'].includes(first(a, 1))),
    destructive: (a) => ['delete', 'drain', 'cordon', 'taint', 'replace'].includes(first(a)) || (first(a) === 'apply' && has(a, '--prune')) || (first(a) === 'scale' && a.some((x) => /=0$/.test(x) || x === '0'))
  },
  gcloud: {
    bin: 'gcloud',
    shell: true,
    readOnly: (a) => {
      const w = a.filter((x) => !x.startsWith('-'))
      const last = w[w.length - 1] ?? ''
      return ['list', 'describe', 'get-value', 'get-credentials', 'print-access-token', 'info', 'version', 'read'].includes(last) && !has(a, 'print-access-token')
    },
    destructive: (a) => a.some((x) => ['delete', 'remove-iam-policy-binding', 'remove', 'disable', 'reset', 'stop', 'terminate'].includes(x))
  },
  terraform: {
    bin: 'terraform',
    readOnly: (a) => ['version', 'validate', 'show', 'output', 'providers', 'graph', 'state', 'workspace', 'fmt', 'plan', 'console'].includes(first(a)) && !(first(a) === 'state' && !has(a, 'list', 'show')) && !(first(a) === 'workspace' && !has(a, 'list', 'show')) && !(first(a) === 'fmt' && !has(a, '-check')) && !(first(a) === 'console') && !has(a, '-out') ,
    destructive: (a) => first(a) === 'destroy' || (first(a) === 'apply' && has(a, '-auto-approve', '-destroy')) || (first(a) === 'state' && has(a, 'rm', 'mv', 'push')) || (first(a) === 'taint') || (first(a) === 'force-unlock')
  }
}

const SAFE_SHELL_TOKEN = /^[\w@%+=:,./\\-]+$/

function runDirect(kit: Kit, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    if (kit.shell && !args.every((x) => SAFE_SHELL_TOKEN.test(x) || /^--?[\w-]+(=[\w@%+=:,./\\-]+)?$/.test(x))) return resolve('Error: رموز غير آمنة بالأمر (للقراءة المباشرة بس الحروف والأرقام والـ - _ . / : = مسموحة).')
    const bin = kit.shell && process.platform === 'win32' ? kit.bin + '.cmd' : kit.bin
    execFile(bin, args, { cwd: cwd || undefined, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, shell: !!kit.shell && process.platform === 'win32', signal }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr ? (stdout ? '\n' : '') + stderr : '')
      if (err && !out) return resolve(`Error: ${errMsg(err)}`)
      resolve(cut(out.trim() || (err ? `Error: ${errMsg(err)}` : '(no output)')))
    })
  })
}

const psq = (x: string): string => "'" + x.replace(/'/g, "''") + "'"

// ---------- web helpers ----------
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?fe80)/i

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

async function webFetch(url: string, maxChars: number): Promise<string> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'Error: رابط غير صالح'
  }
  if (!/^https?:$/.test(u.protocol)) return 'Error: بس http/https'
  if (PRIVATE_HOST.test(u.hostname)) return 'Error: العناوين المحلية/الداخلية ممنوعة بهالأداة'
  try {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 TRL-Agent', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' } })
    const fin = new URL(r.url)
    if (PRIVATE_HOST.test(fin.hostname)) return 'Error: التحويل راح لعنوان داخلي'
    const ct = r.headers.get('content-type') ?? ''
    if (!r.ok) return `Error: HTTP ${r.status}`
    if (/^(image|video|audio)\//i.test(ct) || /zip|octet-stream|pdf/i.test(ct)) return `Error: نوع المحتوى ${ct} مو نصي (ما بنزّل ملفات بهالأداة).`
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 2_000_000).toString('utf8')
    const text = /html/i.test(ct) ? htmlToText(buf) : buf
    return `[${r.url} · ${ct.split(';')[0]}]\n` + (text.length > maxChars ? text.slice(0, maxChars) + '\n…[cut]' : text)
  } catch (e) {
    return 'Error: ' + errMsg(e)
  }
}

async function webSearch(q: string, n: number): Promise<string> {
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 TRL-Agent' } })
    if (!r.ok) return `Error: HTTP ${r.status}`
    const html = await r.text()
    const out: string[] = []
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) && out.length < n) {
      let href = m[1]
      const ud = href.match(/[?&]uddg=([^&]+)/)
      if (ud) href = decodeURIComponent(ud[1])
      out.push(`${out.length + 1}. ${htmlToText(m[2])}\n   ${href}\n   ${htmlToText(m[3] ?? '')}`)
    }
    return out.length ? out.join('\n') : 'ما لقيت نتائج (أو المحرك رفض الطلب). جرّب صياغة تانية.'
  } catch (e) {
    return 'Error: ' + errMsg(e)
  }
}

// ---------- file / data helpers ----------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '__pycache__', '.venv', 'venv', 'target'])

async function searchFiles(root: string, pattern: string, glob: string, max: number): Promise<string> {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  const gl = glob ? new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null
  const hits: string[] = []
  let files = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (hits.length >= max || depth > 12) return
    let ents: fs.Dirent[]
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (hits.length >= max) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(p, depth + 1)
      } else if (e.isFile() && (!gl || gl.test(e.name))) {
        let st: fs.Stats
        try {
          st = await fsp.stat(p)
        } catch {
          continue
        }
        if (st.size > 1_500_000) continue
        files++
        let txt: string
        try {
          txt = await fsp.readFile(p, 'utf8')
        } catch {
          continue
        }
        if (txt.includes('\u0000')) continue
        const lines = txt.split(/\r?\n/)
        for (let i = 0; i < lines.length && hits.length < max; i++) if (re.test(lines[i])) hits.push(`${path.relative(root, p)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
      }
    }
  }
  const st = await fsp.stat(root).catch(() => null)
  if (!st) return 'Error: المسار مو موجود'
  if (st.isFile()) {
    const txt = await fsp.readFile(root, 'utf8').catch(() => '')
    txt.split(/\r?\n/).forEach((l, i) => { if (hits.length < max && re.test(l)) hits.push(`${path.basename(root)}:${i + 1}: ${l.trim().slice(0, 200)}`) })
  } else await walk(root, 0)
  return hits.length ? `${hits.length}${hits.length >= max ? '+' : ''} تطابق (فحصت ${files} ملف):\n` + hits.join('\n') : `ما في تطابق (فحصت ${files} ملف).`
}

function lineDiff(a: string[], b: string[]): string {
  // LCS بسيط محدود الحجم
  if (a.length * b.length > 4_000_000) return 'Error: الملفين كبار كتير للمقارنة (استعمل git diff --no-index).'
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${i + 1}: ${a[i++]}`)
    else out.push(`+ ${j + 1}: ${b[j++]}`)
  }
  while (i < a.length) out.push(`- ${i + 1}: ${a[i++]}`)
  while (j < b.length) out.push(`+ ${j + 1}: ${b[j++]}`)
  return out.length ? cut(out.join('\n'), 8000) : 'الملفين متطابقين.'
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',' || c === ';' || c === '\t') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row) }
  return rows
}

function jsonGet(data: unknown, pointer: string): unknown {
  if (!pointer || pointer === '.' || pointer === '$') return data
  let cur: unknown = data
  for (const part of pointer.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function addDevTools(def: Def, handlers: Map<string, Handler>, getSignal?: () => AbortSignal | undefined): void {
  const str = { type: 'string' }
  const num = { type: 'number' }

  // ---- 1) Git / GitHub / Kubernetes / GCP / Terraform: أداة لكل واحد، نفس المنطق ----
  const cli = (name: keyof typeof KITS, what: string): void => {
    const kit = KITS[name]
    def(
      name === 'gh' ? 'gh_cli' : name === 'git' ? 'git_cli' : name + '_cli',
      `${what} مرّر 'args' (بدون اسم الأداة)، و'cwd' للمجلد. أوامر القراءة بتشتغل فوراً. أي أمر بيغيّر شي بيطلب موافقة المستخدم متل pc_run. بوضع بناء المشروع الأوامر الهدّامة ممنوعة (حذف/force/destroy/reset --hard...).`,
      { args: str, cwd: str, timeout_seconds: num },
      ['args'],
      async (a) => {
        const args = splitArgs(s(a.args))
        if (!args.length) return 'Error: args فاضية'
        if (args[0].toLowerCase() === kit.bin) args.shift()
        const cwd = s(a.cwd).trim() ? rp(s(a.cwd)) : rp('.')
        const secs = Math.min(1800, Math.max(10, Number(a.timeout_seconds) || 120))
        if (currentMode()?.kind === 'auto' && kit.destructive(args)) return `Error: بوضع بناء المشروع هالأمر الهدّام ممنوع (${name} ${args.join(' ')}). اعمل نسخة احتياطية/أرشفة بدل الحذف أو اطلب من المستخدم ينفذه بإيده.`
        if (kit.readOnly(args)) return runDirect(kit, args, cwd, secs * 1000, getSignal?.())
        const pc = handlers.get('pc_run')
        if (!pc) return 'Error: pc_run مو متاح (أدوات الكمبيوتر مطفية).'
        return pc({ command: '& ' + kit.bin + ' ' + args.map(psq).join(' '), cwd, timeout_seconds: secs })
      }
    )
  }
  cli('git', 'شغّل أمر git على المشروع (status, diff, log, show, blame, branch, add, commit...).')
  cli('gh', 'شغّل GitHub CLI (gh pr list/view, gh issue list/view, gh run list/view, gh api ...). لازم يكون gh مسجّل دخول.')
  cli('kubectl', 'شغّل kubectl (get/describe/logs/top، وapply/rollout/scale بموافقة).')
  cli('gcloud', 'شغّل gcloud (… list / describe للقراءة، وأي تعديل بموافقة).')
  cli('terraform', 'شغّل terraform (validate/plan/show/output للقراءة؛ apply/destroy بموافقة، destroy ممنوع ببناء المشروع).')

  // ---- 2) ويب ----
  def('web_search', 'ابحث بالإنترنت (DuckDuckGo) وارجع عناوين ورابط وملخص لكل نتيجة. بعدها استعمل web_fetch لقراءة الصفحة.', { query: str, max_results: num }, ['query'], async (a) => {
    const q = s(a.query).trim()
    if (!q) return 'Error: query فاضية'
    return webSearch(q, Math.min(10, Math.max(1, Number(a.max_results) || 6)))
  })
  def('web_fetch', 'اجلب صفحة ويب (http/https) وارجع نصها بدون HTML. ما بينزّل ملفات وما بيفتح عناوين محلية/داخلية.', { url: str, max_chars: num }, ['url'], async (a) =>
    webFetch(s(a.url).trim(), Math.min(60000, Math.max(500, Number(a.max_chars) || 12000)))
  )

  // ---- 3) ملفات وأرشيف وبيانات ----
  def('file_search', 'ابحث عن نص/Regex داخل محتوى الملفات بمجلد (بيتجاهل node_modules/.git). اختياري glob متل *.ts وmax_results.', { pattern: str, path: str, glob: str, max_results: num }, ['pattern'], async (a) =>
    searchFiles(rp(s(a.path) || '.'), s(a.pattern), s(a.glob), Math.min(500, Math.max(1, Number(a.max_results) || 80)))
  )
  def('file_diff', 'قارن ملفين نصيين سطر بسطر (- محذوف من الأول، + مضاف بالتاني).', { file_a: str, file_b: str }, ['file_a', 'file_b'], async (a) => {
    try {
      const [x, y] = await Promise.all([fsp.readFile(rp(s(a.file_a)), 'utf8'), fsp.readFile(rp(s(a.file_b)), 'utf8')])
      return lineDiff(x.split(/\r?\n/), y.split(/\r?\n/))
    } catch (e) {
      return 'Error: ' + errMsg(e)
    }
  })
  def('csv_preview', 'اقرأ ملف CSV: الأعمدة وأول صفوف. اختياري where_col + where_value لفلترة (يحتوي)، وlimit.', { path: str, limit: num, where_col: str, where_value: str }, ['path'], async (a) => {
    try {
      const rows = parseCsv(await fsp.readFile(rp(s(a.path)), 'utf8')).filter((r) => r.length > 1 || (r[0] ?? '') !== '')
      if (!rows.length) return 'الملف فاضي'
      const head = rows[0]
      let body = rows.slice(1)
      const wc = s(a.where_col)
      if (wc) {
        const ci = head.indexOf(wc)
        if (ci < 0) return `Error: العمود ${wc} مو موجود. الأعمدة: ${head.join(' | ')}`
        body = body.filter((r) => (r[ci] ?? '').toLowerCase().includes(s(a.where_value).toLowerCase()))
      }
      const lim = Math.min(200, Math.max(1, Number(a.limit) || 20))
      return `الأعمدة (${head.length}): ${head.join(' | ')}\nعدد الصفوف${wc ? ' المطابقة' : ''}: ${body.length}\n` + body.slice(0, lim).map((r) => r.join(' | ')).join('\n')
    } catch (e) {
      return 'Error: ' + errMsg(e)
    }
  })
  def('json_get', "اقرأ قيمة من ملف JSON بمسار نقطي (مثال: data.items[0].name أو '.' لكل الملف).", { path: str, pointer: str }, ['path'], async (a) => {
    try {
      const v = jsonGet(JSON.parse(await fsp.readFile(rp(s(a.path)), 'utf8')), s(a.pointer))
      if (v === undefined) return 'ما لقيت هالمسار بالـ JSON'
      return cut(JSON.stringify(v, null, 2), 8000)
    } catch (e) {
      return 'Error: ' + errMsg(e)
    }
  })
  def('sqlite_query', 'نفّذ استعلام SELECT (قراءة فقط) على ملف SQLite عبر sqlite3 CLI. غير SELECT/PRAGMA/EXPLAIN ممنوع.', { db: str, sql: str }, ['db', 'sql'], async (a) => {
    const sql = s(a.sql).trim()
    if (!/^(select|with|pragma\s+table_info|pragma\s+table_list|explain)\b/i.test(sql) || /;\s*\S/.test(sql) || /\b(insert|update|delete|drop|alter|create|attach|replace|vacuum)\b/i.test(sql)) return 'Error: بس استعلام قراءة واحد (SELECT).'
    return new Promise<string>((resolve) =>
      execFile('sqlite3', ['-readonly', '-header', '-column', rp(s(a.db)), sql], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) =>
        resolve(err && !so ? 'Error: ' + (se || errMsg(err)) + ' (تأكد إن sqlite3 منصّب)' : cut(so.trim() || '(لا نتائج)'))
      )
    )
  })
  def('zip_list', 'اعرض محتويات ملف zip بدون فكّه.', { path: str }, ['path'], async (a) => {
    const pc = handlers.get('pc_run')
    const p = rp(s(a.path))
    return new Promise<string>((resolve) =>
      execFile('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead(${psq(p)}); $z.Entries | ForEach-Object { '{0}  {1}' -f $_.FullName, $_.Length }; $z.Dispose()`], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
        void pc
        resolve(err && !so ? 'Error: ' + (se || errMsg(err)) : cut(so.trim() || '(فاضي)'))
      })
    )
  })
  def('zip_create', 'اضغط ملف/مجلد إلى zip (بدون استبدال ملف موجود).', { source: str, dest: str }, ['source', 'dest'], async (a) => {
    const pc = handlers.get('pc_run')
    if (!pc) return 'Error: pc_run مو متاح.'
    const src = rp(s(a.source))
    const dest = rp(s(a.dest))
    if (fs.existsSync(dest)) return `Error: ${dest} موجود. اختار اسم تاني (ما منستبدل).`
    return pc({ command: `Compress-Archive -LiteralPath ${psq(src)} -DestinationPath ${psq(dest)}; 'created ' + ${psq(dest)}`, timeout_seconds: 300 })
  })
  def('zip_extract', 'فك ملف zip لمجلد (بدون استبدال ملفات موجودة).', { zip: str, dest: str }, ['zip', 'dest'], async (a) => {
    const pc = handlers.get('pc_run')
    if (!pc) return 'Error: pc_run مو متاح.'
    return pc({ command: `Expand-Archive -LiteralPath ${psq(rp(s(a.zip)))} -DestinationPath ${psq(rp(s(a.dest)))}; 'extracted'`, timeout_seconds: 300 })
  })
}

// Name + short description of every dev tool (for the Tools page).
export function devToolsInfo(): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = []
  addDevTools(((name: string, description: string) => { out.push({ name, description: description.split(' \u0645\u0631\u0651\u0631')[0] }) }) as unknown as Def, new Map())
  return out
}
