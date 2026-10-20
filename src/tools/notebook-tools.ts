// NotebookLM ("Gemini Notebook") through the user's own Chrome, driven over the DevTools protocol.
// A dedicated Chrome profile (userData/notebooklm-chrome) keeps the Google sign-in, so the user signs in once.
// No Google credentials ever pass through this app, and nothing in existing notebooks is touched: every run makes a NEW notebook.
import { app } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type OpenAI from 'openai'

type Handlers = Map<string, (a: Record<string, unknown>) => Promise<string>>
type WS = { send(d: string): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null; onopen: (() => void) | null; onerror: ((e: unknown) => void) | null; onclose: (() => void) | null }

export const PORT = 9333
const HOME_URL = 'https://notebook.google.com/'
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const needsNotebook = (text: string): boolean => /notebook\s*lm|gemini\s*notebook|نوت\s*بوك\s*ال?\s*ام|نوتبوك|دفتر\s*(دراس|ملاحظات)|تحليل\s*دراسي|ملخص\s*دراسي|study\s*(guide|analysis)/i.test(text)

function chromePath(): string | null {
  const c = [
    path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ]
  return c.find((p) => p && fs.existsSync(p)) ?? null
}

async function cdpUp(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

export async function ensureChrome(): Promise<void> {
  if (await cdpUp()) return
  const exe = chromePath()
  if (!exe) throw new Error('Chrome مو مثبّت على الجهاز')
  const dir = path.join(app.getPath('userData'), 'notebooklm-chrome')
  fs.mkdirSync(dir, { recursive: true })
  spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--window-size=1200,850', 'about:blank'], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 40; i++) {
    if (await cdpUp()) return
    await sleep(500)
  }
  throw new Error('ما قدرت أشغّل Chrome للأتمتة')
}

export class Page {
  private ws!: WS
  private id = 0
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>()
  private listeners: ((m: { method?: string; params?: Record<string, unknown> }) => void)[] = []
  constructor(readonly targetId: string, private wsUrl: string) {}

  async open(): Promise<void> {
    const WSCtor = (globalThis as unknown as { WebSocket: new (u: string) => WS }).WebSocket
    this.ws = new WSCtor(this.wsUrl)
    await new Promise<void>((res, rej) => {
      this.ws.onopen = () => res()
      this.ws.onerror = () => rej(new Error('CDP connect failed'))
    })
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!
        this.pending.delete(m.id)
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
      } else this.listeners.forEach((l) => l(m))
    }
  }
  on(l: (m: { method?: string; params?: Record<string, unknown> }) => void): void {
    this.listeners.push(l)
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: res as (v: unknown) => void, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval<T = unknown>(expr: string): Promise<T> {
    const r = await this.send<{ result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'eval error')
    return r.result?.value as T
  }
  async close(): Promise<void> {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/close/${this.targetId}`, { signal: AbortSignal.timeout(2000) })
    } catch {
      /* ignore */
    }
  }
}

export async function newPage(url: string): Promise<Page> {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURI(url)}`, { method: 'PUT' })
  const t = (await r.json()) as { id: string; webSocketDebuggerUrl: string }
  const p = new Page(t.id, t.webSocketDebuggerUrl)
  await p.open()
  await p.send('Runtime.enable')
  await p.send('Page.enable')
  return p
}

