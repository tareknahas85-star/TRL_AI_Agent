import { spawn, execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { findOnPath, isWin } from './platform'

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
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

export function claudeCliStatus(): Promise<{ installed: boolean; loggedIn: boolean; email?: string; plan?: string }> {
  return new Promise((resolve) => {
    const exe = claudeCliPath()
    if (!exe) return resolve({ installed: false, loggedIn: false })
    execFile(exe, ['auth', 'status'], { timeout: 20000, windowsHide: true, env: cleanEnv(), cwd: os.tmpdir() }, (_e, out) => {
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
export function runClaudeCli(prompt: string, signal?: AbortSignal, model?: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const exe = claudeCliPath()
    if (!exe) return reject(new Error('أداة claude مو مثبّتة'))
    const child = spawn(exe, ['-p', ...(model ? ['--model', model] : []), '--tools', '', '--no-session-persistence', '--output-format', 'text', '--disable-slash-commands'], {
      cwd: os.tmpdir(),
      env: cleanEnv(),
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
        const text = out.trim()
        if (code === 0 && text) return resolve(text)
        const msg = (err || out).trim().replace(/\s+/g, ' ').slice(0, 160)
        reject(new Error(msg ? 'claude: ' + msg : 'claude خرج برمز ' + code))
      })
    )
    child.stdin.on('error', () => undefined)
    child.stdin.end(prompt, 'utf8')
  })
}