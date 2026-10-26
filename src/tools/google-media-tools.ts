// Image (Nano Banana) and video (Veo) generation through the user's own Gemini web account (Google AI plan),
// driven over the same dedicated Chrome profile used for NotebookLM. No Google credentials pass through this app.
// Every request opens a NEW Gemini chat; existing chats are never touched.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type OpenAI from 'openai'
import { ensureChrome, newPage, typeText, pressEnter, sleep, PORT, Page } from './notebook-tools'
import { openInternal, expectDownload, GEMINI_APP_URL, type Drv } from './gemini-internal'

type Handlers = Map<string, (a: Record<string, unknown>) => Promise<string>>

export const needsGoogleMedia = (text: string): boolean =>
  /nano\s*banana|\bveo\b|gemini.{0,30}(image|video|صور|فيديو)|(ولّ?د|اعمل|سوّ?ي|أنشئ|انشئ|صمّ?م|اصنع)\s*(لي\s*)?(صورة|صور|فيديو|مقطع)|generate\s+(an?\s+)?(image|video)|create\s+(an?\s+)?(image|video)/i.test(text)

const GEMINI_URL = 'https://gemini.google.com/app'
const LOGIN_MSG = 'NEEDS_LOGIN: فتحتلك نافذة Chrome مخصصة للأتمتة. سجّل دخول بحساب غووغل (اللي فيه الاشتراك) مرة وحدة هناك، وبعدين عيد الطلب.'

const outDir = (): string => {
  const d = path.join(app.getPath('userData'), 'media-out')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Click the smallest visible element whose own text matches (menus in Gemini are plain divs, not buttons).
const clickText = (rx: string): string => `(()=>{const r=new RegExp(${JSON.stringify(rx)},'i');
 const c=[...document.querySelectorAll('button,[role=button],[role=menuitem],[role=option],a,div,span')].filter(e=>{const b=e.getBoundingClientRect();const t=(e.innerText||'').trim();return b.width>0&&b.height>0&&t.length<40&&r.test(t)});
 c.sort((a,b)=>a.innerText.length-b.innerText.length);if(!c.length)return false;c[0].click();return true})()`
const clickAria = (rx: string): string => `(()=>{const r=new RegExp(${JSON.stringify(rx)},'i');
 const b=[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).find(e=>r.test(e.getAttribute('aria-label')||''));if(!b)return false;b.click();return true})()`
const bodyHas = (rx: string): string => `new RegExp(${JSON.stringify(rx)},'i').test(document.body.innerText)`

async function until(p: Drv, expr: string, ms: number, what: string, step = 700): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await p.eval<boolean>(expr).catch(() => false)) return
    await sleep(step)
  }
  throw new Error('انتهت المهلة: ' + what)
}

async function listFiles(dir: string): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  for (const f of fs.readdirSync(dir)) {
    try {
      m.set(f, fs.statSync(path.join(dir, f)).mtimeMs)
    } catch {
      /* ignore */
    }
  }
  return m
}

