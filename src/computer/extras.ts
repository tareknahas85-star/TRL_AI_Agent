// Tools-first layer: automatic result verification, background jobs, guarded USB flashing, per-project lessons.
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { app } from 'electron'
import { rp } from './pathbase'

type Handler = (a: Record<string, unknown>) => Promise<string>
type Def = (
  name: string,
  description: string,
  props: Record<string, unknown>,
  required: string[],
  h: Handler
) => void
type RunPs = (
  script: string,
  args?: unknown,
  timeoutMs?: number,
  signal?: AbortSignal
) => Promise<string>

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ---------- 1) automatic verification after a tool ran ----------
const READISH =
  /(read|list|get|search|find|windows|screenshot|focus|scroll|type|status|log|lessons|open)/i

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** Returns a short verification note appended to the tool result ('' when nothing to check). Never throws. */
export async function verifyAfter(
  name: string,
  a: Record<string, unknown>,
  out: string
): Promise<string> {
  try {
    if (!/^(pc_|office_)/.test(name)) return ''
    const t = out.trim()
    if (/^(Error|\[cancelled\]|\[timeout)/.test(t)) return ''
    const notes: string[] = []
    const p = s(a.path) || s(a.file) || s(a.output)
    if (name === 'pc_write_file' && /^OK:/.test(t) && p) {
      const fp = rp(p)
      try {
        const st = await fsp.stat(fp)
        const want = Buffer.byteLength(s(a.content))
        notes.push(
          st.size === want
            ? `✔ الملف موجود (${st.size} bytes) وحجمه مطابق`
            : `✖ الملف موجود لكن حجمه ${st.size} مو ${want} المتوقع`
        )
      } catch {
        notes.push('✖ الملف مو موجود بعد الكتابة')
      }
    } else if (
      /^office_/.test(name) &&
      !READISH.test(name) &&
      p &&
      /^(OK|created|saved)/i.test(t)
    ) {
      try {
        const st = await fsp.stat(rp(p))
        notes.push(st.size > 0 ? `✔ الملف موجود (${st.size} bytes)` : '✖ الملف موجود لكنه فاضي')
      } catch {
        notes.push('✖ الملف مو موجود بعد الحفظ')
      }
    }
    if (name === 'pc_run' || name === 'pc_open') {
      const seen = new Set<number>()
      for (const m of out.matchAll(/\bpid\s*[=:]?\s*(\d{2,7})\b/gi)) {
        const pid = Number(m[1])
        if (seen.has(pid) || seen.size >= 3) continue
        seen.add(pid)
        notes.push(
          pidAlive(pid)
            ? `✔ PID ${pid} شغّال فعلاً`
            : `✖ PID ${pid} مو موجود حالياً (إما خلص أو ما اشتغل أبداً) — لا تقل إنه شغّال`
        )
      }
    }
    return notes.length
      ? '\n[تحقق تلقائي من التطبيق: ' + notes.join(' | ') + ' — إذا في ✖ لا تقل للمستخدم إنو نجح]'
      : ''
  } catch {
    return ''
  }
}

// ---------- shared dirs ----------
const dataDir = (sub: string): string => {
  const d = path.join(app.getPath('userData'), sub)
  fs.mkdirSync(d, { recursive: true })
  return d
}

// ---------- 2) background jobs ----------
interface JobMeta {
  id: string
  name: string
  cmd: string
  cwd: string
  pid: number
  log: string
  exitFile: string
  started: number
}
const jobFile = (id: string): string => path.join(dataDir('jobs'), id + '.json')
const loadJob = (id: string): JobMeta | null => {
  try {
    return JSON.parse(fs.readFileSync(jobFile(id), 'utf8')) as JobMeta
  } catch {
    return null
  }
}
const allJobs = (): JobMeta[] => {
  try {
    return fs
      .readdirSync(dataDir('jobs'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => loadJob(f.slice(0, -5)))
      .filter((j): j is JobMeta => !!j)
      .sort((x, y) => y.started - x.started)
  } catch {
    return []
  }
}
function tailLines(file: string, n: number, grep?: string): string {
  let txt = ''
  try {
    const st = fs.statSync(file)
    const fd = fs.openSync(file, 'r')
    const len = Math.min(st.size, 200_000)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, st.size - len)
    fs.closeSync(fd)
    txt = buf.toString('utf8').replace(/^\uFEFF/, '')
  } catch {
    return '(no log yet)'
  }
  let lines = txt.split(/\r?\n/)
  if (grep) {
    try {
      const re = new RegExp(grep, 'i')
      lines = lines.filter((l) => re.test(l))
    } catch {
      lines = lines.filter((l) => l.includes(grep))
    }
  }
  const out = lines.slice(-Math.max(1, Math.min(500, n))).join('\n')
  return out || '(empty)'
}
function jobState(j: JobMeta): { running: boolean; exit: string } {
  let exit = ''
  try {
    exit = fs.readFileSync(j.exitFile, 'utf8').trim()
  } catch {
    /* still running or killed */
  }
  const running = exit === '' && pidAlive(j.pid)
  return {
    running,
    exit: exit !== '' ? exit : running ? '' : 'unknown (process gone, no exit code recorded)'
  }
}
const describeJob = (j: JobMeta): string => {
  const st = jobState(j)
  let size = 0
  try {
    size = fs.statSync(j.log).size
  } catch {
    /* none */
  }
  return `${j.id} "${j.name}" pid=${j.pid} ${st.running ? 'RUNNING' : 'FINISHED exit=' + st.exit} · started ${new Date(j.started).toISOString()} · log ${size} bytes`
}

const q = (x: string): string => "'" + x.replace(/'/g, "''") + "'"
// ---------- 3) guarded USB flash ----------
function flashScript(img: string, disk: number, full: boolean): string {
  return String.raw`$ErrorActionPreference = 'Stop'
$diskNum = ${String(disk)}
$img = ${q(img)}
$fullVerify = ${full ? '$true' : '$false'}
New-Item -ItemType Directory -Force C:\Temp | Out-Null
$log = 'C:\Temp\trl_flash.log'
function L($m){ $t = "$(Get-Date -Format s) $m"; Write-Host $t; try { Add-Content -Path $log -Value $t } catch {} }
function Sha($b){ [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)) }
function ReadDev([int64]$off,[int]$len){
  $n = [int]([math]::Ceiling($len/512.0)*512)
  $f = New-Object IO.FileStream("\\.\PhysicalDrive$diskNum",'Open','Read','ReadWrite')
  try { [void]$f.Seek($off,'Begin'); $b = New-Object byte[] $n; $got = 0
    while($got -lt $n){ $r = $f.Read($b,$got,$n-$got); if($r -le 0){ break }; $got += $r }
    if($n -ne $len){ $c = New-Object byte[] $len; [Array]::Copy($b,$c,[math]::Min($len,$got)); return ,$c }
    return ,$b } finally { $f.Close() }
}
function ReadImg([int64]$off,[int]$len){
  $f = [IO.File]::Open($img,'Open','Read','Read')
  try { [void]$f.Seek($off,'Begin'); $b = New-Object byte[] $len; $got = 0
    while($got -lt $len){ $r = $f.Read($b,$got,$len-$got); if($r -le 0){ break }; $got += $r }
    return ,$b } finally { $f.Close() }
}
function Check([int64[]]$offs,[int]$chunk){
  $bad = @()
  foreach($o in $offs){
    $len = [int][math]::Min($chunk, $imgLen - $o); if($len -le 0){ continue }
    if((Sha (ReadImg $o $len)) -ne (Sha (ReadDev $o $len))){ $bad += $o }
  }
  return $bad
}
function Offsets(){
  $mb = 1MB; $last = [int64]([math]::Floor(($imgLen-1)/$mb)*$mb)
  if($fullVerify){ $step = 4MB; $o = @(); for($x=0L; $x -lt $imgLen; $x += $step){ $o += $x }; return ,$o }
  $o = @(0L)
  for($i=1; $i -le 8; $i++){ $o += [int64]([math]::Floor(($imgLen*$i/9)/$mb)*$mb) }
  $o += $last
  return ,@($o | Sort-Object -Unique)
}
function WriteHead(){
  $n = [int][math]::Min(1MB, $imgLen); $b = ReadImg 0 $n
  $w = [int]([math]::Ceiling($n/512.0)*512); $pad = New-Object byte[] $w; [Array]::Copy($b,$pad,$n)
  $o = New-Object IO.FileStream("\\.\PhysicalDrive$diskNum",'Open','Write','ReadWrite')
  try { $o.Write($pad,0,$w); $o.Flush() } finally { $o.Close() }
}
try {
  $d = Get-Disk -Number $diskNum
  if($diskNum -eq 0 -or $d.IsSystem -or $d.IsBoot){ throw "Refusing: disk $diskNum is system/boot" }
  if($d.BusType -ne 'USB'){ throw "Refusing: disk $diskNum BusType=$($d.BusType) is not USB" }
  $imgLen = (Get-Item -LiteralPath $img).Length
  if($imgLen -le 0){ throw 'image is empty' }
  if($d.Size -lt $imgLen){ throw "Refusing: disk $($d.Size) bytes is smaller than image $imgLen bytes" }
  L "Target OK: disk $diskNum USB $([math]::Round($d.Size/1GB,1)) GB $($d.FriendlyName); image $imgLen bytes"
  try { Clear-Disk -Number $diskNum -RemoveData -RemoveOEM -Confirm:$false } catch { L "Clear-Disk note: $($_.Exception.Message)" }
  Start-Sleep 3
  $in = [IO.File]::Open($img,'Open','Read','Read')
  $out = New-Object IO.FileStream("\\.\PhysicalDrive$diskNum",'Open','Write','ReadWrite',1MB)
  $buf = New-Object byte[] (4MB); $total = 0L; $next = 0; $sw = [Diagnostics.Stopwatch]::StartNew()
  while(($n = $in.Read($buf,0,$buf.Length)) -gt 0){
    $w = [int]([math]::Ceiling($n/512.0)*512); if($w -gt $n){ [Array]::Clear($buf,$n,$w-$n) }
    $out.Write($buf,0,$w); $total += $n
    $pct = [int](100*$total/$imgLen); if($pct -ge $next){ L "progress $pct% ($([math]::Round($total/1MB)) MB)"; $next = $pct + 10 }
  }
  $out.Flush(); $out.Close(); $in.Close()
  L "WRITE DONE: $total bytes in $([int]$sw.Elapsed.TotalSeconds)s"
  Update-Disk -Number $diskNum -ErrorAction SilentlyContinue
  Start-Sleep 3
  $offs = Offsets
  $bad = @(Check $offs 1MB)
  $try = 0
  while($bad.Count -gt 0 -and $try -lt 3){
    if(-not ($bad -contains 0)){ break }
    $try++
    L "Verify mismatch at $($bad.Count) chunk(s) (first offset $($bad[0])); Windows may have rewritten sectors - restoring head, attempt $try"
    if($bad -contains 0){ WriteHead; Start-Sleep 2 }
    $bad = @(Check $offs 1MB)
  }
  if($bad.Count -gt 0){ L "FLASH_RESULT: FAILED ($($bad.Count) chunk(s) differ, first offset $($bad[0]))"; exit 2 }
  L "FLASH_RESULT: VERIFIED ($($offs.Count) chunks of up to 1MB compared by SHA256; head and tail included; full=$fullVerify)"
  L ("Partitions: " + ((Get-Partition -DiskNumber $diskNum -ErrorAction SilentlyContinue | ForEach-Object { "$($_.PartitionNumber):$($_.Size)" }) -join ', '))
  exit 0
} catch { L "FLASH_RESULT: FAILED ($($_.Exception.Message))"; exit 2 }
`
}
// ---------- registration ----------
export interface ExtraDeps {
  def: Def
  runPs: RunPs
  /** same safety gate pc_run uses (disk guard, destructive/blocked patterns, approval). null = allowed. */
  gate: (cmd: string, cwd: string) => Promise<string | null>
  handlers: Map<string, Handler>
}

export function addExtraTools(d: ExtraDeps): void {
  const { def, runPs, gate, handlers } = d
  const str = { type: 'string' }
  const num = { type: 'number' }

  def(
    'pc_job_start',
    'Start a LONG command in the BACKGROUND (build, download, copy, server...). Returns at once with a job id + real PID. Use pc_job_status to see if it is still running / its exit code, and pc_job_log to read its output. Same safety rules as pc_run. Prefer this over pc_run for anything over ~1 minute.',
    { command: str, cwd: str, name: str },
    ['command'],
    async (a) => {
      if (process.platform !== 'win32') return 'Error: pc_job_start works on Windows only.'
      const cmd = s(a.command).trim()
      if (!cmd) return 'Error: empty command'
      const cwd = s(a.cwd).trim() ? rp(s(a.cwd)) : ''
      const gErr = await gate(cmd, cwd)
      if (gErr) return gErr
      const id = 'j' + Date.now().toString(36)
      const log = path.join(dataDir('jobs'), id + '.log')
      const exitFile = path.join(dataDir('jobs'), id + '.exit')
      const body =
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $c=0; " +
        (cwd ? 'Set-Location -LiteralPath ' + q(cwd) + '; ' : '') +
        'try { & { ' +
        cmd +
        '\n} *>&1 | Out-File -LiteralPath ' +
        q(log) +
        ' -Encoding utf8 -Append; if($LASTEXITCODE){$c=$LASTEXITCODE} } catch { Add-Content -LiteralPath ' +
        q(log) +
        ' -Value ("ERROR: " + $_.Exception.Message); $c=1 }; ' +
        'Set-Content -LiteralPath ' +
        q(exitFile) +
        ' -Value $c'
      const enc = Buffer.from(body, 'utf16le').toString('base64')
      fs.writeFileSync(log, '')
      let pid = 0
      try {
        const p = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
          {
            windowsHide: true,
            stdio: 'ignore'
          }
        )
        pid = p.pid ?? 0
        p.on('error', () => undefined)
        p.on('exit', (code) => {
          try {
            if (!fs.existsSync(exitFile)) fs.writeFileSync(exitFile, String(code ?? 1))
          } catch {
            /* ignore */
          }
        })
        p.unref()
      } catch (e) {
        return 'Error: could not start the job: ' + errMsg(e)
      }
      if (!pid) return 'Error: the job did not start (no PID).'
      const meta: JobMeta = {
        id,
        name: s(a.name).trim() || cmd.slice(0, 40),
        cmd,
        cwd,
        pid,
        log,
        exitFile,
        started: Date.now()
      }
      fs.writeFileSync(jobFile(id), JSON.stringify(meta))
      await new Promise((r) => setTimeout(r, 1500))
      return 'STARTED job ' + describeJob(meta) + '\nFirst output:\n' + tailLines(log, 8)
    }
  )
  def(
    'pc_job_status',
    'Status of background jobs: pass id for one job, or nothing to list the latest ones. Shows RUNNING/FINISHED + real exit code (checked against the live process).',
    { id: str },
    [],
    async (a) => {
      const id = s(a.id).trim()
      if (id) {
        const j = loadJob(id)
        return j
          ? describeJob(j) + '\nLast lines:\n' + tailLines(j.log, 6)
          : 'Error: unknown job id ' + id
      }
      const js = allJobs().slice(0, 15)
      return js.length ? js.map(describeJob).join('\n') : '(no background jobs yet)'
    }
  )
  def(
    'pc_job_log',
    'Read the output log of a background job: id, optional lines (default 60, max 500) and optional grep (regex) to filter.',
    { id: str, lines: num, grep: str },
    ['id'],
    async (a) => {
      const j = loadJob(s(a.id).trim())
      if (!j) return 'Error: unknown job id ' + s(a.id)
      return (
        describeJob(j) + '\n---\n' + tailLines(j.log, Number(a.lines) || 60, s(a.grep) || undefined)
      )
    }
  )
  def(
    'pc_job_stop',
    'Stop a background job (kills its whole process tree).',
    { id: str },
    ['id'],
    async (a) => {
      const j = loadJob(s(a.id).trim())
      if (!j) return 'Error: unknown job id ' + s(a.id)
      if (!jobState(j).running) return 'Job already finished: ' + describeJob(j)
      spawn('taskkill', ['/PID', String(j.pid), '/T', '/F'], { windowsHide: true }).on(
        'error',
        () => undefined
      )
      await new Promise((r) => setTimeout(r, 1500))
      return pidAlive(j.pid)
        ? '✖ the process is still alive after taskkill (pid ' + j.pid + ')'
        : '✔ stopped (pid ' + j.pid + ' is gone)'
    }
  )

  def(
    'pc_flash_usb',
    'Write a disk image (.iso/.img) to a USB disk SAFELY and VERIFY it: refuses disk 0 / system / boot / non-USB disks and disks smaller than the image; asks the user to confirm (UAC too); after writing it re-reads the head (first 1MB), the tail and 8 spread samples and compares SHA256 with the image, and automatically restores the head if Windows rewrote it (up to 3 times). full_verify:true compares the whole image (slow). The result says VERIFIED or NOT VERIFIED - report exactly that. Takes minutes: allow a big timeout_seconds.',
    { image_path: str, disk_number: num, full_verify: { type: 'boolean' }, timeout_seconds: num },
    ['image_path', 'disk_number'],
    async (a) => {
      if (process.platform !== 'win32') return 'Error: pc_flash_usb works on Windows only.'
      const n = Number(a.disk_number)
      if (!Number.isInteger(n) || n < 1)
        return 'Error: disk_number must be an integer >= 1 (disk 0 is never allowed).'
      const img = rp(s(a.image_path))
      let size = 0
      try {
        size = (await fsp.stat(img)).size
      } catch {
        return 'Error: image not found: ' + img
      }
      if (size <= 0) return 'Error: image is empty.'
      const raw = await runPs(
        'Get-Disk -Number $A.n | Select-Object Number,FriendlyName,BusType,Size,IsSystem,IsBoot | ConvertTo-Json -Compress',
        { n },
        20000
      )
      let dk: { BusType?: string; Size?: number; IsSystem?: boolean; IsBoot?: boolean } | null =
        null
      try {
        dk = JSON.parse(raw.slice(raw.indexOf('{')))
      } catch {
        dk = null
      }
      if (!dk)
        return 'Error: cannot read disk ' + n + ' (' + raw.slice(0, 200) + '). Nothing was written.'
      if (dk.IsSystem || dk.IsBoot)
        return 'Error: BLOCKED - disk ' + n + ' is the system/boot disk.'
      if (dk.BusType !== 'USB')
        return 'Error: BLOCKED - disk ' + n + ' is ' + (dk.BusType ?? 'unknown bus') + ', not USB.'
      if ((dk.Size ?? 0) < size)
        return (
          'Error: the image (' +
          size +
          ' bytes) is bigger than the disk (' +
          (dk.Size ?? 0) +
          ' bytes).'
        )
      const run = handlers.get('pc_run_admin')
      if (!run) return 'Error: pc_run_admin is not available.'
      const res = await run({
        command: flashScript(img, n, a.full_verify === true),
        timeout_seconds: Math.min(3600, Math.max(300, Number(a.timeout_seconds) || 1500))
      })
      const ok = /FLASH_RESULT: VERIFIED/.test(res) && /exit code: 0/.test(res)
      const bad = /FLASH_RESULT: FAILED/.test(res) || /exit code: [1-9]/.test(res)
      const head = ok
        ? '✔ VERIFIED — الكتابة انتهت والقراءة العكسية طابقت الصورة.'
        : bad
          ? '✖ NOT VERIFIED — الكتابة/التحقق فشل. لا تقل للمستخدم إنها نجحت.'
          : '⚠ UNKNOWN — ما في نتيجة تحقق واضحة (ممكن UAC انرفض أو انتهى الوقت). لا تقل إنها نجحت.'
      return head + '\n' + res
    }
  )

  def(
    'pc_lessons',
    'Per-project lessons file (mistakes made + what worked). action = read (do this at the START of real work on a project), add (after a failure or a useful discovery: one short line in "text"), list (all projects). project = project name or folder name.',
    { action: str, project: str, text: str },
    ['action'],
    async (a) => {
      const act = s(a.action).toLowerCase().trim()
      const dir = dataDir('lessons')
      const slug = s(a.project)
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}._-]+/gu, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60)
      if (act === 'list') {
        const names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
        return names.length ? names.map((f) => f.slice(0, -3)).join('\n') : '(no lessons saved yet)'
      }
      if (!slug) return 'Error: give project'
      const file = path.join(dir, slug + '.md')
      if (act === 'read') {
        try {
          return (await fsp.readFile(file, 'utf8')).slice(-6000) || '(empty)'
        } catch {
          return '(no lessons for this project yet)'
        }
      }
      if (act === 'add') {
        const text = s(a.text).replace(/\s+/g, ' ').trim().slice(0, 400)
        if (!text) return 'Error: give text'
        let cur = ''
        try {
          cur = await fsp.readFile(file, 'utf8')
        } catch {
          /* new file */
        }
        const lines = cur.split('\n').filter(Boolean)
        if (lines.some((l) => l.endsWith(': ' + text))) return 'OK: lesson already recorded.'
        const line = '- ' + new Date().toISOString().slice(0, 10) + ': ' + text
        lines.push(line)
        await fsp.writeFile(file, lines.slice(-80).join('\n') + '\n', 'utf8')
        const back = await fsp.readFile(file, 'utf8')
        return back.includes(line)
          ? '✔ lesson saved for ' + slug
          : '✖ could not confirm the lesson was saved'
      }
      return 'Error: action must be read, add or list.'
    }
  )
}
