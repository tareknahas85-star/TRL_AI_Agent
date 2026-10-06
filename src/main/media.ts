import { nativeImage } from 'electron'
import { spawn } from 'child_process'
import fsp from 'fs/promises'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getApiKey } from '../store/secure-store'
import { OPENROUTER_MODELS_API } from '../core/config'
import { scoreFree } from '../core/free-best'
import { bumpFreeCount } from '../core/model-health'
import { readJson, dataFile } from '../core/json-store'
import { hfChosen } from './hf'
import { freeOnly } from '../core/spend'

// ---------- audio / video -> text (local faster-whisper, nothing leaves the PC) ----------
const WHISPER_PY = `
import sys, os
from faster_whisper import WhisperModel
m = WhisperModel(os.environ.get("WHISPER_MODEL", "medium"), device="cpu", compute_type="int8")
segs, info = m.transcribe(sys.argv[1], vad_filter=True)
text = " ".join(s.text.strip() for s in segs).strip()
sys.stdout.buffer.write(("LANG=" + str(info.language) + "\\n" + text).encode("utf-8"))
`

function whisperPythons(): string[] {
  const home = os.homedir()
  const list = [
    process.env.WHISPER_PYTHON ?? '',
    path.join(home, 'mcp-venvs', 'whisper', 'Scripts', 'python.exe'),
    path.join(home, 'mcp-venvs', 'whisper', 'bin', 'python'),
    process.platform === 'win32' ? 'python' : 'python3'
  ]
  return list.filter((p) => p && (!path.isAbsolute(p) || fs.existsSync(p)))
}

function runPy(py: string, file: string, timeoutMs: number): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(py, ['-c', WHISPER_PY, file], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', WHISPER_MODEL: process.env.WHISPER_MODEL || 'medium' }
    })
    const out: Buffer[] = []
    let err = ''
    const t = setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', (e) => {
      clearTimeout(t)
      resolve({ ok: false, out: '', err: e.message })
    })
    p.on('close', (code) => {
      clearTimeout(t)
      resolve({ ok: code === 0, out: Buffer.concat(out).toString('utf-8'), err })
    })
  })
}

// Deepgram (paid, key lives in the app's Deepgram connector). Used only when "free only" is OFF and the project is not confidential.
function deepgramKey(): string {
  const find = (o: unknown): string => {
    if (!o || typeof o !== 'object') return ''
    const r = o as Record<string, unknown>
    if (r.name === 'deepgram' && r.env && typeof r.env === 'object') return String((r.env as Record<string, unknown>).DEEPGRAM_API_KEY ?? '')
    for (const v of Object.values(r)) {
      const k = find(v)
      if (k) return k
    }
    return ''
  }
  return process.env.DEEPGRAM_API_KEY || find(readJson<unknown>('mcp-config.json', {}))
}

async function deepgramTranscribe(file: string): Promise<{ text: string; lang: string } | null> {
  const key = deepgramKey()
  if (!key) return null
  try {
    const st = await fsp.stat(file)
    if (st.size > 200_000_000) return null
    const r = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&detect_language=true&smart_format=true&punctuate=true', {
      method: 'POST',
      headers: { authorization: 'Token ' + key, 'content-type': 'application/octet-stream' },
      body: await fsp.readFile(file),
      signal: AbortSignal.timeout(10 * 60 * 1000)
    })
    if (!r.ok) return null
    const j = (await r.json()) as { results?: { channels?: { detected_language?: string; alternatives?: { transcript?: string }[] }[] } }
    const ch = j.results?.channels?.[0]
    const text = (ch?.alternatives?.[0]?.transcript ?? '').trim()
    return text ? { text, lang: ch?.detected_language ?? '' } : null
  } catch {
    return null
  }
}

