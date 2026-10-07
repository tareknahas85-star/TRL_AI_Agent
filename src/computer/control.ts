import { rp } from './pathbase'
import { spawn } from 'child_process'
import { app, BrowserWindow, dialog } from 'electron'
import fsp from 'fs/promises'
import fs from 'fs'
import path from 'path'
import type OpenAI from 'openai'
import { BUILD_ENV_PS } from './build-env'
import { addOfficeTools } from './office'
import { isUnattended } from '../core/progress'
import { findOnPath } from '../core/platform'

// ---------- config (master switch, default OFF) ----------
const cfgFile = (): string => path.join(app.getPath('userData'), 'computer.json')
let sessionAllowAll = false

type Cfg = { enabled?: boolean; autoApprove?: boolean; fullAccess?: boolean }
function readCfg(): Cfg {
  try {
    return JSON.parse(fs.readFileSync(cfgFile(), 'utf-8'))
  } catch {
    return {}
  }
}
function writeCfg(p: Cfg): void {
  fs.writeFileSync(cfgFile(), JSON.stringify({ ...readCfg(), ...p }))
}
// Default ON: the user wants the program to act without asking every time. The BLOCKED list still applies.
export const autoApproveOn = (): boolean => readCfg().autoApprove !== false
export function setAutoApprove(on: boolean): void {
  writeCfg({ autoApprove: !!on })
}

// Computer Control: Windows (PowerShell, plus screen control) and Linux (bash + files + Office, no screen control).
const isLinux = process.platform === 'linux'
const PC_SUPPORTED = process.platform === 'win32' || isLinux
// Full Access: everything runs without per-action prompts; only destructive commands still need an explicit confirmation click.
export const fullAccessOn = (): boolean => PC_SUPPORTED && readCfg().fullAccess === true
export function setFullAccess(on: boolean): void {
  if (!PC_SUPPORTED) return
  // Turning Full Access on also switches Computer Control on (it is useless without it).
  writeCfg(on ? { fullAccess: true, enabled: true } : { fullAccess: false })
}

export function computerEnabled(): boolean {
  if (!PC_SUPPORTED) return false
  try {
    return JSON.parse(fs.readFileSync(cfgFile(), 'utf-8')).enabled === true
  } catch {
    return false
  }
}
export function setComputerEnabled(on: boolean): void {
  if (!PC_SUPPORTED) return
  writeCfg({ enabled: !!on })
  if (!on) sessionAllowAll = false
}
export function computerState(): { enabled: boolean; sessionAllowed: boolean; autoApprove: boolean; fullAccess: boolean } {
  return { enabled: computerEnabled(), sessionAllowed: sessionAllowAll, autoApprove: autoApproveOn(), fullAccess: fullAccessOn() }
}
export function resetComputerSession(): void {
  sessionAllowAll = false
}

// ---------- safety ----------
// Never executed, even with approval. The user must do these himself.
const BLOCKED =
  /(remove-item|\brm\b|\bdel\b|\berase\b|\brmdir\b|\brd\b|format-volume|\bformat\s+[a-z]:|clear-disk|diskpart|reg(\.exe)?\s+delete|remove-itemproperty|stop-computer|restart-computer|\bshutdown\b|set-executionpolicy|bcdedit|net\s+user|net\s+localgroup|disable-|uninstall|cipher\s+\/w|vssadmin|wevtutil\s+cl|remove-|clear-eventlog|start-process[^|;]*-verb\s+runas|invoke-expression|\biex\b|downloadstring|downloadfile|invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b|curl|wget)/i
const SAFE_CMD =
  /^\s*(get-[\w-]+|test-path|select-string|measure-object|hostname|whoami|dir|ls|pwd|echo|write-output|type|cat|systeminfo|ipconfig|tasklist|netstat|where\.exe|resolve-path|\$psversiontable|select-object|where-object|sort-object|format-[\w-]+|out-string|group-object)\b/i

