import { spawn } from 'child_process'
import { app, shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { findOnPath, isWin } from './platform'
import { claudeCliPath, claudeCliStatus, cleanEnv, getClaudeAcctCfg } from './cli-models'
import { readJson, writeJson } from './json-store'
import { getApiKey } from '../store/secure-store'
import { recordClaudeRun } from './claude-usage'
import { quarantineEmptyFragments } from './run-report'
import { recordEngineRun } from './usage-log'
import { subscriptionEnginesEnabled } from './feature-flags'

// Agent engines: the official command-line tools (Claude Code / Codex) run the WHOLE job themselves
// with their own tools, signed in with the user's account. The app only streams progress and returns the final answer.
export const CODEX_CLI = 'cli:codex'
// 5.16.2: موديل محدّد من حساب ChatGPT: cli:codex:<slug>
export const CODEX_MODEL_PREFIX = 'cli:codex:'
export const codexModelOf = (m: string): string | undefined => (m.startsWith(CODEX_MODEL_PREFIX) ? m.slice(CODEX_MODEL_PREFIX.length) : undefined)
// الموديلات الظاهرة لحسابك (من كاش codex). إذا ما قدرنا نقرأو، بنرجع للاثنين المعروفين.
export function codexModelsList(): string[] {
  try {
    const p = path.join(os.homedir(), '.codex', 'models_cache.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { models?: { slug?: string; visibility?: string; priority?: number }[] }
    const list = (j.models ?? []).filter((m) => m.visibility === 'list' && typeof m.slug === 'string').sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    return list.map((m) => m.slug as string)
  } catch {
    return ['gpt-5.6-terra', 'gpt-5.6-luna']
  }
}
export const GEMINI_CLI = 'cli:gemini'
// Order of preference when an engine fails: Google first (paid plan), then Claude, then ChatGPT (free plan, small limit).
// مخفية افتراضياً (انظر feature-flags.ts). فاضية = ما في محركات اشتراك في الفولباك ولا في المراجعة.
export const ENGINE_ORDER: string[] = subscriptionEnginesEnabled() ? [GEMINI_CLI, 'cli:claude', CODEX_CLI] : []
export const isAgentEngine = (m: string): boolean =>
  subscriptionEnginesEnabled() && (m === CODEX_CLI || m.startsWith(CODEX_MODEL_PREFIX) || m === GEMINI_CLI || m === 'cli:claude' || m.startsWith('cli:claude:'))

// "وضع الاستقلال الكامل": OFF by default. ON = the engines run without any permission prompts or sandbox.
// OFF = Claude limited to edits + an allow-list of tools, Codex sandboxed to the working folder.
const MODE_FILE = 'agent-mode.json'
export const getFullAutonomy = (): boolean => !!readJson<{ full?: boolean }>(MODE_FILE, {}).full
export const setFullAutonomy = (full: boolean): boolean => {
  writeJson(MODE_FILE, { full: !!full })
  return !!full
}

export const AUTONOMY_RULES = `
أنت وكيل تنفيذ مستقل (متل Claude Desktop). القواعد:
- نفّذ المهمة كاملة لحد ما تخلص، بدون ما تسأل "بدك كمّل؟" أو تطلب تأكيد. الصلاحية معطاة. اسأل بس إذا في قرار ما بينحدس ومخاطره كبيرة.
- بعد التنفيذ تحقّق فعلياً (شغّل أمر يثبت النتيجة: قراءة الملف، فحص العملية، اختبار)، واذكر دليل التحقق باختصار. ما تقول "تم" بدون دليل.
- إذا فشلت خطوة جرّب طريقة تانية قبل ما تستسلم.
- ما تحذف شي بشكل نهائي أو تعدّل إعدادات أمان بدون ما يطلب المستخدم صراحة. فضّل التحسين على الحذف.
- إذا الشغل طويل أو متعدد الخطوات: حافظ على ملف STATE.md بمجلد المشروع (شو انعمل، شو باقي، آخر أمر تحقق ونتيجته) وحدّثو بعد كل مرحلة. إذا انقطعت وجا محرّك تاني بيكمّل منو بدون ما يبدأ من الصفر.
- إذا انطلبت منك تكمّل شغل محرّك سابق: اقرأ STATE.md وافحص حالة الملفات الفعلية أول شي، ولا تعيد كتابة أو تقلّص أي وثيقة موجودة (SPEC/DESIGN/PLAN... إلخ). عدّل أو زيد عليها بس.
- التقرير النهائي لازم يعتمد على نتائج فعلية (أكواد خروج، مخرجات اختبارات)، مو على الذاكرة. اذكر شو فشل أو ما اتحقق منو.
- جاوب بلهجة شامية بسيطة وبنص عادي بدون نجوم ولا رموز تنسيق ولا حروف صينية أو روسية. المصطلحات التقنية بالإنجليزي.
`

type Opts = { signal?: AbortSignal; model?: string; system?: string; effort?: string; onProgress?: (t: string) => void; timeoutMs?: number; cwd?: string }
export type AgentResult = { text: string; model?: string; tools: string[] }

function runProc(exe: string, args: string[], input: string, o: Opts, env: NodeJS.ProcessEnv, onLine: (l: string) => void): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const useShell = isWin && /\.(cmd|bat)$/i.test(exe)
    const child = spawn(useShell ? '"' + exe + '"' : exe, args, { cwd: o.cwd || os.homedir(), env, windowsHide: true, shell: useShell })
    let buf = ''
    let err = ''
    let done = false
    const kill = (): void => {
      try {
        if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        else child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }
    const end = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(hardTimer)
      clearInterval(hb)
      o.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => {
      kill()
      end(() => reject(new Error('انلغى')))
    }
    // 5.14.0: مهلة خمول بدل مهلة مطلقة — طالما المحرك عم يطلّع مخرجات ما منقطعو، وسقف أعلى 3 ساعات
    const idleMs = o.timeoutMs ?? 10 * 60 * 1000
    const hardMs = Math.max(3 * 60 * 60 * 1000, idleMs)
    const fireTimeout = (): void => {
      o.onProgress?.('تنبيه: المحرّك توقّف (مهلة خمول أو سقف زمني)، بنوقفو وبنكمّل بالتالي')
      kill()
      end(() => reject(new Error('انتهت المهلة')))
    }
    let timer = setTimeout(fireTimeout, idleMs)
    const hardTimer = setTimeout(fireTimeout, hardMs)
    const t0 = Date.now()
    let lastAct = Date.now()
    // نبض كل دقيقة: بيثبت إنو المهمة شغّالة مو معلّقة
    const hb = setInterval(() => {
      if (o.cwd) {
        const q = quarantineEmptyFragments(o.cwd, t0)
        if (q.length) o.onProgress?.('حجر ملفات فاضية بأسماء شظايا: ' + q.join(', '))
      }
      o.onProgress?.('شغّال من ' + Math.round((Date.now() - t0) / 60000) + ' دقيقة — آخر نشاط قبل ' + Math.round((Date.now() - lastAct) / 1000) + ' ثانية')
    }, 60000)
    const bump = (): void => {
      if (done) return
      lastAct = Date.now()
      clearTimeout(timer)
      timer = setTimeout(fireTimeout, idleMs)
    }
    o.signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (d) => {
      bump()
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (l) onLine(l)
      }
    })
    child.stderr.on('data', (d) => {
      bump()
      err += d.toString('utf8')
    })
    child.on('error', (e) => end(() => reject(e)))
    child.on('close', (code) =>
      end(() => {
        if (buf.trim()) onLine(buf.trim())
        resolve({ code, err })
      })
    )
    child.stdin.on('error', () => undefined)
    child.stdin.end(input, 'utf8')
  })
}