export async function transcribe(file: string, confidential = false): Promise<{ text?: string; lang?: string; note: string }> {
  if (!confidential && !freeOnly()) {
    const d = await deepgramTranscribe(file)
    if (d) return { text: d.text, lang: d.lang, note: 'تفريغ بـ Deepgram (مدفوع من رصيدك)' + (d.lang ? ' (اللغة: ' + d.lang + ')' : '') }
  }
  const pys = whisperPythons()
  if (!pys.length) return { note: 'ما لقيت Whisper المحلي (faster-whisper) على الجهاز' }
  let lastErr = ''
  for (const py of pys) {
    const r = await runPy(py, file, 15 * 60 * 1000)
    if (r.ok) {
      const m = r.out.match(/^LANG=(\S*)\n([\s\S]*)$/)
      const text = (m ? m[2] : r.out).trim()
      const lang = m ? m[1] : ''
      if (!text) return { note: 'ما انسمع كلام واضح بالملف (صمت أو ضجيج)' }
      return { text, lang, note: 'تفريغ محلي بـ Whisper' + (lang ? ' (اللغة: ' + lang + ')' : '') + ' — ما طلع شي برا جهازك' }
    }
    lastErr = (r.err || '').split('\n').filter(Boolean).slice(-1)[0] ?? ''
  }
  return { note: 'فشل التفريغ المحلي: ' + lastErr.slice(0, 160) }
}

// ---------- image -> text description / OCR ----------
const VISION_PROMPT =
  'Describe this image in detail for someone who cannot see it. Transcribe ALL visible text exactly as written (any language, keep Arabic as is). ' +
  'If it is a screenshot, document, table, chart or diagram, extract its structure and content. Be factual and complete; do not invent anything.'

async function imageDataUrl(file: string): Promise<string | null> {
  try {
    const ext = path.extname(file).slice(1).toLowerCase()
    const raw = await fsp.readFile(file)
    const img = nativeImage.createFromBuffer(raw)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const scale = Math.min(1, 1600 / Math.max(width, height))
      const out = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : img
      return 'data:image/jpeg;base64,' + out.toJPEG(85).toString('base64')
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) && raw.length < 6_000_000) {
      const mime = ext === 'jpg' ? 'jpeg' : ext
      return 'data:image/' + mime + ';base64,' + raw.toString('base64')
    }
  } catch {
    /* fall through */
  }
  return null
}

const OLLAMA = 'http://127.0.0.1:11434'
const LOCAL_VISION = /(vl|llava|vision|moondream|minicpm-v|bakllava|gemma3|granite3\.2-vision)/i

async function localVisionModel(): Promise<string | null> {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    const j = (await r.json()) as { models?: { name: string }[] }
    return j.models?.map((m) => m.name).find((n) => LOCAL_VISION.test(n)) ?? null
  } catch {
    return null
  }
}

async function describeLocal(model: string, dataUrl: string): Promise<string> {
  const r = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: VISION_PROMPT, images: [dataUrl.split(',')[1]] }]
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000)
  })
  if (!r.ok) throw new Error('ollama ' + r.status)
  const j = (await r.json()) as { message?: { content?: string } }
  return (j.message?.content ?? '').trim()
}

type OrModel = { id: string; created?: number; context_length?: number; supported_parameters?: string[]; architecture?: { input_modalities?: string[]; output_modalities?: string[] } }
let visionCache: { at: number; ids: string[] } | null = null

async function freeVisionModels(): Promise<string[]> {
  if (visionCache && Date.now() - visionCache.at < 6 * 3600 * 1000) return visionCache.ids
  try {
    const r = await fetch(OPENROUTER_MODELS_API, { signal: AbortSignal.timeout(15000) })
    const j = (await r.json()) as { data?: OrModel[] }
    const ids = (j.data ?? [])
      .filter((m) => m.id.endsWith(':free') && m.architecture?.input_modalities?.includes('image'))
      .map((m) => ({ id: m.id, s: scoreFree(m as never) }))
      .sort((a, b) => b.s - a.s)
      .map((m) => m.id)
    visionCache = { at: Date.now(), ids }
    return ids
  } catch {
    return visionCache?.ids ?? []
  }
}