function isReadOnly(cmd: string): boolean {
  if (/[;>`&]|\$\(|\bstart-|\bset-|\bnew-|\binvoke-|\bout-file\b/i.test(cmd)) return false
  return cmd.split('|').every((seg) => SAFE_CMD.test(seg))
}

// Even in Full Access these need a real confirmation click every time.
const DESTRUCTIVE =
  /(remove-item|\brm\b|\bdel\b|\berase\b|\brmdir\b|\brd\b|format-volume|\bformat\s+[a-z]:|clear-disk|diskpart|reg(\.exe)?\s+delete|remove-itemproperty|bcdedit|net\s+user|net\s+localgroup|uninstall|cipher\s+\/w|vssadmin|wevtutil\s+cl|clear-eventlog|\bremove-)/i

const WIN_BLOCK = /(user account control|windows security|credential|windows hello|sign in to|password|uac)/i

async function confirmAlways(title: string, detail: string): Promise<boolean> {
  if (isUnattended()) return false // nobody is there to confirm
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts = {
    type: 'warning' as const,
    title: 'تأكيد مطلوب (أمر خطير)',
    message: title,
    detail: detail.slice(0, 1500),
    buttons: ['إلغاء', 'تأكيد التنفيذ'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return r.response === 1
}

async function ask(title: string, detail: string): Promise<boolean> {
  if (sessionAllowAll || autoApproveOn() || fullAccessOn()) return true
  if (isUnattended()) return false // scheduled run: nobody is there to click
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts = {
    type: 'warning' as const,
    title: 'التحكم بالجهاز - طلب موافقة',
    message: title,
    detail: detail.slice(0, 1500),
    buttons: ['سماح مرة واحدة', 'سماح لكل هالجلسة', 'رفض'],
    defaultId: 2,
    cancelId: 2,
    noLink: true
  }
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (r.response === 1) sessionAllowAll = true
  return r.response === 0 || r.response === 1
}

// ---------- powershell runner ----------
function runPs(script: string, args: unknown = {}, timeoutMs = 60000, signal?: AbortSignal): Promise<string> {
  const b64 = Buffer.from(JSON.stringify(args), 'utf-8').toString('base64')
  const full =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; " +
    `$A=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))|ConvertFrom-Json; ` +
    script
  const enc = Buffer.from(full, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], {
      windowsHide: true
    })
    let out = ''
    let err = ''
    let done = false
    const finish = (s: string): void => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(s)
    }
    const t = setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
      finish((out + '\n[timeout after ' + timeoutMs / 1000 + 's]').trim())
    }, timeoutMs)
    signal?.addEventListener('abort', () => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
      finish('[cancelled]')
    })
    p.stdout.on('data', (d) => (out += d.toString('utf-8')))
    p.stderr.on('data', (d) => (err += d.toString('utf-8')))
    // A child it started (e.g. the Gradle daemon) can keep the pipes open long after the command ended: finish on exit.
    p.on('exit', () => {
      setTimeout(() => {
        try {
          p.stdout.destroy()
          p.stderr.destroy()
        } catch {
          /* ignore */
        }
      }, 1500)
    })
    p.on('close', () => {
      const e = err.startsWith('#< CLIXML') ? '' : err.trim()
      finish((out.trim() + (e ? '\n[stderr] ' + e.slice(0, 1500) : '')).trim() || '(no output)')
    })
    p.on('error', (e) => finish('Error: ' + e.message))
  })
}

// ---------- Linux: bash runner + safety (files, commands, Office; no screen control) ----------
// Mirrors the Windows rules: BLOCKED never runs without Full Access; DESTRUCTIVE needs a real confirmation even with Full Access.
const DESTRUCTIVE_SH =
  /(\brm\b|\brmdir\b|\bunlink\b|\bshred\b|\bmkfs|\bwipefs\b|\bfdisk\b|\bparted\b|\bdd\b[^|;]*\bof=|\bsudo\b|\bsu\b|\bpkexec\b|\bdoas\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b|systemctl\s+(poweroff|reboot|halt|suspend|hibernate|kexec)|\bcrontab\s+-r|\bapt(-get)?\s+(remove|purge|autoremove)|\bsnap\s+remove|\bflatpak\s+uninstall|\bchmod\s+-R|\bchown\s+-R|\bgit\s+clean|find\b[^|;]*(-delete\b|-exec\s+rm\b)|>\s*\/dev\/(sd|nvme|mmcblk)|:\(\)\s*\{)/i
const BLOCKED_SH = new RegExp(DESTRUCTIVE_SH.source + '|\\bcurl\\b|\\bwget\\b|\\baria2c\\b|\\beval\\b|\\bcrontab\\b', 'i')
const SAFE_SH =
  /^\s*(ls|cat|pwd|echo|whoami|hostname|uname|df|du|ps|head|tail|wc|grep|rg|find|stat|file|which|type|date|id|uptime|free|lscpu|lsblk|realpath|readlink|basename|dirname|sort|uniq|cut|tr|git\s+(status|log|diff|branch|show|remote)|node\s+(-v|--version)|npm\s+(-v|--version)|python3?\s+(-V|--version))\b/
function isReadOnlySh(cmd: string): boolean {
  if (/[;>`&<]|\$\(|\bfind\b[^|]*-(exec|ok|delete|fprint)|\btee\b/.test(cmd)) return false
  return cmd.split('|').every((seg) => SAFE_SH.test(seg))
}