const short = (s: string, n = 90): string => s.replace(/\s+/g, ' ').slice(0, n)

async function runClaudeAgentOnce(prompt: string, o: Opts): Promise<AgentResult> {
  const exe = claudeCliPath()
  if (!exe) throw new Error('أداة claude مو مثبّتة')
  const cfg = getClaudeAcctCfg()
  const sysFile = path.join(os.tmpdir(), 'trl-agent-sys-' + Date.now() + '.txt')
  fs.writeFileSync(sysFile, (o.system || '') + '\n' + AUTONOMY_RULES, 'utf8')
  const perm = getFullAutonomy() ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch']
  const args = ['-p', '--model', claudeModelId(o.model), ...(o.effort && o.effort !== 'auto' ? ['--effort', o.effort] : []), '--append-system-prompt-file', sysFile, ...perm, '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--disable-slash-commands']
  let final = ''
  let isErr = false
  let model: string | undefined
  const tools: string[] = []
  try {
    const r = await runProc(exe, args, prompt, o, cleanEnv(cfg.active), (l) => {
      let j: Record<string, unknown>
      try {
        j = JSON.parse(l)
      } catch {
        return
      }
      if (j.type === 'assistant') {
        const m = j.message as { model?: string; content?: { type: string; name?: string; input?: Record<string, unknown> }[] } | undefined
        if (m?.model) model = m.model
        for (const c of m?.content ?? []) {
          if (c.type !== 'tool_use') continue
          tools.push(c.name || '')
          const inp = c.input ?? {}
          o.onProgress?.((c.name || 'tool') + ': ' + short(String(inp.command ?? inp.file_path ?? inp.pattern ?? inp.url ?? '')))
        }
      } else if (j.type === 'result') {
        final = String(j.result ?? '')
        isErr = !!j.is_error
      }
    })
    if (isErr) throw new Error('claude: ' + short(final, 160))
    if (!final.trim()) throw new Error('claude: ' + short(r.err || 'ما رجع جواب (' + r.code + ')', 160))
    return { text: final.trim(), model, tools }
  } finally {
    fs.rm(sysFile, { force: true }, () => undefined)
  }
}