async function describeOpenRouter(dataUrl: string): Promise<{ text: string; model: string } | null> {
  const key = getApiKey('OPENROUTER_API_KEY')
  if (!key) return null
  const ids = (await freeVisionModels()).slice(0, 4)
  for (const model of ids) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model,
          max_tokens: 1500,
          messages: [{ role: 'user', content: [{ type: 'text', text: VISION_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }]
        }),
        signal: AbortSignal.timeout(75000)
      })
      bumpFreeCount()
      if (!r.ok) {
        visionLog('or/' + model, r.status + ' ' + (await r.text().catch(() => '')))
        continue
      }
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
      const text = (j.choices?.[0]?.message?.content ?? '').trim()
      if (text.length > 10) return { text, model }
    } catch {
      /* try next model */
    }
  }
  return null
}

// Failed vision attempts are written to router.log so the real reason (403 / 429 / no key) is visible later.
function visionLog(model: string, reason: string): void {
  try {
    fs.appendFileSync(dataFile('router.log'), new Date().toISOString() + ' vision:' + model + ' :: ' + reason.replace(/\s+/g, ' ').slice(0, 200) + '\n')
  } catch {
    /* best-effort */
  }
}

// Hugging Face Inference Providers (OpenAI-compatible router). Free tier is limited; needs HUGGINGFACE_API_KEY.
const HF_DEFAULT_MODELS = ['google/gemma-4-31B-it', 'google/gemma-3-27b-it', 'Qwen/Qwen3.5-35B-A3B']

async function describeHuggingFace(dataUrl: string): Promise<{ text: string; model: string } | null> {
  const key = getApiKey('HUGGINGFACE_API_KEY')
  if (!key) return null
  const chosen = hfChosen()
  for (const model of [...new Set([chosen, ...HF_DEFAULT_MODELS].filter(Boolean))]) {
    try {
      const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model,
          max_tokens: 2500,
          messages: [{ role: 'user', content: [{ type: 'text', text: VISION_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }]
        }),
        signal: AbortSignal.timeout(75000)
      })
      if (!r.ok) {
        visionLog('hf/' + model, r.status + ' ' + (await r.text().catch(() => '')))
        continue
      }
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
      const text = (j.choices?.[0]?.message?.content ?? '').trim()
      if (text.length > 10) return { text, model }
      visionLog('hf/' + model, 'empty answer')
    } catch (e) {
      visionLog('hf/' + model, e instanceof Error ? e.message : String(e))
    }
  }
  return null
}

export async function describeImage(file: string, confidential: boolean): Promise<{ text?: string; note: string }> {
  const dataUrl = await imageDataUrl(file)
  if (!dataUrl) return { note: 'ما قدرت أقرا الصورة (صيغة غير مدعومة أو كبيرة كتير). المسار محفوظ' }
  const local = await localVisionModel()
  if (local) {
    try {
      const t = await describeLocal(local, dataUrl)
      if (t) return { text: t, note: 'وصف الصورة بموديل محلي (' + local + ') — ما طلعت برا جهازك' }
    } catch {
      /* fall back unless confidential */
    }
  }
  if (confidential) {
    return { note: 'مشروع سري: ممنوع تنبعت الصورة لأي خدمة خارجية، وما في موديل رؤية محلي مثبّت. لتفعيلها محلياً: ollama pull qwen2.5vl:3b' }
  }
  const r = await describeOpenRouter(dataUrl)
  if (r) return { text: r.text, note: 'وصف الصورة بموديل رؤية مجاني (' + r.model + ') عبر OpenRouter' }
  const h = await describeHuggingFace(dataUrl)
  if (h) return { text: h.text, note: 'وصف الصورة بموديل Hugging Face (' + h.model + ')' }
  return { note: 'ما لقيت موديل رؤية شغّال هلأ (الكوتا المجانية أو ما في مفتاح). المسار محفوظ. السبب بالتفصيل بملف router.log' }
}