function runSh(script: string, cwd: string, timeoutMs = 60000, signal?: AbortSignal): Promise<string> {
  if (cwd && !fs.existsSync(cwd)) return Promise.resolve('Error: folder not found: ' + cwd)
  return new Promise((resolve) => {
    const p = spawn('bash', ['-lc', script], { cwd: cwd || undefined, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let done = false
    const killGroup = (): void => {
      try {
        if (p.pid) process.kill(-p.pid, 'SIGKILL')
      } catch {
        try {
          p.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }
    const finish = (s: string): void => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(s)
    }
    const t = setTimeout(() => {
      killGroup()
      finish((out + '\n[timeout after ' + timeoutMs / 1000 + 's]').trim())
    }, timeoutMs)
    signal?.addEventListener('abort', () => {
      killGroup()
      finish('[cancelled]')
    })
    p.stdout?.on('data', (d) => (out += d.toString('utf-8')))
    p.stderr?.on('data', (d) => (err += d.toString('utf-8')))
    // A child it started can keep the pipes open long after the command ended: finish on exit.
    p.on('exit', () => {
      setTimeout(() => {
        try {
          p.stdout?.destroy()
          p.stderr?.destroy()
        } catch {
          /* ignore */
        }
      }, 1500)
    })
    p.on('close', (code) => {
      const e = err.trim()
      const tail = code ? `\n[exit code ${code}]` : ''
      finish((out.trim() + (e ? '\n[stderr] ' + e.slice(0, 1500) : '') + tail).trim() || '(no output)')
    })
    p.on('error', (e) => finish('Error: ' + e.message))
  })
}

// pc_open on Linux: http(s) URL or an existing file/folder -> xdg-open; a bare application name on PATH -> started detached.
function openOnLinux(t: string): Promise<string> {
  const isUrl = /^https?:\/\//i.test(t)
  const target = isUrl ? t : rp(t)
  let cmd = 'xdg-open'
  let args = [target]
  if (!isUrl && !fs.existsSync(target)) {
    const exe = /\s/.test(t) ? null : findOnPath(t)
    if (!exe) return Promise.resolve('Error: pass an http(s) URL, an existing file/folder path, or a bare application name that is installed (no arguments).')
    cmd = exe
    args = []
  }
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    c.once('error', (e) => resolve('Error: ' + e.message))
    c.once('spawn', () => {
      c.unref()
      resolve('OK: opened')
    })
  })
}

const WIN32 = `
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, int e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
}
"@
[void][W32]::SetProcessDPIAware()
function Combo($mods,$vk){ foreach($m in $mods){[W32]::keybd_event($m,0,0,0)}; [W32]::keybd_event($vk,0,0,0); Start-Sleep -Milliseconds 30; [W32]::keybd_event($vk,0,2,0); foreach($m in $mods){[W32]::keybd_event($m,0,2,0)} }
function FgInfo { $h=[W32]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512; [void][W32]::GetWindowText($h,$sb,512); $pid2=0; [void][W32]::GetWindowThreadProcessId($h,[ref]$pid2); $pn=(Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName; return @{title=$sb.ToString();proc=$pn;hwnd=$h} }
`

async function foreground(): Promise<{ title: string; proc: string }> {
  const r = await runPs(WIN32 + '$f=FgInfo; @{title=$f.title;proc=$f.proc}|ConvertTo-Json -Compress', {}, 15000)
  try {
    return JSON.parse(r)
  } catch {
    return { title: '', proc: '' }
  }
}
async function guardForeground(): Promise<string | null> {
  const f = await foreground()
  if (/^(consent|credentialuibroker|logonui|winlogon|securityhealth)/i.test(f.proc) || WIN_BLOCK.test(f.title))
    return `blocked: the foreground window ("${f.title}", ${f.proc}) is a security/credential prompt. Ask the user to handle it himself.`
  return null
}

const UIA = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
function GetEls($needle) {
  $f=FgInfo
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($f.hwnd)
  $types='Button','Edit','MenuItem','CheckBox','ComboBox','Hyperlink','TabItem','ListItem','RadioButton','Text','Document'
  $conds=@(); foreach($t in $types){ $conds+= New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::($t)) }
  $or=New-Object System.Windows.Automation.OrCondition($conds)
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$or)
  $res=@()
  foreach($e in $all){
    if($res.Count -ge 90){break}
    try{
      $c=$e.Current; if($c.IsOffscreen){continue}
      $r=$c.BoundingRectangle; if($r.Width -le 0 -or $r.Height -le 0 -or [double]::IsInfinity($r.X)){continue}
      $n=[string]$c.Name; $t=$c.ControlType.ProgrammaticName -replace 'ControlType\\.',''
      if($t -eq 'Text' -and $n.Length -lt 2){continue}
      $v=''
      if($t -eq 'Edit' -or $t -eq 'Document'){ try{ $vp=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $v=[string]$vp.Current.Value }catch{ try{ $tp=$e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern); $v=[string]$tp.DocumentRange.GetText(300) }catch{} } }
      if($needle -and ($n -notlike ('*'+$needle+'*')) -and ($v -notlike ('*'+$needle+'*'))){continue}
      $res+=[pscustomobject]@{type=$t;name=($n.Substring(0,[Math]::Min(80,$n.Length)));value=($v.Substring(0,[Math]::Min(120,$v.Length)));x=[int]($r.X+$r.Width/2);y=[int]($r.Y+$r.Height/2)}
    }catch{}
  }
  return @{title=$f.title;proc=$f.proc;items=$res}
}
`

// ---------- tool definitions ----------
type Handler = (a: Record<string, unknown>) => Promise<string>
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function addComputerTools(
  defs: OpenAI.Chat.ChatCompletionTool[],
  handlers: Map<string, Handler>,
  getSignal?: () => AbortSignal | undefined
): void {
  const def = (name: string, description: string, props: Record<string, unknown>, required: string[], h: Handler): void => {
    defs.push({ type: 'function', function: { name, description, parameters: { type: 'object', properties: props, required } } })
    handlers.set(name, h)
  }
  const str = { type: 'string' }
  const num = { type: 'number' }

  if (isLinux)
    def(
      'pc_run',
      "Run a bash command on the user's Linux computer and return its output (the END of the output is kept when it is long). Optional cwd = working folder (default: the active project folder); optional timeout_seconds (default 120, max 1800) - use a big value for builds/installs. Destructive commands (rm, sudo, shutdown...) and downloads (curl/wget) are blocked unless Full Access is on. There is no screen control on Linux: work with commands, files and the office_* tools.",
      { command: str, cwd: str, timeout_seconds: num },
      ['command'],
      async (a) => {
        const cmd = s(a.command).trim()
        if (!cmd) return 'Error: empty command'
        if (fullAccessOn()) {
          if (DESTRUCTIVE_SH.test(cmd) && !(await confirmAlways('أمر مدمّر (حذف/فرمتة/sudo/إطفاء)', (a.cwd ? '[' + s(a.cwd) + '] ' : '') + cmd)))
            return 'Error: this destructive command was not confirmed by the user.'
        } else if (BLOCKED_SH.test(cmd)) return 'Error: blocked by safety policy (delete/sudo/shutdown/download). Ask the user to turn on Full Access in Settings or do it himself.'
        if (!isReadOnlySh(cmd) && !(await ask('بدو ينفذ أمر bash', (a.cwd ? '[' + s(a.cwd) + '] ' : '') + cmd))) return 'Error: the user denied this command.'
        const secs = Math.min(1800, Math.max(60, Number(a.timeout_seconds) || 120))
        const out = await runSh(cmd, a.cwd ? rp(s(a.cwd)) : rp('.'), secs * 1000, getSignal?.())
        return out.length > 5500 ? '…[start of output cut]\n' + out.slice(-5500) : out
      }
    )
  if (!isLinux)
  def(
    'pc_run',
    "Run a PowerShell command on the user's Windows computer and return its output (the END of the output is kept when it is long). Optional cwd = working folder; optional timeout_seconds (default 120, max 1800) - use a big value for builds. JAVA_HOME / ANDROID_HOME are set up automatically, and 'gradlew assembleDebug' works even when the project has no wrapper (it falls back to the Gradle installed on this machine and steps into a nested Gradle folder). Read-only commands (Get-*, dir, ...) run directly; anything else asks the user for approval. " + (fullAccessOn() ? "FULL ACCESS is ON: every command runs (terminal, installs, downloads, services, registry), except destructive ones (delete/format/registry delete/user changes) which pop a confirmation the user must click. Use pc_power for shutdown/restart/sleep/lock." : "Deleting files, shutdown, registry deletion and downloads are blocked here (use pc_power for shutdown/restart/sleep/lock, it asks the user).") + "",
    { command: str, cwd: str, timeout_seconds: num },
    ['command'],
    async (a) => {
      let cmd = s(a.command).trim()
      if (!cmd) return 'Error: empty command'
      if (fullAccessOn()) {
        if (DESTRUCTIVE.test(cmd) && !(await confirmAlways('أمر مدمّر (حذف/فرمتة/ريجستري/مستخدمين)', (a.cwd ? '[' + s(a.cwd) + '] ' : '') + cmd)))
          return 'Error: this destructive command was not confirmed by the user.'
      } else if (BLOCKED.test(cmd)) return 'Error: blocked by safety policy (delete/shutdown/download/policy changes). For shutdown/restart/sleep use pc_power. Otherwise ask the user to turn on Full Access in Settings or do it himself.'
      if (!isReadOnly(cmd) && !(await ask('بدو ينفذ أمر PowerShell', (a.cwd ? '[' + s(a.cwd) + '] ' : '') + cmd))) return 'Error: the user denied this command.'
      cmd = cmd.replace(/(?<![\w.-])(?:\.[\\/])?gradlew(?:\.bat)?(?![\w-])/gi, '__gw')
      const secs = Math.min(1800, Math.max(60, Number(a.timeout_seconds) || 120))
      const out = await runPs(BUILD_ENV_PS + "\nif($A.cwd){ Set-Location -LiteralPath $A.cwd }\n" + cmd, { cwd: s(a.cwd) }, secs * 1000, getSignal?.())
      return out.length > 5500 ? '…[start of output cut]\n' + out.slice(-5500) : out
    }
  )
  def('pc_list_dir', 'List files and folders of a directory on the computer (absolute path).', { path: str }, ['path'], async (a) => {
    try {
      const items = await fsp.readdir(rp(s(a.path)), { withFileTypes: true })
      return (
        items
          .slice(0, 300)
          .map((d) => (d.isDirectory() ? '[dir] ' : '      ') + d.name)
          .join('\n') || '(empty)'
      )
    } catch (e) {
      return 'Error: ' + (e instanceof Error ? e.message : String(e))
    }
  })
  def('pc_read_file', 'Read a text file from the computer (absolute path, max ~40KB shown).', { path: str }, ['path'], async (a) => {
    const p = rp(s(a.path))
    if (/\.(ppk|pem|key|pfx|kdbx)$/i.test(p) || /secure-keys|\.ssh|\.env$|credentials/i.test(p))
      return 'Error: reading credential/secret files is blocked.'
    try {
      const st = await fsp.stat(p)
      if (st.size > 2_000_000) return 'Error: file too large'
      const t = await fsp.readFile(p, 'utf-8')
      return t.length > 40000 ? t.slice(0, 40000) + '\n…[truncated]' : t
    } catch (e) {
      return 'Error: ' + (e instanceof Error ? e.message : String(e))
    }
  })
  def(
    'pc_write_file',
    'Create a text file on the computer (absolute path). To change an EXISTING file pass overwrite:true (a timestamped .bak copy is made first). For Word/Excel/PowerPoint use the office_* tools instead.',
    { path: str, content: str, overwrite: { type: 'boolean' } },
    ['path', 'content'],
    async (a) => {
      const p = rp(s(a.path))
      const exists = fs.existsSync(p)
      if (exists && a.overwrite !== true) return 'Error: file already exists. Pass overwrite:true to replace it (a backup copy is made) or choose a new name.'
      if (!(await ask('بدو يعمل ملف', p + '\n\n' + s(a.content).slice(0, 600)))) return 'Error: the user denied this.'
      try {
        await fsp.mkdir(path.dirname(p), { recursive: true })
        let bak = ''
        if (exists) {
          const d = new Date()
          bak = p + '.bak-' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
          await fsp.copyFile(p, bak)
        }
        await fsp.writeFile(p, s(a.content), { encoding: 'utf-8' })
        return 'OK: ' + (exists ? 'updated ' : 'created ') + p + (bak ? ' (backup: ' + bak + ')' : '')
      } catch (e) {
        return 'Error: ' + (e instanceof Error ? e.message : String(e))
      }
    }
  )
  if (!isLinux)
  def(
    'pc_power',
    'Power actions on the computer: action = shutdown | restart | sleep | hibernate | lock | logoff | cancel. shutdown/restart wait delay_seconds (default 30, 0-600) so it can be aborted with action "cancel". Asks the user to confirm unless Full Access is on.',
    { action: str, delay_seconds: num },
    ['action'],
    async (a) => {
      const act = s(a.action).toLowerCase().trim()
      const delay = Math.min(600, Math.max(0, a.delay_seconds === undefined ? 30 : Number(a.delay_seconds) || 0))
      const cmds: Record<string, string> = {
        shutdown: `shutdown /s /t ${delay}`,
        restart: `shutdown /r /t ${delay}`,
        logoff: 'shutdown /l',
        hibernate: 'shutdown /h',
        sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
        lock: 'rundll32.exe user32.dll,LockWorkStation',
        cancel: 'shutdown /a'
      }
      const cmd = cmds[act]
      if (!cmd) return 'Error: unknown action. Use shutdown, restart, sleep, hibernate, lock, logoff or cancel.'
      if (act !== 'cancel' && act !== 'lock' && !fullAccessOn() && !(await confirmAlways('بدو ينفذ إجراء طاقة: ' + act, cmd))) return 'Error: the user did not confirm this power action.'
      const out = await runPs(cmd + "; 'OK: ' + $A.act + ' requested'", { act }, 20000)
      return out + (act === 'shutdown' || act === 'restart' ? ` (starts in ${delay}s; call pc_power with action "cancel" to abort)` : '')
    }
  )
  addOfficeTools({ def, ask, runPs, getSignal })
  if (!isLinux)
  def('pc_windows', 'List the open windows (title + process).', {}, [], async () =>
    runPs(
      'Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -First 40 ProcessName,Id,MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200',
      {},
      20000
    )
  )
  def('pc_open', 'Open an application, file or http(s) URL (e.g. "notepad", "calc", "https://example.com"). Asks for approval.', { target: str }, ['target'], async (a) => {
    const t = s(a.target).trim()
    if (isLinux && !fullAccessOn() && (/[;&|`]|\.(sh|desktop|appimage|deb|run|py|js)$/i.test(t) || /^(bash|sh|zsh|fish|dash|sudo|su|xterm|gnome-terminal|konsole|x-terminal-emulator|terminator|kitty|alacritty|tilix)$/i.test(t)))
      return 'Error: this target is not allowed (terminals/scripts are blocked).'
    if (!t || (!fullAccessOn() && (/[;&|`]|\.(bat|cmd|ps1|vbs|js|msi|reg|scr)$/i.test(t) || /^(powershell|pwsh|cmd|wt|windowsterminal|regedit|mmc)(\.exe)?$/i.test(t))))
      return 'Error: this target is not allowed (terminals/scripts are blocked).'
    if (/\.(wav|mp3|mp4|m4a|avi|mkv|mov|webm|ogg|flac)$/i.test(t))
      return 'Error: media files are not opened automatically (it pops a player/app chooser on the user PC). Just tell the user the file path.'
    if (!(await ask('بدو يفتح', t))) return 'Error: the user denied this.'
    if (isLinux) return openOnLinux(t)
    return runPs('Start-Process -FilePath $A.t; "OK: opened"', { t }, 20000)
  })
  // Linux: no screen control (UI Automation, mouse/keyboard, screenshots are Windows-only). Everything below is Windows.
  if (isLinux) return
  def('pc_focus', 'Bring a window to the foreground by part of its title.', { title: str }, ['title'], async (a) => {
    if (!(await ask('بدو يعمل تركيز على نافذة', s(a.title)))) return 'Error: the user denied this.'
    return runPs(
      WIN32 +
        "$p=Get-Process | Where-Object {$_.MainWindowTitle -like ('*'+$A.title+'*')} | Select-Object -First 1; if(-not $p){'Error: window not found'} else {[void][W32]::ShowWindow($p.MainWindowHandle,9); [void][W32]::SetForegroundWindow($p.MainWindowHandle); 'OK: focused '+$p.MainWindowTitle}",
      { title: s(a.title) },
      20000
    )
  })
  def(
    'pc_ui_snapshot',
    'Describe the foreground window as a list of visible UI elements (type, name, x, y center). Use it to decide where to click. Optional "find" filters by name.',
    { find: str },
    [],
    async (a) => {
      const g = await guardForeground()
      if (g) return g
      const r = await runPs(WIN32 + UIA + '$o=GetEls $A.find; $o|ConvertTo-Json -Depth 4 -Compress', { find: s(a.find) }, 45000, getSignal?.())
      try {
        const o = JSON.parse(r)
        const items = (Array.isArray(o.items) ? o.items : o.items ? [o.items] : []) as { type: string; name: string; value?: string; x: number; y: number }[]
        return `Window: ${o.title} (${o.proc})\n` + items.map((i) => `${i.type} | ${i.name}${i.value ? ' | value: ' + i.value : ''} | (${i.x},${i.y})`).join('\n')
      } catch {
        return r
      }
    }
  )
  def(
    'pc_click',
    'Click at screen coordinates (x,y) OR on a UI element of the foreground window by (part of) its name. Set double=true for double click, right=true for right click.',
    { x: num, y: num, name: str, double: { type: 'boolean' }, right: { type: 'boolean' } },
    [],
    async (a) => {
      const g = await guardForeground()
      if (g) return g
      if (!(await ask('بدو يدوس بالماوس', a.name ? `على العنصر: ${s(a.name)}` : `على الإحداثيات (${s(a.x)}, ${s(a.y)})`)))
        return 'Error: the user denied this.'
      return runPs(
        WIN32 +
          UIA +
          `$x=$A.x; $y=$A.y
if($A.name){ $o=GetEls $A.name; $it=@($o.items)[0]; if(-not $it){ 'Error: element not found: '+$A.name; return }; $x=$it.x; $y=$it.y }
if($x -eq $null -or $y -eq $null){ 'Error: give x,y or name'; return }
[void][W32]::SetCursorPos([int]$x,[int]$y); Start-Sleep -Milliseconds 80
$d=0x0002;$u=0x0004; if($A.right){$d=0x0008;$u=0x0010}
$n=1; if($A.double){$n=2}
for($i=0;$i -lt $n;$i++){ [W32]::mouse_event($d,0,0,0,0); [W32]::mouse_event($u,0,0,0,0); Start-Sleep -Milliseconds 60 }
'OK: clicked at '+$x+','+$y`,
        { x: a.x ?? null, y: a.y ?? null, name: s(a.name), double: !!a.double, right: !!a.right },
        45000,
        getSignal?.()
      )
    }
  )
  def('pc_type', 'Type text into the focused field (supports Arabic/Unicode via paste).', { text: str }, ['text'], async (a) => {
    const g = await guardForeground()
    if (g) return g
    if (!(await ask('بدو يكتب نص', s(a.text).slice(0, 500)))) return 'Error: the user denied this.'
    return runPs(
      WIN32 +
        "$old=$null; try{$old=Get-Clipboard -Raw}catch{}; Set-Clipboard -Value $A.text; Start-Sleep -Milliseconds 100; Combo @(0x11) 0x56; Start-Sleep -Milliseconds 300; if($old -ne $null){Set-Clipboard -Value $old}; 'OK: typed'",
      { text: s(a.text) },
      20000
    )
  })
  def(
    'pc_keys',
    'Send a key combination using SendKeys syntax, e.g. "{ENTER}", "^s" (Ctrl+S), "%{TAB}" (Alt+Tab), "{DOWN}", "^a".',
    { keys: str },
    ['keys'],
    async (a) => {
      const k = s(a.keys)
      if (!fullAccessOn() && /%\{F4\}|\^\+\{ESC\}|\^%\{DEL\}|\+\{DEL\}/i.test(k)) return 'Error: this key combination is blocked.'
      const g = await guardForeground()
      if (g) return g
      if (!(await ask('بدو يبعت اختصار لوحة مفاتيح', k))) return 'Error: the user denied this.'
      return runPs(
        WIN32 +
          "Add-Type -AssemblyName System.Windows.Forms; if($A.k -match '^([\^%+]+)([A-Za-z0-9])$'){ $mods=@(); if($Matches[1].Contains('^')){$mods+=0x11}; if($Matches[1].Contains('%')){$mods+=0x12}; if($Matches[1].Contains('+')){$mods+=0x10}; Combo $mods ([int][char]$Matches[2].ToUpper()) } else { [System.Windows.Forms.SendKeys]::SendWait($A.k) }; 'OK: sent'",
        { k },
        20000
      )
    }
  )
  def('pc_scroll', 'Scroll the mouse wheel at the current position. amount>0 scrolls up, <0 scrolls down (in notches).', { amount: num }, ['amount'], async (a) => {
    const g = await guardForeground()
    if (g) return g
    if (!(await ask('بدو يعمل سكرول', s(a.amount)))) return 'Error: the user denied this.'
    return runPs(WIN32 + "[W32]::mouse_event(0x0800,0,0,[int]([double]$A.n*120),0); 'OK: scrolled'", { n: Number(a.amount) || 0 }, 15000)
  })
  def(
    'pc_screenshot',
    'Save a screenshot of the screen to a PNG file and return its path and size (text-only models cannot see it; use pc_ui_snapshot to read the screen).',
    {},
    [],
    async () => {
      const dir = path.join(app.getPath('userData'), 'screens')
      await fsp.mkdir(dir, { recursive: true })
      const file = path.join(dir, `shot-${Date.now()}.png`)
      return runPs(
        WIN32 +
          "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $bmp.Save($A.f,[System.Drawing.Imaging.ImageFormat]::Png); 'OK: '+$A.f+' ('+$b.Width+'x'+$b.Height+')'",
        { f: file },
        30000
      )
    }
  )
}
