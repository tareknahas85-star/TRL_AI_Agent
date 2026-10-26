// Direct image / video / audio generation (no language model in the loop) behind the three buttons.
// Walks the registry in priority order; a failed model falls through to the next one.
import { app, clipboard, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { getApiKey } from '../store/secure-store'
import { readJson, writeJson } from '../core/json-store'
import { freeOnly } from '../core/spend'
import { activeProject } from '../core/workspace'
import { generate as geminiWeb } from '../tools/google-media-tools'
import { showGeminiWindow } from '../tools/gemini-internal'
import { listCustomModels, customEndpoint, type CustomModel } from '../core/custom-models'
import { isChatKind, parseImageResponse } from '../core/media-custom'
import { MEDIA_MODELS, autoOrder, bumpUsage, describeModels, rollUsage, type KeyName, type MediaKind, type MediaModel, type Usage } from '../core/media-registry'

const USAGE_FILE = 'media-usage.json'
const outDir = (): string => {
  const d = path.join(app.getPath('userData'), 'media-out')
  fs.mkdirSync(d, { recursive: true })
  return d
}
const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const hasKey = (k: KeyName): boolean => !!getApiKey(k as never)
const getUsage = (): Usage => rollUsage(readJson<Usage | undefined>(USAGE_FILE, undefined))
// User-added models of kind image/audio join the list of their button automatically.
function customExtras(): MediaModel[] {
  return listCustomModels()
    .filter((m) => m.enabled && !isChatKind(m.kind))
    .map((m): MediaModel => {
      const local = /localhost|127\.0\.0\.1/i.test(m.baseURL)
      const noKey = !local && !customEndpoint(m).key
      return {
        id: 'custom:' + m.id,
        kind: m.kind as MediaKind,
        label: m.name,
        route: 'custom',
        priority: 10,
        color: '#9e9e9e',
        dailyCap: 0,
        customId: m.id,
        best: m.desc || 'موديل ضفتو أنت (' + m.model + ')',
        limitText: m.limit || 'حسب مزوّدك',
        blocked: noKey ? 'ما في مفتاح لهالموديل (ضيفو بصفحة الموديلات)' : undefined
      }
    })
}
const ctx = () => ({ hasKey, freeOnly: freeOnly(), usage: getUsage(), extra: customExtras() })

async function customRun(m: MediaModel, prompt: string): Promise<string> {
  const cm = listCustomModels().find((x) => x.id === m.customId) as CustomModel | undefined
  if (!cm) throw new Error('الموديل انحذف')
  const { base, key } = customEndpoint(cm)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key) headers.authorization = 'Bearer ' + key
  if (m.kind === 'audio') {
    if (!cm.baseURL) throw new Error('OpenRouter ما بيدعم التحويل لصوت؛ حط Base URL لمزوّد بيدعم /audio/speech')
    const r = await fetch(base + '/audio/speech', { method: 'POST', headers, body: JSON.stringify({ model: cm.model, input: prompt, voice: 'alloy' }), signal: AbortSignal.timeout(180000) })
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120))
    return save(Buffer.from(await r.arrayBuffer()), extOf(r.headers.get('content-type') ?? '', 'mp3'), 'custom-voice')
  }
  const body = cm.baseURL
    ? { model: cm.model, prompt, n: 1, size: '1024x1024' }
    : { model: cm.model, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }
  const r = await fetch(base + (cm.baseURL ? '/images/generations' : '/chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120))
  const img = parseImageResponse(await r.json())
  if (!img) throw new Error('الرد ما فيه صورة')
  if (img.b64) return save(Buffer.from(img.b64, 'base64'), 'png', 'custom-image')
  const d = await fetch(img.url as string, { signal: AbortSignal.timeout(120000) })
  if (!d.ok) throw new Error('ما قدرت أنزّل الصورة ' + d.status)
  return save(Buffer.from(await d.arrayBuffer()), extOf(d.headers.get('content-type') ?? '', 'png'), 'custom-image')
}

export interface GenResult {
  ok: boolean
  path?: string
  model?: string
  modelId?: string
  color?: string
  note: string
}

async function save(buf: Buffer, ext: string, tag: string): Promise<string> {
  const f = path.join(outDir(), `${tag}-${stamp()}.${ext}`)
  await fsp.writeFile(f, buf)
  return f
}

const extOf = (ct: string, dflt: string): string => (/png/i.test(ct) ? 'png' : /jpe?g/i.test(ct) ? 'jpg' : /webp/i.test(ct) ? 'webp' : /flac/i.test(ct) ? 'flac' : /wav/i.test(ct) ? 'wav' : /mpeg|mp3/i.test(ct) ? 'mp3' : dflt)

async function pollinations(prompt: string): Promise<string> {
  const seed = Math.floor(Math.random() * 1e9)
  const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`, { signal: AbortSignal.timeout(120000) })
  const ct = r.headers.get('content-type') ?? ''
  if (!r.ok || !/image/i.test(ct)) throw new Error('Pollinations ' + r.status)
  return save(Buffer.from(await r.arrayBuffer()), extOf(ct, 'jpg'), 'pollinations')
}

async function hfBinary(model: string, body: unknown, tag: string, dflt: string): Promise<string> {
  const r = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + getApiKey('HUGGINGFACE_API_KEY') },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000)
  })
  const ct = r.headers.get('content-type') ?? ''
  if (!r.ok) throw new Error('HF ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120))
  if (/json/i.test(ct)) throw new Error('HF: ' + (await r.text()).slice(0, 120))
  return save(Buffer.from(await r.arrayBuffer()), extOf(ct, dflt), tag)
}

async function geminiApiImage(prompt: string): Promise<string> {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': getApiKey('GEMINI_API_KEY') },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(120000)
  })
  if (!r.ok) throw new Error('Gemini API ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120))
  const j = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] }
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
  if (!part?.data) throw new Error('Gemini API: ما رجع صورة')
  return save(Buffer.from(part.data, 'base64'), extOf(part.mimeType ?? '', 'png'), 'gemini-api')
}

// Local text-to-speech through Windows SAPI (System.Speech). Text goes through a temp file (no quoting problems).
// PowerShell 7 is tried first (it also sees the Arabic Naayf voice); then the 32-bit and 64-bit Windows PowerShell.
function runSapi(exe: string, script: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    const t = setTimeout(() => p.kill(), 120000)
    p.on('error', reject)
    p.on('close', (c) => {
      clearTimeout(t)
      c === 0 ? resolve() : reject(new Error(err.slice(0, 160) || 'SAPI فشل'))
    })
  })
}

async function windowsVoice(text: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('أصوات ويندوز بس على ويندوز')
  const out = path.join(outDir(), `voice-${stamp()}.wav`)
  const tmp = path.join(os.tmpdir(), 'trl-tts-' + Date.now() + '.txt')
  const script = tmp + '.ps1'
  await fsp.writeFile(tmp, text, 'utf-8')
  const arabic = /[\u0600-\u06FF]/.test(text)
  const want = arabic ? 'ar*' : 'en*'
  const ps = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $t=[IO.File]::ReadAllText('${tmp.replace(/'/g, "''")}',[Text.Encoding]::UTF8)
$v=$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Culture.Name -like '${want}' } | Select-Object -First 1
if(-not $v){ exit 3 }
$s.SelectVoice($v.Name); $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak($t); $s.SetOutputToNull(); $s.Dispose()`
  fs.writeFileSync(script, '\uFEFF' + ps, 'utf-8')
  const sys = process.env.SystemRoot ?? 'C:\\Windows'
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter((x): x is string => !!x)
  const exes = [...pf.map((d) => path.join(d, 'PowerShell', '7', 'pwsh.exe')), path.join(sys, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')].filter((e) => fs.existsSync(e))
  let last = ''
  try {
    for (const exe of exes) {
      try {
        await runSapi(exe, script)
        if (fs.existsSync(out) && fs.statSync(out).size > 100) return out
        last = 'الصوت طلع فاضي'
      } catch (e) {
        last = e instanceof Error ? e.message : String(e)
      }
    }
  } finally {
    void fsp.rm(tmp, { force: true }).catch(() => undefined)
    void fsp.rm(script, { force: true }).catch(() => undefined)
  }
  throw new Error(arabic ? 'ما لقيت صوت عربي مثبّت بويندوز (' + last + ')' : 'ما لقيت صوت إنجليزي مثبّت (' + last + ')')
}

const savedPath = (r: string): string | null => {
  const m = r.match(/هون:\s*(.+)$/m)
  return m && fs.existsSync(m[1].trim()) ? m[1].trim() : null
}

// Gemini runs inside the app first (hidden window). If that window is not signed in / did not load (nothing was
// generated yet), it falls back to the dedicated Chrome. Failures after the prompt was sent do not retry (quota).
async function viaGemini(kind: 'image' | 'video', prompt: string): Promise<string> {
  let inner = ''
  try {
    const r = await geminiWeb(kind, prompt, 'internal')
    const f = savedPath(r)
    if (f) return f
    inner = r.replace(/^ERROR:\s*/, '')
  } catch (e) {
    inner = e instanceof Error ? e.message : String(e)
  }
  if (!/^NEEDS_LOGIN|ما حمّلت|Gemini page|انتهت المهلة: خيار/.test(inner)) throw new Error(inner.slice(0, 200))
  const r2 = await geminiWeb(kind, prompt, 'chrome')
  const f2 = savedPath(r2)
  if (f2) return f2
  throw new Error('داخلي: ' + inner.slice(0, 90) + ' | Chrome: ' + r2.replace(/^ERROR:\s*/, '').slice(0, 110))
}

async function run(m: MediaModel, prompt: string): Promise<string> {
  switch (m.id) {
    case 'gemini-web-image':
      return viaGemini('image', prompt)
    case 'gemini-web-video':
      return viaGemini('video', prompt)
    case 'hf-flux':
      return hfBinary('black-forest-labs/FLUX.1-schnell', { inputs: prompt }, 'flux', 'jpg')
    case 'pollinations':
      return pollinations(prompt)
    case 'gemini-api-image':
      return geminiApiImage(prompt)
    case 'windows-voice':
      return windowsVoice(prompt)
    case 'hf-mms-ara':
      return hfBinary('facebook/mms-tts-ara', { inputs: prompt }, 'mms', 'flac')
    default:
      if (m.route === 'custom') return customRun(m, prompt)
      throw new Error('هالموديل بيفتح بالمتصفح بس')
  }
}

let busy = false

export async function generateMedia(kind: MediaKind, modelId: string, prompt: string): Promise<GenResult> {
  const text = prompt.trim()
  if (!text) return { ok: false, note: 'اكتب وصف أول.' }
  if (activeProject()?.confidential) return { ok: false, note: '🔒 المشروع الفعّال سري: ممنوع ينبعت وصف لأي خدمة خارجية. غيّر المشروع أول.' }
  if (busy) return { ok: false, note: 'في توليد شغّال هلأ، استنى يخلص.' }
  busy = true
  try {
    const list = describeModels(kind, ctx())
    const chain = modelId === 'auto' ? autoOrder(list) : list.filter((m) => m.id === modelId)
    if (!chain.length) return { ok: false, note: 'ما في موديل متاح لهالنوع هلأ.' }
    const notes: string[] = []
    for (const m of chain) {
      if (!m.available) {
        notes.push(m.label + ': ' + m.reason)
        continue
      }
      if (m.route === 'site') return { ok: false, note: 'هالموقع بيتفتح بالمتصفح (زر "افتح الموقع").' }
      try {
        const file = await run(m, text)
        writeJson(USAGE_FILE, bumpUsage(getUsage(), m.id))
        return { ok: true, path: file, model: m.label, modelId: m.id, color: m.color, note: 'تم بـ ' + m.label + (notes.length ? ' (بعد ما فشل: ' + notes.join(' | ') + ')' : '') }
      } catch (e) {
        notes.push(m.label + ': ' + (e instanceof Error ? e.message : String(e)))
      }
    }
    return { ok: false, note: 'فشل التوليد. ' + notes.join(' | ') }
  } finally {
    busy = false
  }
}

const inOut = (p: unknown): string | null => {
  if (typeof p !== 'string') return null
  const base = path.resolve(outDir())
  const full = path.resolve(p)
  return full.startsWith(base + path.sep) && fs.existsSync(full) ? full : null
}

export function registerMediaIpc(): void {
  ipcMain.handle('media:models', (_e, kind: unknown) => (kind === 'image' || kind === 'video' || kind === 'audio' ? describeModels(kind, ctx()) : []))
  ipcMain.handle('media:generate', (_e, kind: unknown, modelId: unknown, prompt: unknown) => {
    if ((kind !== 'image' && kind !== 'video' && kind !== 'audio') || typeof modelId !== 'string' || typeof prompt !== 'string') return { ok: false, note: 'طلب غير صالح' }
    return generateMedia(kind, modelId, prompt.slice(0, 4000))
  })
  ipcMain.handle('media:site', (_e, id: unknown, prompt: unknown, external: unknown) => {
    const m = MEDIA_MODELS.find((x) => x.id === id && x.route === 'site' && x.url)
    if (!m?.url) return null
    // The prompt is copied so it can be pasted into the site's own box.
    if (typeof prompt === 'string' && prompt.trim()) clipboard.writeText(prompt.slice(0, 4000))
    if (external) void shell.openExternal(m.url)
    return m.url
  })
  ipcMain.handle('media:gemini-login', async () => {
    await showGeminiWindow()
    return true
  })
  ipcMain.handle('media:preview', async (_e, p: unknown) => {
    const f = inOut(p)
    if (!f || !/\.(png|jpe?g|webp|wav|mp3|flac|ogg)$/i.test(f) || fs.statSync(f).size > 15_000_000) return ''
    const ext = path.extname(f).slice(1).toLowerCase()
    const mime = /^(png|jpe?g|webp)$/.test(ext) ? 'image/' + ext.replace('jpg', 'jpeg') : ext === 'mp3' ? 'audio/mpeg' : 'audio/' + ext
    return `data:${mime};base64,` + (await fsp.readFile(f)).toString('base64')
  })
  ipcMain.handle('media:open', async (_e, p: unknown, reveal: unknown) => {
    const f = inOut(p)
    if (!f) return false
    if (reveal) shell.showItemInFolder(f)
    else await shell.openPath(f)
    return true
  })
}