/** 5.16: كل تشغيل Claude بيتسجّل بالعدّاد المحلي، وبيطلع تنبيه عند 70% و90%. */
async function claudeCounted(p: string, o: Opts): Promise<AgentResult> {
  const t0 = Date.now()
  try {
    return await runClaudeAgentOnce(p, o)
  } finally {
    const a = recordClaudeRun((Date.now() - t0) / 60000)
    recordEngineRun('cli:claude', (Date.now() - t0) / 60000)
    if (a) o.onProgress?.(a)
  }
}

/** 5.16: المدير لازم يكمّل بنفسو إذا قال إنو في شغل بالخلفية ما إلو وكيل شغّال. يعيد التشغيل حد أقصى مرتين، وكل مرة بيذكّرو بالحقيقة. */
const BG_CLAIM = /بالخلفية|في الخلفية|in the background|still running|شغّالين|شغالين/i
const MAX_CONTINUES = 2
export async function runClaudeAgent(prompt: string, o: Opts): Promise<AgentResult> {
  let res = await claudeCounted(prompt, o)
  for (let n = 1; n <= MAX_CONTINUES && BG_CLAIM.test(res.text); n++) {
    o.onProgress?.('المدير قال إنو في شغل بالخلفية، بنتحقق. تحويلة ' + n + ' من ' + MAX_CONTINUES)
    const next = await claudeCounted(
      prompt + '\n\n---\nملاحظة من البرنامج: ردّك السابق قال إنو في شغل شغّال بالخلفية، والبرنامج ما لقى أي وكيل شغّال. ' +
        'ما في وكيل شغّال من جهتي، كمّل الشغل بنفسك ونفّذ الخطوات المتبقية مباشرة وأنهِ المهمة. إذا فعلاً في شي شغّال، اذكر اسمو وآخر مخرج لو بالتحديد. ' +
        'آخر رد منك كان:\n' + res.text.slice(0, 1500),
      o
    )
    res = { text: next.text, model: next.model ?? res.model, tools: [...res.tools, ...next.tools] }
  }
  return res
}

export function codexCliPath(): string | null {
  const cmd = path.join(process.env.APPDATA ?? '', 'npm', 'codex.cmd')
  if (isWin && fs.existsSync(cmd)) return cmd
  return findOnPath('codex')
}

/** 5.16: كل تشغيل بيتسجّل بسجل الاستخدام اليومي لكل محرّك. */
export async function runCodexAgent(prompt: string, o: Opts): Promise<AgentResult> {
  const t0 = Date.now()
  try {
    return await runCodexAgentOnce(prompt, o)
  } finally {
    recordEngineRun(CODEX_CLI, (Date.now() - t0) / 60000)
  }
}