// In-page helpers, injected as a string. Matching is by visible text so small layout changes do not break it.
const HELPERS = `
(()=>{ if(window.__nb) return;
 const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
 const txt=e=>((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')).replace(/\\s+/g,' ').trim();
 window.__nb={
  click(re,scope){const root=scope?document.querySelector(scope):document;if(!root)return false;const rx=new RegExp(re,'i');
   const c=[...root.querySelectorAll('button,[role=button],[role=menuitem],a,[role=tab],[role=option],div[tabindex]')].filter(vis).filter(e=>rx.test(txt(e)));
   c.sort((a,b)=>txt(a).length-txt(b).length); if(!c.length)return false; c[0].click(); return true},
  has(re){return new RegExp(re,'i').test(document.body.innerText)},
  dialog(){const d=[...document.querySelectorAll('[role=dialog],mat-dialog-container')].filter(vis).pop();return d?d.innerText.replace(/\\s+/g,' ').slice(0,200):''},
  closeDialog(){const d=[...document.querySelectorAll('[role=dialog],mat-dialog-container')].filter(vis).pop();if(!d)return false;
   const b=[...d.querySelectorAll('button')].filter(vis).find(x=>/close|إغلاق|^x$|got it|dismiss|no thanks/i.test(txt(x))||/close/i.test(x.innerHTML.slice(0,300)));if(b){b.click();return true}return false},
  focusSel(sel,re){const rx=re?new RegExp(re,'i'):null;const el=[...document.querySelectorAll(sel)].filter(vis).find(e=>!rx||rx.test(e.placeholder||e.getAttribute('aria-label')||''));if(!el)return false;el.focus();el.select&&el.select&&el.select();return true},
  lastAnswer(){const all=[...document.querySelectorAll('.to-user-message-inner-content')];const last=all[all.length-1];if(!last)return '';
   const c=last.cloneNode(true);c.querySelectorAll('button,.citation,[class*=citation],[class*=thought]').forEach(x=>x.remove());return (c.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim()},
  answers(){return document.querySelectorAll('.to-user-message-inner-content').length},
  srcCount(){const m=document.body.innerText.match(/(\\d+)\\s+sources?\\b/i);return m?+m[1]:0}
 }})()`

const call = (p: Page, fn: string): Promise<unknown> => p.eval(`${HELPERS};window.__nb.${fn}`)

async function waitFor(p: Page, fn: string, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await call(p, fn).catch(() => false)) return
    await sleep(500)
  }
  throw new Error('انتهت المهلة: ' + what)
}

export async function typeText(p: Page, text: string): Promise<void> {
  await p.send('Input.insertText', { text })
}
export async function pressEnter(p: Page): Promise<void> {
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r' })
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })
}

type Src = { text?: string; url?: string; file?: string }

async function addSource(p: Page, s: Src, first: boolean): Promise<void> {
  if (!first) {
    await call(p, `click('^\\\\+?\\\\s*(add )?sources?$|add source')`)
    await sleep(1200)
  }
  await waitFor(p, `has('Copied text|Websites|Upload files|Paste')`, 15000, 'نافذة إضافة المصادر')
  if (s.text) {
    await waitFor(p, `click('^copied text$|copied text')`, 8000, 'زر النص المنسوخ')
    await waitFor(p, `focusSel('textarea,[contenteditable=true]','paste|text')`, 8000, 'خانة النص')
    await typeText(p, s.text)
    await sleep(500)
    await waitFor(p, `click('^insert$')`, 8000, 'زر Insert')
  } else if (s.url) {
    await waitFor(p, `click('^websites$|websites')`, 8000, 'زر Websites')
    await waitFor(p, `focusSel('textarea,input[type=text],input:not([type])','url|link|paste')`, 8000, 'خانة الرابط')
    await typeText(p, s.url)
    await sleep(500)
    await waitFor(p, `click('^insert$')`, 8000, 'زر Insert')
  } else if (s.file) {
    if (!fs.existsSync(s.file)) throw new Error('الملف مو موجود: ' + s.file)
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true })
    const opened = new Promise<number>((res) => p.on((m) => m.method === 'Page.fileChooserOpened' && res(Number((m.params as { backendNodeId: number }).backendNodeId))))
    await waitFor(p, `click('^upload files$|upload files')`, 8000, 'زر Upload')
    const node = await Promise.race([opened, sleep(10000).then(() => 0)])
    if (!node) throw new Error('ما فتح اختيار الملف')
    await p.send('DOM.setFileInputFiles', { files: [s.file], backendNodeId: node })
  }
}

