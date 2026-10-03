import { spawn, execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { findOnPath, isWin } from './platform'
import { readJson, writeJson } from './json-store'

// Models that run through an official command-line tool the user is already signed in to
// (an account/subscription, not an API key). The app never reads or stores their tokens.
export const CLI_PREFIX = 'cli:'
export const CLAUDE_CLI = 'cli:claude'
// Claude models offered through the signed-in account. 'cli:claude' alone = the account's default model.
export const CLAUDE_CLI_MODELS: { id: string; alias: string; label: string }[] = [
  { id: 'cli:claude:sonnet', alias: 'sonnet', label: 'Claude Sonnet (حسابك)' },
  { id: 'cli:claude:opus', alias: 'opus', label: 'Claude Opus (حسابك)' },
  { id: 'cli:claude:haiku', alias: 'haiku', label: 'Claude Haiku (حسابك)' }
]
export const cliModelAlias = (m: string): string | undefined => CLAUDE_CLI_MODELS.find((x) => x.id === m)?.alias

export const isCliModel = (m: string): boolean => m.startsWith(CLI_PREFIX)
export const cliModelName = (m: string): string => (m === CLAUDE_CLI ? 'Claude (حسابك عبر Claude Code)' : (CLAUDE_CLI_MODELS.find((x) => x.id === m)?.label ?? m))

export function claudeCliPath(): string | null {
  const onPath = findOnPath('claude')
  if (onPath) return onPath
  const home = os.homedir()
  const cands = isWin
    ? [path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), path.join(home, '.local', 'bin', 'claude.exe')]
    : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/usr/bin/claude']
  return cands.find((p) => p && fs.existsSync(p)) ?? null
}

// Child environment without API keys, so the tool uses the signed-in account instead of billing a key.
// Two Claude accounts can be used: 'work' = the default signed-in profile, 'personal' = a separate profile folder owned by this app.
export type ClaudeAcct = 'work' | 'personal'
type AcctCfg = { active: ClaudeAcct; auto: boolean }
const ACCT_FILE = 'claude-account.json'
export const getClaudeAcctCfg = (): AcctCfg => ({ active: 'work', auto: true, ...readJson<Partial<AcctCfg>>(ACCT_FILE, {}) })
export const setClaudeAcctCfg = (p: Partial<AcctCfg>): AcctCfg => {
  const n = { ...getClaudeAcctCfg(), ...p }
  writeJson(ACCT_FILE, n)
  return n
}
export const personalClaudeDir = (): string => path.join(app.getPath('userData'), 'claude-personal')
const hasCreds = (a: ClaudeAcct): boolean => a === 'work' || fs.existsSync(path.join(personalClaudeDir(), '.credentials.json'))

function cleanEnv(acct: ClaudeAcct = 'work'): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  if (acct === 'personal') env.CLAUDE_CONFIG_DIR = personalClaudeDir()
  return env
}