export async function generate(kind: 'image' | 'video', prompt: string, mode: 'internal' | 'chrome' = 'chrome'): Promise<string> {
  let p: Drv
  if (mode === 'internal') p = await openInternal(GEMINI_APP_URL)
  else {
    await ensureChrome()
    p = await newPage(GEMINI_URL)
  }
  const loginMsg = mode === 'internal' ? 'NEEDS_LOGIN: النافذة الداخلية مو مسجّل فيها دخول Google (زر "تسجيل دخول Gemini" بنافذة التوليد)' : LOGIN_MSG
  let browser: Page | null = null
  try {
    // Wait for the composer or a sign-in redirect.
    let ready = false
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(700)
      const url = await p.eval<string>('location.href').catch(() => '')
      if (/accounts\.google\.com/.test(url)) return loginMsg
      if (i === 14 && /sign in|تسجيل الدخول/i.test(await p.eval<string>('document.body.innerText.slice(0,400)').catch(() => ''))) return loginMsg
      ready = !!(await p.eval<boolean>(clickAria('^Upload & tools$').replace('b.click();return true', 'return true')).catch(() => false))
    }
    if (!ready) {
      const body = await p.eval<string>('document.body.innerText.slice(0,300)').catch(() => '')
      if (/sign in|تسجيل الدخول/i.test(body)) return loginMsg
      throw new Error('صفحة Gemini ما حمّلت')
    }
    // Gemini lets signed-out visitors chat, but images and video need an account: stop early instead of waiting minutes.
    const guest = await p
      .eval<boolean>(`[...document.querySelectorAll('a,button')].some(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&/^\\s*sign in\\s*$/i.test(e.innerText||'')})`)
      .catch(() => false)
    if (guest) return loginMsg
    // Open "Upload & tools" and pick Create image / Create video.
    const label = kind === 'image' ? 'create image' : 'create video'
    for (let i = 0; i < 6; i++) {
      if (await p.eval<boolean>(bodyHas(label)).catch(() => false)) break
      await p.eval(clickAria('^Upload & tools$'))
      await sleep(1200)
    }
    await until(p, clickText('^' + label + '$'), 10000, 'خيار ' + label)
    await sleep(1500)
    const before = await p.eval<number>(kind === 'image' ? `document.querySelectorAll('img[alt*="AI generated"]').length` : `document.querySelectorAll('video').length`)
    await until(p, `(()=>{const e=document.querySelector('div[contenteditable=true]');if(!e)return false;e.focus();return true})()`, 10000, 'خانة الكتابة')
    await typeText(p as unknown as Page, prompt)
    await sleep(600)
    await pressEnter(p as unknown as Page)
    // Wait for the result (image ~30s, video up to ~8 min).
    const end = Date.now() + (kind === 'image' ? 180000 : 600000)
    let done = false
    while (Date.now() < end && !done) {
      await sleep(3000)
      const st = await p.eval<{ n: number; dl: boolean; err: string }>(`(()=>{const t=document.body.innerText;const n=${kind === 'image' ? `document.querySelectorAll('img[alt*="AI generated"]').length` : `document.querySelectorAll('video').length`};
        const dl=[...document.querySelectorAll('button')].some(b=>/download/i.test(b.getAttribute('aria-label')||''));
        const m=t.slice(-700).match(/(can.?t|cannot|couldn.?t|unable to)[^\\n]{0,120}|(reached|hit)[^\\n]{0,40}limit[^\\n]{0,80}/i);return {n,dl,err:m?m[0]:''}})()`).catch(() => ({ n: 0, dl: false, err: '' }))
      if (st.err && st.n <= before) return 'Gemini رفض/ما قدر: ' + st.err
      if (st.n > before && (kind === 'image' ? st.dl : true)) done = true
    }
    if (!done) throw new Error('ما خلّص التوليد بالوقت المحدد')
    if (kind === 'video') await until(p, bodyHas('video is ready'), 300000, 'جاهزية الفيديو', 3000)
    await sleep(1500)
    // Download through Chrome's own download button (full size).
    const dir = outDir()
    if (mode === 'internal') {
      const got = expectDownload(dir, 120000)
      const clicked = await p.eval<boolean>(clickAria(kind === 'image' ? 'download full size image' : '^download video$'))
      if (!clicked) {
        got.cancel()
        throw new Error('ما لقيت زر التنزيل')
      }
      return `تم. الملف انحفظ هون: ${await got.promise}`
    }
    const seen = await listFiles(dir)
    const ver = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) as { webSocketDebuggerUrl: string }
    browser = new Page('browser', ver.webSocketDebuggerUrl)
    await browser.open()
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: false })
    const ok = await p.eval<boolean>(clickAria(kind === 'image' ? 'download full size image' : '^download video$'))
    if (!ok) throw new Error('ما لقيت زر التنزيل')
    const dEnd = Date.now() + 120000
    while (Date.now() < dEnd) {
      await sleep(1500)
      const now = await listFiles(dir)
      for (const [f, t] of now) {
        if (/\.(crdownload|tmp)$/i.test(f)) continue
        if (!seen.has(f) || (seen.get(f) ?? 0) < t) {
          const full = path.join(dir, f)
          const s1 = fs.statSync(full).size
          await sleep(1200)
          if (fs.statSync(full).size === s1 && s1 > 0) return `تم. الملف انحفظ هون: ${full}`
        }
      }
    }
    throw new Error('التنزيل ما خلص')
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    await p.close()
  }
}

export function addGoogleMediaTools(defs: OpenAI.Chat.ChatCompletionTool[], handlers: Handlers): void {
  const mk = (name: string, kind: 'image' | 'video', desc: string): void => {
    defs.push({
      type: 'function',
      function: {
        name,
        description: desc,
        parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed description of what to generate (any language; English usually gives the best result)' } }, required: ['prompt'] }
      }
    })
    handlers.set(name, async (a) => {
      const prompt = String(a.prompt ?? '').trim()
      if (!prompt) return 'ERROR: prompt فاضي'
      try {
        return await generate(kind, prompt)
      } catch (e) {
        return 'ERROR: ' + (e as Error).message
      }
    })
  }
  mk('gemini_image', 'image', "Generate an image (Nano Banana) through the user's own Gemini web account / Google AI plan. Slow (about 30-60s). Returns the saved file path. Use when the user asks for an image, logo, mascot, illustration, etc.")
  mk('gemini_video', 'video', "Generate a short video (Veo) through the user's own Gemini web account / Google AI plan. Slow (1-8 minutes) and limited by the plan's daily quota. Returns the saved file path.")
}