export async function notebookAsk(sources: Src[], question: string): Promise<string> {
  await ensureChrome()
  const p = await newPage(HOME_URL)
  try {
    // Wait for the home page or a Google sign-in redirect.
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      await sleep(500)
      const url = await p.eval<string>('location.href').catch(() => '')
      if (/accounts\.google\.com/.test(url)) {
        return 'NEEDS_LOGIN: فتحتلك نافذة Chrome مخصصة للأتمتة. سجّل دخول بحساب غووغل مرة وحدة هناك، وبعدين عيد الطلب (ما بترجع تحتاج).'
      }
      ready = !!(await call(p, `has('New notebook|Create new|Create notebook|My notebooks')`).catch(() => false))
    }
    if (!ready) {
      const url = await p.eval<string>('location.href').catch(() => '')
      const body = await p.eval<string>('document.body.innerText.slice(0,300)').catch(() => '')
      if (/sign in|log in|تسجيل الدخول|get started|try notebook/i.test(body) || /accounts\.google\.com|notebooklm\.google\/?$/.test(url))
        return 'NEEDS_LOGIN: فتحتلك نافذة Chrome مخصصة للأتمتة. سجّل دخول بحساب غووغل مرة وحدة هناك، وبعدين عيد الطلب (ما بترجع تحتاج).'
      throw new Error('صفحة NotebookLM ما حمّلت (' + url + ')')
    }
    await waitFor(p, `click('new notebook|create new|create notebook')`, 10000, 'زر دفتر جديد')
    await waitFor(p, `has('Add sources|Copied text|Upload files|Sources')`, 30000, 'صفحة الدفتر الجديد')
    for (let i = 0; i < 3; i++) {
      const d = (await call(p, 'dialog()')) as string
      if (d && !/Copied text|Websites|Upload files|Paste/i.test(d)) {
        await call(p, 'closeDialog()')
        await sleep(1200)
      } else break
    }
    let first = true
    for (const s of sources) {
      await addSource(p, s, first)
      first = false
      await sleep(2500)
    }
    const dbg = async (t: string): Promise<void> => { if (process.env.NB_DEBUG) fs.appendFileSync('C:\\Temp\\nbtest\\dbg.log', '['+t+'] '+JSON.stringify(await p.eval<string>('document.body.innerText.slice(0,700)').catch(()=>''))+'\n') }
    await dbg('after-add')
    const want = sources.length
    const end = Date.now() + 120000
    while (Date.now() < end) {
      if (((await call(p, 'srcCount()')) as number) >= want) break
      await sleep(1000)
    }
    await dbg('before-close')
    await call(p, 'closeDialog()').catch(() => false)
    await sleep(2500)
    // Sources are processed asynchronously: wait until the notebook gets its auto title/summary (max 40s) so answers are grounded.
    for (let i = 0; i < 20; i++) {
      if (!(await call(p, "has('Untitled notebook')").catch(() => true))) break
      await sleep(2000)
    }
    await dbg('after-close')
    // Ask.
    const before = (await call(p, 'answers()')) as number
    await waitFor(p, `focusSel('textarea','ask a question|create something|اسأل')`, 15000, 'خانة الأسئلة')
    await typeText(p, question)
    await sleep(400)
    await pressEnter(p)
    let last = ''
    let stable = 0
    const aEnd = Date.now() + 180000
    while (Date.now() < aEnd) {
      await sleep(1500)
      const n = (await call(p, 'answers()')) as number
      if (n <= before) continue
      const t = (await call(p, 'lastAnswer()')) as string
      if (t && t === last) stable++
      else {
        stable = 0
        last = t
      }
      if (stable >= 3) break
    }
    if (!last) throw new Error('ما وصل رد من NotebookLM')
    const url = await p.eval<string>('location.href')
    return last + '\n\n(الدفتر: ' + url + ')'
  } finally {
    await p.close()
  }
}

export function addNotebookTools(defs: OpenAI.Chat.ChatCompletionTool[], handlers: Handlers): void {
  defs.push({
    type: 'function',
    function: {
      name: 'notebooklm_ask',
      description:
        "Study/analysis through the user's own NotebookLM (Gemini Notebook) account. Creates a NEW notebook, adds the given sources, asks the question and returns the grounded answer with the notebook link. Use for study analysis, summarising documents, studying PDFs/links. Slow (about 1 minute). Existing notebooks are never touched. Sources: text, url, or file (absolute local path).",
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'What to ask about the sources (any language)' },
          sources: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string' }, url: { type: 'string' }, file: { type: 'string', description: 'absolute local file path (pdf, docx, txt, audio...)' } } }
          }
        },
        required: ['question', 'sources']
      }
    }
  })
  handlers.set('notebooklm_ask', async (a) => {
    const q = String(a.question ?? '').trim()
    const src = (Array.isArray(a.sources) ? a.sources : []).map((s) => s as Src).filter((s) => s.text || s.url || s.file)
    if (!q || !src.length) return 'Error: pass a question and at least one source (text, url or file).'
    try {
      return await notebookAsk(src, q)
    } catch (e) {
      return 'Error: ' + (e instanceof Error ? e.message : String(e))
    }
  })
}