// Opens a visible terminal so the user can sign in to the personal profile in the browser.
export function claudePersonalLogin(): { ok: boolean; error?: string } {
  const exe = claudeCliPath()
  if (!exe) return { ok: false, error: 'أداة claude مو مثبّتة' }
  fs.mkdirSync(personalClaudeDir(), { recursive: true })
  if (!isWin) return { ok: false, error: 'شغّل بالتيرمينال: CLAUDE_CONFIG_DIR="' + personalClaudeDir() + '" claude auth login' }
  const cmd = 'set "CLAUDE_CONFIG_DIR=' + personalClaudeDir() + '" && "' + exe + '" auth login'
  spawn('cmd.exe', ['/c', 'start', '"تسجيل دخول Claude الشخصي"', 'cmd.exe', '/k', cmd], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  return { ok: true }
}

export function claudeCliStatus(acct: ClaudeAcct = 'work'): Promise<{ installed: boolean; loggedIn: boolean; email?: string; plan?: string }> {
  return new Promise((resolve) => {
    const exe = claudeCliPath()
    if (!exe) return resolve({ installed: false, loggedIn: false })
    execFile(exe, ['auth', 'status'], { timeout: 20000, windowsHide: true, env: cleanEnv(acct), cwd: os.tmpdir() }, (_e, out) => {
      try {
        const j = JSON.parse(String(out))
        resolve({ installed: true, loggedIn: !!j.loggedIn, email: j.email, plan: j.subscriptionType })
      } catch {
        resolve({ installed: true, loggedIn: false })
      }
    })
  })
}

export function buildCliPrompt(system: string | undefined, history: { role: string; content: string }[], user: string): string {
  const parts: string[] = []
  if (system) parts.push('INSTRUCTIONS:\n' + system)
  if (history.length) parts.push('CONVERSATION SO FAR:\n' + history.map((h) => (h.role === 'user' ? 'User: ' : 'Assistant: ') + h.content).join('\n\n'))
  parts.push((history.length || system ? 'CURRENT USER MESSAGE:\n' : '') + user)
  return parts.join('\n\n')
}

// One non-interactive answer from the signed-in Claude account. All tools are disabled and the
// working folder is a temp dir, so it behaves like a plain chat model and cannot touch files.
export async function runClaudeCli(prompt: string, signal?: AbortSignal, model?: string, timeoutMs = 180000, effort?: string, system?: string): Promise<string> {
  return (await runClaudeCliEx(prompt, signal, model, timeoutMs, effort, system)).text
}

// Same, but also returns the real model id the account used (e.g. "claude-sonnet-5") and honors the session effort.
export async function runClaudeCliEx(prompt: string, signal?: AbortSignal, model?: string, timeoutMs = 180000, effort?: string, system?: string): Promise<{ text: string; model?: string; account?: ClaudeAcct }> {
  const cfg = getClaudeAcctCfg()
  const other: ClaudeAcct = cfg.active === 'work' ? 'personal' : 'work'
  try {
    const r = await runClaudeOnce(cfg.active, prompt, signal, model, timeoutMs, effort, system)
    return { ...r, account: cfg.active }
  } catch (e) {
    // Out of quota / rate limited on this account: switch to the other one automatically (if it is signed in).
    if (cfg.auto && hasCreds(other) && /limit|quota|usage|credit|rate|overload|429|exceed/i.test(String((e as Error).message))) {
      const r = await runClaudeOnce(other, prompt, signal, model, timeoutMs, effort, system)
      return { ...r, account: other }
    }
    throw e
  }
}

function runClaudeOnce(acct: ClaudeAcct, prompt: string, signal?: AbortSignal, model?: string, timeoutMs = 180000, effort?: string, system?: string): Promise<{ text: string; model?: string }> {
  return new Promise((resolve, reject) => {
    const exe = claudeCliPath()
    if (!exe) return reject(new Error('أداة claude مو مثبّتة'))
    // Instructions go through the trusted system channel (a file, to dodge command-line length limits); otherwise the account treats them as injected text.
    let sysFile = ''
    if (system) {
      sysFile = path.join(os.tmpdir(), 'trl-sys-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.txt')
      fs.writeFileSync(sysFile, system, 'utf8')
    }
    const cleanSys = (): void => {
      if (sysFile) fs.rm(sysFile, { force: true }, () => undefined)
    }
    const child = spawn(exe, ['-p', ...(model ? ['--model', model] : []), ...(effort && effort !== 'auto' ? ['--effort', effort] : []), ...(sysFile ? ['--append-system-prompt-file', sysFile] : []), '--strict-mcp-config', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--disable-slash-commands'], {
      cwd: os.tmpdir(),
      env: cleanEnv(acct),
      windowsHide: true
    })
    let out = ''
    let err = ''
    let done = false
    const kill = (): void => {
      try {
        if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        else child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      cleanSys()
      fn()
    }
    const onAbort = (): void => {
      kill()
      finish(() => reject(new Error('انلغى')))
    }
    const timer = setTimeout(() => {
      kill()
      finish(() => reject(new Error('انتهت المهلة')))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (d) => (out += d.toString('utf8')))
    child.stderr.on('data', (d) => (err += d.toString('utf8')))
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) =>
      finish(() => {
        let text = out.trim()
        let used: string | undefined
        try {
          const j = JSON.parse(text)
          if (j && typeof j.result === 'string') {
            if (j.is_error) {
              const m = j.result.replace(/\s+/g, ' ').slice(0, 160)
              return reject(new Error('claude: ' + m))
            }
            text = j.result.trim()
            used = Object.keys(j.modelUsage ?? {})[0]
          }
        } catch {
          /* plain text */
        }
        if (code === 0 && text) return resolve({ text, model: used })
        const msg = (err || out).trim().replace(/\s+/g, ' ').slice(0, 160)
        reject(new Error(msg ? 'claude: ' + msg : 'claude خرج برمز ' + code))
      })
    )
    child.stdin.on('error', () => undefined)
    child.stdin.end(prompt, 'utf8')
  })
}