async function runCodexAgentOnce(prompt: string, o: Opts): Promise<AgentResult> {
  const exe = codexCliPath()
  if (!exe) throw new Error('أداة codex مو مثبّتة')
  const outFile = path.join(os.tmpdir(), 'trl-codex-out-' + Date.now() + '.txt')
  const env = { ...process.env }
  delete env.OPENAI_API_KEY // use the signed-in ChatGPT account, not a billed key
  const sandbox = getFullAutonomy() ? 'danger-full-access' : 'workspace-write'
  const args = ['exec', '--json', '--skip-git-repo-check', '-s', sandbox, '-C', o.cwd || os.homedir(), '-o', outFile, '-m', o.model || 'gpt-5.6-terra', '-']
  const tools: string[] = []
  let lastMsg = ''
  try {
    const r = await runProc(exe, args, (o.system ? o.system + '\n' : '') + AUTONOMY_RULES + '\n\nالمهمة:\n' + prompt, o, env, (l) => {
      let j: { type?: string; item?: { type?: string; command?: string; text?: string } }
      try {
        j = JSON.parse(l)
      } catch {
        return
      }
      const it = j.item
      if (j.type === 'item.started' && it?.type === 'command_execution') {
        tools.push('shell')
        o.onProgress?.('shell: ' + short(it.command ?? ''))
      }
      if (j.type === 'item.completed' && it?.type === 'agent_message' && it.text) lastMsg = it.text
    })
    let text = ''
    try {
      text = fs.readFileSync(outFile, 'utf8').trim()
    } catch {
      /* none */
    }
    text = text || lastMsg.trim()
    if (!text) throw new Error('codex: ' + short(r.err || 'ما رجع جواب (' + r.code + ')', 160))
    return { text, tools }
  } finally {
    fs.rm(outFile, { force: true }, () => undefined)
  }
}
// Google engine = Antigravity CLI (agy). Google shut down Gemini CLI sign-in for personal accounts, and the account route returns 403
// (managed project), so agy runs with the Gemini API key. It runs in its own isolated profile (own settings, none of the global MCP servers).
export function geminiCliPath(): string | null {
  const p = path.join(process.env.LOCALAPPDATA ?? '', 'agy', 'bin', isWin ? 'agy.exe' : 'agy')
  if (fs.existsSync(p)) return p
  return findOnPath('agy')
}
export const geminiHome = (): string => path.join(app.getPath('userData'), 'agy-home')
function geminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  try {
    return getApiKey('GEMINI_API_KEY' as never)
  } catch {
    return ''
  }
}
export const geminiLoggedIn = (): boolean => !!geminiKey()
function ensureGeminiHome(): void {
  const d = path.join(geminiHome(), '.gemini', 'antigravity-cli')
  fs.mkdirSync(d, { recursive: true })
  const f = path.join(d, 'settings.json')
  fs.writeFileSync(f, JSON.stringify({ modelProvider: 'gemini', trustedWorkspaces: [os.homedir(), os.tmpdir()] }, null, 2))
}
// Claude Code default for the agent engine: newest Sonnet; aliases from the picker map to full ids.
const CLAUDE_AGENT_DEFAULT = 'claude-sonnet-5-5'
const claudeModelId = (m?: string): string => (!m || m === 'sonnet' ? CLAUDE_AGENT_DEFAULT : m)
export const AGY_DEFAULT_MODEL = 'gemini-3.8-flash-high'

export async function runGeminiAgent(prompt: string, o: Opts): Promise<AgentResult> {
  const t0 = Date.now()
  try {
    // 5.16.1: agy idle timeout 2 min by default (was the 10-min generic one), so a stuck run fails fast and the next engine takes over.
    return await runGeminiAgentOnce(prompt, { ...o, timeoutMs: o.timeoutMs ?? 2 * 60 * 1000 })
  } finally {
    recordEngineRun(GEMINI_CLI, (Date.now() - t0) / 60000)
  }
}

async function runGeminiAgentOnce(prompt: string, o: Opts): Promise<AgentResult> {
  const exe = geminiCliPath()
  if (!exe) throw new Error('agy (Antigravity) مو مثبّتة')
  const key = geminiKey()
  if (!key) throw new Error('agy: ما في مفتاح Gemini (حطو من الإعدادات)')
  ensureGeminiHome()
  const home = geminiHome()
  const env: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'), GEMINI_API_KEY: key }
  // The task goes through a file (command-line length / Arabic safe); the argument only points at it.
  const taskFile = path.join(os.tmpdir(), 'trl-agy-task-' + Date.now() + '.txt')
  fs.writeFileSync(taskFile, (o.system ? o.system + '\n' : '') + AUTONOMY_RULES + '\n\nالمهمة:\n' + prompt, 'utf8')
  const perm = getFullAutonomy() ? ['--dangerously-skip-permissions'] : ['--mode', 'accept-edits', '--sandbox']
  const args = ['--model', o.model || AGY_DEFAULT_MODEL, ...perm, '--output-format', 'stream-json', '--disable-slash-commands', '-p=Read the full task from the file ' + taskFile.replace(/\\/g, '/') + ' and carry it out completely, following every rule in it. Reply with the final answer in Levantine Arabic.']
  const tools: string[] = []
  let text = ''
  let errMsg = ''
  const seen = new Set<string>()
  try {
    const r = await runProc(exe, args, '', o, env, (l) => {
      let j: { event?: string; step_update?: { step_index?: number; state?: string; step_type?: string; tool_name?: string; tool_info?: { parameters?: Record<string, unknown> }; text_delta?: string }; result?: { status?: string; response?: string; error?: string } }
      try {
        j = JSON.parse(l)
      } catch {
        return
      }
      if (j.event === 'step_update' && j.step_update?.step_type === 'tool' && j.step_update.state === 'ACTIVE') {
        const u = j.step_update
        const id = String(u.step_index)
        if (seen.has(id)) return
        seen.add(id)
        tools.push(u.tool_name || 'tool')
        const p = u.tool_info?.parameters ?? {}
        o.onProgress?.((u.tool_name || 'tool') + ': ' + short(String(p.CommandLine ?? p.TargetFile ?? p.AbsolutePath ?? p.Url ?? p.Query ?? '')))
      } else if (j.event === 'result' && j.result) {
        if (j.result.status === 'SUCCESS') text = j.result.response ?? ''
        else errMsg = j.result.error ?? 'status ' + j.result.status
      }
    })
    if (errMsg && !text.trim()) throw new Error('agy: ' + short(errMsg, 160))
    if (!text.trim()) throw new Error('agy: ' + short(r.err || 'ما رجع جواب (' + r.code + ')', 160))
    return { text: text.trim(), tools }
  } finally {
    fs.rm(taskFile, { force: true }, () => undefined)
  }
}

export const codexLoggedIn = (): boolean => fs.existsSync(path.join(os.homedir(), '.codex', 'auth.json'))

export type AcctKind = 'gemini' | 'codex' | 'claude'
export async function accountsStatus(): Promise<{ gemini: { installed: boolean; loggedIn: boolean }; codex: { installed: boolean; loggedIn: boolean }; claude: { installed: boolean; loggedIn: boolean } }> {
  const c = await claudeCliStatus('work').catch(() => ({ installed: !!claudeCliPath(), loggedIn: false }))
  return { gemini: { installed: !!geminiCliPath(), loggedIn: geminiLoggedIn() }, codex: { installed: !!codexCliPath(), loggedIn: codexLoggedIn() }, claude: { installed: c.installed, loggedIn: c.loggedIn } }
}
// Opens a visible terminal so the user signs in himself in the browser. The app never sees or stores the tokens.
export function accountLogin(kind: AcctKind): { ok: boolean; error?: string } {
  if (kind === 'gemini') {
    void shell.openExternal('https://aistudio.google.com/apikey')
    return { ok: true }
  }
  const exe = kind === 'codex' ? codexCliPath() : claudeCliPath()
  if (!exe) return { ok: false, error: 'الأداة مو مثبّتة' }
  if (!isWin) return { ok: false, error: 'شغّل بالتيرمينال: ' + path.basename(exe) + (kind === 'codex' ? ' login' : kind === 'claude' ? ' auth login' : '') }
  let run = exe
  if (!/\.(exe|cmd|bat)$/i.test(run)) {
    const alt = path.join(path.dirname(run), path.basename(run) + '.cmd')
    if (fs.existsSync(alt)) run = alt
  }
  const sub = kind === 'codex' ? ' login' : kind === 'claude' ? ' auth login' : ''
  const bat = path.join(os.tmpdir(), 'trl-login-' + kind + '.bat')
  fs.writeFileSync(bat, ['@echo off', 'chcp 65001 >nul', 'title Login ' + kind, 'call "' + run + '"' + sub, 'echo.', 'echo Done. You can close this window, then press Refresh in the app.', 'pause', ''].join('\r\n'))
  spawn('cmd.exe', ['/c', 'start', '', bat], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  return { ok: true }
}
