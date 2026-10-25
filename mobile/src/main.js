import sodium from 'libsodium-wrappers'
import jsQR from 'jsqr'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { lib, approvalHash, approvalMsg } from '../../src/remote/protocol'
import { GuestLink } from '../../src/remote/session'
import { agentsHtml, schedHtml, reportHtml, moreHtml, todoHtml, projHtml } from './views.js'

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '5.10'

// ---------- native bridge (with a browser fallback so the UI can be tested without a phone) ----------
const AirNative = registerPlugin('AirNative', {
  web: () =>
    Promise.resolve({
      async info() { return { model: 'Browser' } },
      async secureSet({ key, value }) { localStorage.setItem('sec.' + key, value) },
      async secureGet({ key }) { return { value: localStorage.getItem('sec.' + key) } },
      async secureDelete({ key }) { localStorage.removeItem('sec.' + key) },
      async getPendingShare() { return {} },
      async startKeepAlive() {},
      async stopKeepAlive() {}
    })
})

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full/blocked */ } }
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' ث' : Math.floor(s / 60) + ' د ' + (s % 60) + ' ث' }

function md(text) {
  const parts = String(text ?? '').split(/```/)
  return parts.map((p, i) => {
    if (i % 2 === 1) { const body = p.replace(/^[\w+-]*\n/, ''); return '<pre><code>' + esc(body.replace(/\n$/, '')) + '</code></pre>' }
    let h = esc(p)
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    // [name](https://...) -> tappable link (Android hands https links to the Maps app / browser)
    h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    h = h.replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[-*]\s+/gm, '• ')
    return h.replace(/\n/g, '<br>')
  }).join('')
}

// ---------- state ----------
let L = null
const S = {
  view: 'boot', tab: 'chat', device: null, ppk: '', psk: '',
  conn: 'offline', host: '', models: [], projects: [], tasks: [], sas: '', pairErr: '',
  agents: lsGet('trl.agents', []), gate: lsGet('trl.gate', null), pc: '', themeMode: lsGet('trl.themeMode', 'dark'), pal: lsGet('trl.pal', 'default'), sched: null, todo: lsGet('trl.todo', null), todoDraft: '', todoFilter: 'open', report: null, agentOpen: '', schedOpen: '', rperiod: '30', activeProject: null, feed: lsGet('trl.feed', []), feedLast: lsGet('trl.feedLast', 0), feedSeen: lsGet('trl.feedSeen', 0), feedOpen: 0, agView: 'list', tgQuiet: lsGet('trl.tgq', null),
  agentOut: Object.fromEntries(Object.entries(lsGet('trl.agentout', {})).map(([k, v]) => [k, { ...v, running: false }])),
  mode: lsGet('trl.mode', { kind: 'free' }), project: lsGet('trl.project', null),
  convs: lsGet('trl.convs', []), cur: lsGet('trl.cur', null),
  pending: new Map(), atts: [], recording: null, approval: null, sheet: null, keepAlive: lsGet('trl.keepalive', true)
}
const saveConvs = () => { lsSet('trl.convs', S.convs.slice(0, 40).map((c) => ({ ...c, msgs: c.msgs.slice(-120) }))); lsSet('trl.cur', S.cur) }
const VC = { get S() { return S }, esc, md, fmtDur, version: VERSION }
const curConv = () => { let c = S.convs.find((x) => x.id === S.cur); if (!c) { c = { id: 'c' + rid(), title: 'محادثة جديدة', msgs: [], at: Date.now() }; S.convs.unshift(c); S.cur = c.id; saveConvs() } return c }

function toast(t) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d)
  setTimeout(() => d.remove(), 2600)
}
async function notify(title, body) {
  if (!document.hidden) return
  try { await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title, body: String(body).slice(0, 160) }] }) } catch { /* no permission */ }
}

// ---------- connection to the desktop (encrypted; relay only forwards) ----------
const conn = { ws: null, link: null, timer: null, retry: 0, lastRx: 0, hb: null, gen: 0 }
const openWs = (url, room, role, ms = 5000) => new Promise((resolve, reject) => {
  let ws
  try { ws = new WebSocket(`${url}?room=${encodeURIComponent(room)}&role=${role}`) } catch (e) { return reject(e) }
  const t = setTimeout(() => { try { ws.close() } catch { /* */ } reject(new Error('timeout')) }, ms)
  ws.onopen = () => { clearTimeout(t); ws.onerror = null; resolve(ws) }
  ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')) }
})
async function dial(urls, room, role) {
  for (const u of urls) { try { return await openWs(u, room, role) } catch { /* try next address */ } }
  throw new Error('no route')
}
function setConn(s) { if (S.conn !== s) { S.conn = s; updateDot(); if (S.view === 'main' && S.tab === 'more') renderPage(); if (s !== 'online' && s !== 'connecting' && S.gate && S.tab === 'agents') pcStatus() } }
function updateDot() {
  const d = $('#dot'); if (!d) return
  d.className = 'dot ' + (S.conn === 'online' ? 'on' : S.conn === 'offline' ? '' : 'wait')
  const t = $('#connTxt'); if (t) t.textContent = ({ online: 'متصل', connecting: 'عم يتصل…', hostdown: 'الكمبيوتر مو متصل', offline: 'غير متصل' })[S.conn] || ''
  const b = $('#send'); if (b) b.disabled = false // offline messages go to the queue
  const qn = getQ().length
  if (t && qn) t.textContent += ' · ' + qn + ' برسالة بالانتظار'
}
function scheduleRetry() {
  if (conn.timer || !S.device) return
  const wait = Math.min(15000, 800 * 2 ** Math.min(conn.retry++, 5))
  conn.timer = setTimeout(() => { conn.timer = null; connect() }, wait)
}
async function connect() {
  if (!S.device || conn.ws) return
  setConn('connecting')
  const gen = ++conn.gen
  let ws
  try { ws = await dial(S.device.urls, S.device.room, 'guest') } catch { setConn('offline'); if (conn.recon) { conn.recon = false; toast('ما قدرت أتصل، عم يعيد المحاولة') } return scheduleRetry() }
  if (gen !== conn.gen) { try { ws.close() } catch { /* */ } return }
  conn.ws = ws
  conn.lastRx = Date.now()
  const link = new GuestLink({
    sodium, ppk: S.ppk, psk: S.psk, name: S.device.me, mode: 'device', device: { dpk: S.device.dpk, room: S.device.room },
    send: (f) => { if (ws.readyState === 1) ws.send(f) },
    onReady: () => { conn.retry = 0; setConn('online'); if (conn.recon) { conn.recon = false; toast('متصل ✅') }; link.send({ k: 'hello' }); link.send({ k: 'agents.get' }); link.send({ k: 'sched.get' }); link.send({ k: 'todo.get' }); setTimeout(flushQueue, 400) },
    onMessage: (m) => onHost(m),
    onPeer: (up) => setConn(up ? 'connecting' : 'hostdown')
  })
  conn.link = link
  ws.onmessage = (e) => { conn.lastRx = Date.now(); link.receive(String(e.data)) }
  ws.onclose = () => { if (conn.ws === ws) { conn.ws = null; conn.link = null } setConn('offline'); scheduleRetry() }
  setConn('hostdown')
}
function dropConn() {
  conn.gen++
  clearTimeout(conn.timer); conn.timer = null
  try { conn.ws && conn.ws.close() } catch { /* */ }
  conn.ws = null; conn.link = null
  setConn('offline')
}
const sendHost = (m) => (conn.link && conn.link.isReady ? conn.link.send(m) : false)
function startHeartbeat() {
  if (conn.hb) return
  conn.hb = setInterval(() => {
    if (!conn.ws) return
    if (conn.link && conn.link.isReady) { sendHost({ k: 'ping' }); if (Date.now() - conn.lastRx > 60000) { try { conn.ws.close() } catch { /* */ } } }
  }, 20000)
}
const wake = () => { if (S.device && !conn.ws) { conn.retry = 0; clearTimeout(conn.timer); conn.timer = null; connect() } }

// ---------- messages from the desktop ----------
const fileWait = new Map()
function onHost(m) {
  switch (m.k) {
    case 'state':
      S.models = m.models || []; S.projects = m.projects || []; S.host = m.host || S.host; S.activeProject = m.activeProject || null
      if (Array.isArray(m.urls) && m.urls.length && S.device) { const merged = [...new Set([...m.urls, ...S.device.urls])].slice(0, 8); if (merged.join() !== S.device.urls.join()) { S.device.urls = merged; lsSet('trl.device', S.device) } }
      if (S.project && S.projects.find((p) => p.id === S.project && p.confidential)) { S.project = null; lsSet('trl.project', null) }
      if (S.view === 'main') { renderHeader(); if (S.sheet) renderSheet(); if (S.tab === 'more' || S.tab === 'proj') renderPage() }
      return
    case 'tasks': S.tasks = m.list || []; if (S.view === 'main') { renderTabs(); if (S.tab === 'agents' && !document.activeElement.matches('textarea')) renderPage() } return
    case 'agents': S.agents = m.list || []; lsSet('trl.agents', S.agents); if (m.gate && m.gate.url && m.gate.key) { S.gate = m.gate; lsSet('trl.gate', m.gate) } if (S.tab === 'agents') renderPage(); return
    case 'todo': S.todo = Array.isArray(m.list) ? m.list : []; lsSet('trl.todo', S.todo); if (S.tab === 'todo' && !(document.activeElement && document.activeElement.id === 'todoIn')) renderPage(); return
    case 'sched': S.sched = m.list || []; if (S.tab === 'sched') renderPage(); return
    case 'report': S.report = m.rows || []; if (S.tab === 'report') renderPage(); return
    case 'prog': { const p = S.pending.get(m.id); if (p) { p.status = m.text; if (p.agent) agProg(p); else renderStatus() } return }
    case 'stream': {
      const p = S.pending.get(m.id); if (!p) return
      if (m.kind === 'reset') p.buf = ''; else p.buf += m.text || ''
      if (p.agent) return agStream(p)
      renderLast(); return
    }
    case 'done': return onDone(m)
    case 'approval': return showApproval(m)
    case 'approval.cancel': if (S.approval && S.approval.id === m.id) { S.approval = null; renderApproval(); toast('اتجاوب عالكمبيوتر') } return
    case 'file.ok': case 'file.err': { const w = fileWait.get(m.fid); if (w) { fileWait.delete(m.fid); m.k === 'file.ok' ? w.res(m.att) : w.rej(new Error(m.error || 'فشل')) } return }
    case 'loc.req': return answerLoc(m)
    case 'revoked': return wipeDevice('الكمبيوتر شال هالجهاز.')
    case 'error': toast(m.text || 'خطأ'); return
  }
}
// The computer asked for one GPS fix (only happens when the user asked something like "near me" and enabled the location tools).
function answerLoc(m) {
  const fail = (why) => sendHost({ k: 'loc.res', id: m.id, err: why })
  if (!navigator.geolocation) return fail('no geolocation in this app')
  const ok = (p) => sendHost({ k: 'loc.res', id: m.id, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy })
  const why = (e) => (e && e.code === 1 ? 'location permission denied: allow Location for TRL Agent in Android settings' : e && e.code === 3 ? 'GPS timed out' : e && e.message ? e.message : 'unknown')
  // High accuracy first (the permission prompt can take a while), then a coarse network fix as a fallback.
  navigator.geolocation.getCurrentPosition(
    ok,
    (e1) => {
      if (e1 && e1.code === 1) return fail(why(e1))
      navigator.geolocation.getCurrentPosition(ok, (e2) => fail(why(e2)), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
    },
    { enableHighAccuracy: true, timeout: 25000, maximumAge: 60000 }
  )
}

function onDone(m) {
  const p = S.pending.get(m.id)
  S.pending.delete(m.id)
  if (p && p.agent) return agDone(m, p)
  const c = S.convs.find((x) => x.id === (p ? p.conv : m.tab)) || null
  if (!c) return
  if (m.id && c.msgs.some((x) => x.did === m.id)) return // already shown (late replay after a reconnect)
  if (m.cancelled) { c.msgs.push({ role: 'bot', content: p && p.buf ? p.buf : '', meta: 'انلغى', at: Date.now(), cancelled: true }) }
  else c.msgs.push({ role: 'bot', content: m.content || '', meta: m.meta || '', failed: !!m.failed, did: m.id, at: Date.now() })
  if (!c.title || c.title === 'محادثة جديدة') { const u = c.msgs.find((x) => x.role === 'user'); if (u) c.title = u.content.slice(0, 40) }
  saveConvs()
  if (c.id === S.cur) { renderMsgs(); renderStatus(); renderSend() }
  notify(m.failed ? 'ما خلصت المهمة' : 'خلص الجواب', m.content || '')
  try { navigator.vibrate && navigator.vibrate(60) } catch { /* */ }
}

// ---------- approvals (signed with the phone's identity key) ----------
function showApproval(m) {
  S.approval = { id: m.id, title: String(m.title || ''), detail: String(m.detail || ''), danger: !!m.danger, exp: Number(m.exp) || Date.now() + 60000 }
  renderApproval()
  notify(m.danger ? 'طلب موافقة (أمر خطير)' : 'طلب موافقة', m.title)
  try { navigator.vibrate && navigator.vibrate([120, 60, 120]) } catch { /* */ }
}
function answerApproval(ok) {
  const a = S.approval; if (!a) return
  const hash = approvalHash(L, a.title, a.detail) // the hash of what the user actually saw
  const sig = L.sign(S.psk, approvalMsg(L, a.id, hash, ok, a.exp))
  sendHost({ k: 'approve', id: a.id, ok, sig })
  S.approval = null; renderApproval()
  toast(ok ? 'تمت الموافقة' : 'تم الرفض')
}

// ---------- chat ----------
async function sendChat() {
  const ta = $('#ta'); if (!ta) return
  const text = ta.value.trim()
  if (S.running) return stopChat()
  if (!text && !S.atts.length) return
  const offline = S.conn !== 'online'
  if (offline && S.atts.length) return toast('المرفقات بدها اتصال بالكمبيوتر. اكتب النص بس وبينبعت لما يتصل')
  if (S.atts.some((a) => !a.fid)) return toast('استنى لحد ما يخلص رفع الملفات')
  const c = curConv()
  if (offline) {
    // Offline: keep the message on the phone and send it, in order, when the computer is reachable again.
    const qid = rid()
    c.msgs.push({ role: 'user', content: text, qid, queued: true, at: Date.now() })
    queueAdd({ id: qid, conv: c.id, text, project: S.project, mode: S.mode, at: Date.now() })
    ta.value = ''; ta.style.height = 'auto'
    saveConvs(); toast('انحفظت. بتنبعت لما يتصل الكمبيوتر'); updateDot(); renderMsgs(); renderSend()
    return
  }
  const hist = c.msgs.filter((x) => x.content && !x.failed).slice(-12).map((x) => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.content }))
  const id = rid()
  const attNames = S.atts.map((a) => a.name)
  c.msgs.push({ role: 'user', content: text || '(مرفقات)', atts: attNames, at: Date.now() })
  S.pending.set(id, { conv: c.id, buf: '', status: 'عم يرسل…' })
  const atts = S.atts.map((a) => a.fid)
  const msg = { k: 'chat', id, text: text || 'شوف الملفات المرفقة', tab: c.id, project: S.project, mode: S.mode, hist, atts }
  S.atts = []; ta.value = ''; ta.style.height = 'auto'
  saveConvs()
  if (!sendHost(msg)) { S.pending.delete(id); toast('انقطع الاتصال'); }
  renderMsgs(); renderAtts(); renderStatus(); renderSend()
}
// ---------- agents / schedules / reports ----------
const saveAgOut = () => lsSet('trl.agentout', Object.fromEntries(Object.entries(S.agentOut).map(([k, v]) => [k, { task: v.task, out: String(v.out || '').slice(0, 6000), at: v.at, failed: v.failed }])))
function runAgentNow(id) {
  const ta = $('#agTask'); const task = (ta ? ta.value : '').trim()
  if (!task) return toast('اكتب المهمة أول')
  if (/^\/status\b/i.test(task)) {
    // same as /status on Telegram: show whether the PC is online, don't run it as a task
    S.agentOut[id] = { task, out: S.conn === 'online' ? '🟢 الكمبيوتر شغّال.' : '⏳ عم أفحص حالة الكمبيوتر…', at: Date.now(), running: false }
    renderPage()
    if (S.conn !== 'online') { pcAt = 0; void pcStatus().then(() => { S.agentOut[id].out = S.pc === 'on' ? '🟡 الكمبيوتر شغّال بس التلفون مو واصلو مباشرة.' : S.pc === 'off' ? '🔴 الكمبيوتر مطفي أو التطبيق مسكّر.' : '⚪ ما قدرت أفحص (البوابة مو مفعّلة أو ما في نت).'; renderPage() }) }
    return
  }
  const r = rid()
  const st = S.agentOut[id] = { task, out: '', at: Date.now(), running: true, status: 'عم يرسل…' }
  const ag = S.agents.find((x) => x.id === id)
  // an agent set to «cloud only» always runs on the cloud runner, even while the PC is on (the PC refuses it)
  if (ag && ag.runOn === 'cloud' && S.gate) { st.status = 'عم يبعت للبوابة…'; saveAgOut(); renderPage(); void gateRun(id, task, true); return }
  S.pending.set(r, { agent: id, buf: '', status: st.status })
  if (!sendHost({ k: 'agent.run', id: r, agent: id, task, project: S.project, mode: S.mode })) {
    S.pending.delete(r)
    // PC not reachable from the phone: same routing as Telegram, through the gate (cloud runner when the PC is off)
    if (S.gate) { st.status = 'عم يبعت للبوابة…'; saveAgOut(); renderPage(); void gateRun(id, task); return }
    st.running = false; toast('الكمبيوتر مو متصل هلأ وما في بوابة سحابية مفعّلة')
  }
  saveAgOut(); renderPage()
}
async function gateCall(path, body) {
  const g = S.gate
  if (!g) return null
  try {
    const r = await fetch(g.url + path, { method: body ? 'POST' : 'GET', headers: { 'x-phone-key': g.key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  } catch { return null }
}
// Results feed from the gate: every finished agent run (scheduled or manual, cloud or PC) shows up here, no Telegram needed.
let feedBusy = false
async function feedPoll() {
  if (!S.gate || feedBusy) return
  feedBusy = true
  try {
    if (S.tgQuiet === null) { const p = await gateCall('/prefs'); if (p && p.ok) { S.tgQuiet = !!p.tgQuiet; lsSet('trl.tgq', S.tgQuiet) } }
    const r = await gateCall('/feed?after=' + S.feedLast)
    if (!r || !r.ok) return
    const items = Array.isArray(r.items) ? r.items : []
    if (Number(r.last) < S.feedLast) { S.feed = []; S.feedLast = 0; S.feedSeen = 0 }
    const first = S.feedLast === 0 && !S.feed.length
    if (items.length) {
      const mine = new Set(Object.values(S.agentOut).map((x) => x && x.job).filter(Boolean))
      S.feed = [...S.feed, ...items].slice(-50)
      if (!first) for (const it of items) if (!mine.has(it.job)) notify((it.agent || 'مهمة') + (it.kind === 'fail' ? ': ما خلصت' : ': خلص'), it.text || '')
    }
    S.feedLast = Number(r.last) || S.feedLast
    if (first || (S.tab === 'agents' && S.agView === 'feed')) S.feedSeen = S.feedLast
    lsSet('trl.feed', S.feed); lsSet('trl.feedLast', S.feedLast); lsSet('trl.feedSeen', S.feedSeen)
    if (S.view === 'main') { renderTabs(); if (S.tab === 'agents' && !(document.activeElement && document.activeElement.matches('textarea'))) renderPage() }
  } finally { feedBusy = false }
}
let pcAt = 0
async function pcStatus() {
  if (Date.now() - pcAt < 15000) return
  pcAt = Date.now()
  const r = await gateCall('/status')
  S.pc = r && r.ok ? (r.online ? 'on' : 'off') : 'unk'
  if (S.tab === 'agents') renderPage()
}
async function gateRun(id, task, force) {
  const a = S.agents.find((x) => x.id === id)
  const st = S.agentOut[id] || (S.agentOut[id] = {})
  const r = await gateCall('/run', { agent: a ? a.name : '', task, force: force ? 'cloud' : undefined })
  st.at = Date.now(); st.failed = false; st.stale = false
  if (!r) { st.running = false; st.failed = true; st.out = 'ما قدرت أوصل للبوابة. تأكد من النت.' }
  else if (r.status === 200 && r.ok && r.where !== 'none' && r.job) {
    st.running = true; st.job = r.job; st.where = r.where; st.task = task; st.polling = true; st.t0 = Date.now(); st.seen = 0
    st.status = r.where === 'cloud' ? '☁️ عم يشتغل عالكمبيوتر السحابي…' : '📥 وصلت المهمة للكمبيوتر، عم ينتظر…'
    void gatePoll(id, r.job)
  } else if (r.status === 200 && r.ok) {
    st.running = false; st.failed = true
    st.out = '🔴 الكمبيوتر مطفي والوكيل هاد مضبوط يشتغل محلي بس.'
  } else {
    st.running = false; st.failed = true
    st.out = r.error === 'agent not found' ? 'الوكيل مو موجود عالبوابة. افتح تبويب «وكلاء» بالبرنامج وضغط مزامنة.' : r.status === 401 ? 'مفتاح البوابة قديم. وصّل التلفون بالكمبيوتر مرة تانية لتجديدو.' : r.status === 429 ? 'استنى ثانيتين وجرّب.' : r.error === 'local only' ? 'هالوكيل محلي بس.' : 'فشل: ' + (r.error || r.status)
  }
  saveAgOut(); renderPage()
}
// Follow a gate job: progress text, final result, and approval requests (replaces Telegram)
async function gatePoll(id, job) {
  const st = S.agentOut[id]
  const end = Date.now() + 25 * 60 * 1000
  while (st && st.polling && st.job === job && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 3000))
    if (!st.polling || st.job !== job) return
    const r = await gateCall('/result/' + job)
    const ev = r && r.ok ? r.events || [] : []
    if (ev.length) st.seen = ev.length
    const say = [...ev].reverse().find((e) => e.kind === 'say')
    if (say) st.status = say.text
    const fin = ev.find((e) => e.kind === 'done' || e.kind === 'fail')
    if (fin) {
      st.polling = false; st.running = false; st.failed = fin.kind === 'fail'; st.out = fin.text; st.at = Date.now(); st.stale = false
      S.approvals = (S.approvals || []).filter((x) => x.job !== job)
      saveAgOut(); renderPage()
      notify((S.agents.find((x) => x.id === id) || {}).name + (st.failed ? ': ما خلصت' : ': خلص'), fin.text || '')
      try { navigator.vibrate && navigator.vibrate(60) } catch { /* */ }
      return
    }
    const ap = await gateCall('/approvals')
    S.approvals = ap && ap.ok ? ap.items || [] : S.approvals
    st.stale = st.where === 'pc' && !ev.length && Date.now() - st.t0 > 45000
    if (S.tab === 'agents') renderPage()
  }
  if (st && st.polling && st.job === job) { st.polling = false; st.running = false; st.failed = true; st.out = 'انتهى وقت الانتظار بدون نتيجة.'; saveAgOut(); renderPage() }
}
function agProg(p) { const st = S.agentOut[p.agent]; if (!st) return; st.status = p.status; const el = $('#agStatus'); if (el) el.innerHTML = '<span class="spin"></span> ' + esc(p.status || 'عم يشتغل…') }
function agStream(p) { const el = $('#agOut'); if (el && S.agentOpen === p.agent) el.innerHTML = '<div class="msg bot">' + (p.buf ? md(p.buf) : '<span class="mut">…</span>') + '</div>' }
function agDone(m, p) {
  const st = S.agentOut[p.agent] || (S.agentOut[p.agent] = {})
  st.running = false; st.failed = !!m.failed; st.at = Date.now()
  st.out = m.cancelled ? (p.buf || '') + '\n(انلغى)' : (m.content || '')
  saveAgOut()
  if (S.tab === 'agents') renderPage()
  const a = S.agents.find((x) => x.id === p.agent)
  notify((a ? a.name : 'الوكيل') + (m.failed ? ': ما خلصت' : ': خلص'), m.content || '')
  try { navigator.vibrate && navigator.vibrate(60) } catch { /* */ }
}
function openTab(id) {
  S.tab = id; renderTabs(); renderPage()
  if (id === 'agents') { sendHost({ k: 'agents.get' }); if (S.gate && S.conn !== 'online') pcStatus() }
  else if (id === 'sched') sendHost({ k: 'sched.get' })
  else if (id === 'report') sendHost({ k: 'report.get' })
}
function viewClick(t) {
  const d = t.dataset
  if (d.tab) { openTab(d.tab); return true }
  if (d.tdadd) {
    const el = $('#todoIn'); const text = el ? el.value.trim() : ''
    if (!text) return true
    if (!sendHost({ k: 'todo.add', text })) { toast('وصّل بالكمبيوتر أول عشان تنضاف'); return true }
    S.todoDraft = ''; if (el) el.value = ''
    return true
  }
  if (d.tdtog || d.tddel) { if (!sendHost({ k: d.tdtog ? 'todo.toggle' : 'todo.del', id: d.tdtog || d.tddel })) toast('وصّل بالكمبيوتر أول'); return true }
  if (d.tdclear) { if (!sendHost({ k: 'todo.clear' })) toast('وصّل بالكمبيوتر أول'); return true }
  if (d.tdf) { S.todoFilter = d.tdf; renderPage(); return true }
  if (d.refresh) { sendHost({ k: d.refresh + '.get' }); toast('عم يحدّث…'); return true }
  if (d.agopen !== undefined) { S.agentOpen = S.agentOpen === d.agopen ? '' : d.agopen; renderPage(); return true }
  if (d.agview) { S.agView = d.agview; if (d.agview === 'feed') { S.feedSeen = S.feedLast; lsSet('trl.feedSeen', S.feedSeen); void feedPoll() } renderTabs(); renderPage(); return true }
  if (d.feedopen !== undefined) { const n = Number(d.feedopen); S.feedOpen = S.feedOpen === n ? 0 : n; renderPage(); return true }
  if (d.tgq) { const v = S.tgQuiet !== true; S.tgQuiet = v; lsSet('trl.tgq', v); renderPage(); void gateCall('/prefs', { tgQuiet: v }).then((r) => { if (!r || !r.ok) { S.tgQuiet = !v; lsSet('trl.tgq', !v); renderPage(); toast('ما قدرت أغيّر الإعداد') } else toast(v ? 'تيليغرام انسكّر، النتائج هون بس' : 'تيليغرام رجع شغّال') }); return true }
  if (d.stopall) { void gateCall('/stop', {}).then((r) => toast(r && r.ok ? 'انبعت الإيقاف (سحابي انلغى: ' + (r.cancelled || 0) + ')' : 'ما قدرت أوصل للبوابة')); return true }
  if (d.feedclear) { S.feed = []; lsSet('trl.feed', []); renderTabs(); renderPage(); return true }
  if (d.agrun) { runAgentNow(d.agrun); return true }
  if (d.agstop) {
    const gs = S.agentOut[d.agstop]
    if (gs && gs.polling) { gs.polling = false; gs.running = false; gs.out = 'وقّفت المتابعة (المهمة ممكن تكمّل بالخلفية).'; saveAgOut(); renderPage() } else { sendHost({ k: 'cancel', tab: 'agent-' + d.agstop }); toast('طلبت الإيقاف') }
    return true
  }
  if (d.agcloud) {
    const cs = S.agentOut[d.agcloud]
    if (cs) { cs.polling = false; cs.status = 'عم يبعتها للسحابة…'; saveAgOut(); renderPage(); void gateRun(d.agcloud, cs.task, true) }
    return true
  }
  if (d.apv) {
    const [aid, v] = d.apv.split('|')
    S.approvals = (S.approvals || []).filter((x) => x.id !== aid)
    renderPage()
    void gateCall('/approval/' + aid, { v: Number(v) }).then((r) => { if (!r || !r.ok) toast('ما انرسل الرد، جرّب مرة تانية') })
    return true
  }
  if (d.sopen !== undefined) { S.schedOpen = S.schedOpen === d.sopen ? '' : d.sopen; renderPage(); return true }
  if (d.srun) { sendHost({ k: 'sched.run', id: d.srun }); toast('بلّشت المهمة'); return true }
  if (d.rperiod) { S.rperiod = d.rperiod; renderPage(); return true }
  if (d.projdesk) { sendHost({ k: 'project.set', id: d.projdesk }); toast('انفعّل عالكمبيوتر'); return true }
  if (d.themeMode) { S.themeMode = d.themeMode; lsSet('trl.themeMode', S.themeMode); applyTheme(); renderPage(); return true }
  if (d.pal) { S.pal = d.pal; lsSet('trl.pal', S.pal); applyTheme(); renderTabs(); renderPage(); return true }
  if (d.proj !== undefined) {
    const p = S.projects.find((x) => x.id === d.proj)
    if (p && p.confidential) { toast('🔒 مشروع سري، ما بينفتح من الموبايل'); return true }
    S.project = d.proj || null; lsSet('trl.project', S.project); renderHeader(); renderPage(); return true
  }
  return false
}

// ---------- offline queue ----------
const QUEUE_TTL = 60 * 60 * 1000 // older than 1 hour: ask before sending
const getQ = () => lsGet('trl.queue', [])
const queueAdd = (it) => { const q = getQ(); q.push(it); lsSet('trl.queue', q.slice(-50)) }
function flushQueue() {
  const q = getQ()
  if (!q.length || !conn.link || !conn.link.isReady) return
  const stale = q.filter((x) => Date.now() - x.at > QUEUE_TTL).length
  const sendStale = stale ? confirm('في ' + stale + ' رسالة بالانتظار أقدم من ساعة. تبعتها هلأ؟ (إلغاء = بتنحذف)') : false
  const rest = []
  for (const it of q) {
    const c = S.convs.find((x) => x.id === it.conv)
    const idx = c ? c.msgs.findIndex((x) => x.qid === it.id) : -1
    const m = idx >= 0 ? c.msgs[idx] : null
    if (Date.now() - it.at > QUEUE_TTL && !sendStale) { if (m) { m.queued = false; m.expired = true } continue }
    const hist = c ? c.msgs.slice(0, Math.max(idx, 0)).filter((x) => x.content && !x.failed && !x.queued && !x.expired).slice(-12).map((x) => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.content })) : []
    const msg = { k: 'chat', id: it.id, text: it.text, tab: it.conv, project: it.project, mode: it.mode, hist, atts: [], qAge: Math.max(1, Math.round((Date.now() - it.at) / 60000)) }
    if (sendHost(msg)) { S.pending.set(it.id, { conv: it.conv, buf: '', status: 'عم يرسل…' }); if (m) m.queued = false } else rest.push(it)
  }
  lsSet('trl.queue', rest)
  saveConvs(); updateDot(); renderMsgs(); renderStatus(); renderSend()
}

function stopChat() { const c = curConv(); sendHost({ k: 'cancel', tab: c.id }) }
const isRunning = () => [...S.pending.values()].some((p) => p.conv === S.cur)

function renderSend() {
  S.running = isRunning()
  const b = $('#send'); if (!b) return
  b.className = 'send' + (S.running ? ' stop' : ''); b.innerHTML = S.running ? '■' : '➤'; b.disabled = false
  updateDot()
}
function renderStatus() {
  const el = $('#status'); if (!el) return
  const p = [...S.pending.values()].find((x) => x.conv === S.cur)
  el.innerHTML = p ? '<span class="spin"></span> ' + esc(p.status || 'عم يشتغل…') : ''
}
function msgHtml(m, i) {
  if (m.role === 'user') return '<div class="msg user" data-mi="' + i + '">' + esc(m.content).replace(/\n/g, '<br>') + (m.atts && m.atts.length ? '<div class="meta">📎 ' + m.atts.map(esc).join(' · ') + '</div>' : '') + (m.queued ? '<div class="meta">⏳ بانتظار الكمبيوتر…</div>' : '') + (m.expired ? '<div class="meta">⚠️ ما انبعتت (قديمة)</div>' : '') + '</div>'
  const model = (String(m.meta || '').match(/Model: ([^|]+?)(?: \||$)/) || [])[1]
  return '<div class="msg bot' + (m.failed ? ' err' : '') + '">' + md(m.content) + (model || m.cancelled ? '<div class="meta">' + esc(model || m.meta || '') + '</div>' : '') + '</div>'
}
function renderMsgs(stick = true) {
  const el = $('#msgs'); if (!el) return
  const c = curConv()
  const p = [...S.pending.values()].find((x) => x.conv === c.id)
  const empty = !c.msgs.length && !p
  el.innerHTML = empty ? '<div class="mut" style="margin:auto;text-align:center;padding:30px">اكتب سؤالك أو ابعت ملف. كل شي بيتنفذ على كمبيوترك.</div>' : c.msgs.map((m, i) => msgHtml(m, i)).join('') + (p ? '<div class="msg bot" id="live">' + (p.buf ? md(p.buf) : '<span class="mut">…</span>') + '</div>' : '')
  if (stick) el.scrollTop = el.scrollHeight
}
function renderLast() {
  const live = $('#live'); const p = [...S.pending.values()].find((x) => x.conv === S.cur)
  if (!live || !p) return renderMsgs()
  live.innerHTML = p.buf ? md(p.buf) : '<span class="mut">…</span>'
  const el = $('#msgs'); if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
}
function renderAtts() {
  const el = $('#atts'); if (!el) return
  el.innerHTML = S.atts.map((a, i) => '<div class="att">' + (a.fid ? '📎' : '<span class="spin"></span>') + ' ' + esc(a.name) + (a.pct != null && !a.fid ? ' ' + a.pct + '%' : '') + ' <button data-rm="' + i + '">✕</button></div>').join('')
}

// ---------- files / voice ----------
const CH = 128 * 1024
async function uploadFile(file, entry) {
  const fid = rid()
  if (!sendHost({ k: 'file.begin', fid, name: file.name || 'file', size: file.size })) throw new Error('مو متصل')
  const buf = new Uint8Array(await file.arrayBuffer())
  for (let o = 0, n = 0; o < buf.length; o += CH, n++) {
    const part = buf.subarray(o, o + CH)
    if (!sendHost({ k: 'file.chunk', fid, i: n, d: sodium.to_base64(part, sodium.base64_variants.ORIGINAL) })) throw new Error('انقطع الاتصال')
    entry.pct = Math.min(99, Math.round(((o + CH) / buf.length) * 100)); renderAtts()
    while (conn.ws && conn.ws.bufferedAmount > 1_500_000) await sleep(30)
    if (n % 4 === 3) await sleep(0)
  }
  const done = new Promise((res, rej) => { fileWait.set(fid, { res, rej }); setTimeout(() => { if (fileWait.delete(fid)) rej(new Error('انتهت المهلة')) }, 120000) })
  sendHost({ k: 'file.end', fid, project: S.project })
  const att = await done
  return { fid, att }
}
async function addFile(file, { voice = false } = {}) {
  if (file.size > 30 * 1024 * 1024) return toast('الملف أكبر من 30MB')
  if (S.conn !== 'online') return toast('مو متصل بالكمبيوتر')
  const entry = { name: file.name || 'file', fid: null, pct: 0 }
  S.atts.push(entry); renderAtts()
  try {
    const r = await uploadFile(file, entry)
    if (voice) {
      S.atts = S.atts.filter((x) => x !== entry)
      const t = (r.att.preview || '').trim(); const ta = $('#ta')
      if (t && ta) { ta.value = (ta.value ? ta.value + ' ' : '') + t; ta.dispatchEvent(new Event('input')) } else toast(r.att.note || 'ما قدرت أفرّغ الصوت (لازم Whisper عالكمبيوتر)')
    } else { entry.fid = r.fid; entry.pct = 100 }
  } catch (e) { S.atts = S.atts.filter((x) => x !== entry); toast('فشل رفع ' + entry.name + ': ' + e.message) }
  renderAtts()
}
async function toggleRec() {
  if (S.recording) { S.recording.stop(); return }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks = []; const mr = new MediaRecorder(stream)
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); S.recording = null; renderRec(); const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }); if (blob.size > 800) addFile(new File([blob], 'voice-' + Date.now() + '.webm', { type: blob.type }), { voice: true }) }
    mr.start(); S.recording = mr; renderRec()
  } catch { toast('ما قدرت أفتح المايك (تأكد من الإذن)') }
}
function renderRec() { const b = $('#mic'); if (b) { b.classList.toggle('rec', !!S.recording); b.textContent = S.recording ? '⏹' : '🎙️' } }

// ---------- pairing ----------
function parseQr(text) {
  const t = String(text || '').trim()
  if (!t.startsWith('TRLR1:')) throw new Error('هاد مو QR تبع البرنامج')
  const b64 = t.slice(6).replace(/-/g, '+').replace(/_/g, '/')
  const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  const q = JSON.parse(json)
  if (q.v !== 1 || !Array.isArray(q.u) || !q.room || !q.dpk || !q.s) throw new Error('QR تالف')
  return q
}
async function startPair(text) {
  let q
  try { q = parseQr(text) } catch (e) { return pairFail(e.message) }
  S.view = 'pairing'; S.sas = ''; S.pairErr = ''; render()
  const id = L.newIdentity()
  let model = 'Android'
  try { model = (await AirNative.info()).model || model } catch { /* */ }
  let ws
  try { ws = await dial(q.u.length ? q.u : [], q.room, 'guest') } catch { return pairFail('ما قدرت أوصل للكمبيوتر. تأكد إنو التلفون عالـ Wi-Fi نفسو وإنو الربط مفعّل بالبرنامج.') }
  let done = false
  const t = setTimeout(() => { if (!done && !S.sas) { try { ws.close() } catch { /* */ } pairFail('البرنامج ما رد. اعمل QR جديد وجرب.') } }, 20000)
  const g = new GuestLink({
    sodium, ppk: id.pk, psk: id.sk, name: String(model).slice(0, 50), mode: 'pair', qr: q,
    send: (f) => { if (ws.readyState === 1) ws.send(f) },
    onSas: (s) => { S.sas = s; render() },
    onDenied: () => { done = true; clearTimeout(t); try { ws.close() } catch { /* */ } pairFail('الكمبيوتر رفض الربط.') },
    onReady: async () => {
      done = true; clearTimeout(t)
      const dev = { dpk: q.dpk, room: L.roomOf(q.dpk, id.pk), urls: q.u, name: q.name || 'الكمبيوتر', me: String(model).slice(0, 50) }
      await AirNative.secureSet({ key: 'psk', value: id.sk })
      lsSet('trl.device', dev); lsSet('trl.ppk', id.pk)
      S.device = dev; S.ppk = id.pk; S.psk = id.sk; S.host = dev.name
      try { ws.close() } catch { /* */ }
      S.view = 'main'; S.tab = 'chat'; render(); connect()
      LocalNotifications.requestPermissions().catch(() => {})
      applyKeepAlive()
    },
    onMessage: () => {}
  })
  ws.onmessage = (e) => g.receive(String(e.data))
  ws.onclose = () => { if (!done && S.view === 'pairing' && !S.sas) pairFail('انقطع الاتصال.') }
}
function pairFail(msg) { S.view = 'pair'; S.pairErr = msg; render() }
async function wipeDevice(msg) {
  dropConn()
  try { await AirNative.secureDelete({ key: 'psk' }) } catch { /* */ }
  try { await AirNative.stopKeepAlive() } catch { /* */ }
  localStorage.removeItem('trl.device'); localStorage.removeItem('trl.ppk')
  S.device = null; S.ppk = S.psk = ''; S.models = []; S.tasks = []
  S.view = 'pair'; S.pairErr = msg || ''; render()
}
function applyKeepAlive() { try { S.keepAlive ? AirNative.startKeepAlive() : AirNative.stopKeepAlive() } catch { /* */ } }

// ---------- QR scanner ----------
let scanStream = null
let scanning = false
async function openScanner() {
  S.view = 'scan'; render()
  const video = $('#vid'); if (!video) return
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
    video.srcObject = scanStream; await video.play()
    try { await scanStream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* not supported */ }
  } catch { S.view = 'pair'; S.pairErr = 'ما قدرت أفتح الكاميرا. اسمح بالإذن، أو الصق رمز الـ QR كنص.'; render(); return }
  scanning = true
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let bd = null
  try { if ('BarcodeDetector' in window) bd = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch { bd = null }
  const hit = (data) => { if (data && data.startsWith('TRLR1:')) { stopScanner(); startPair(data); return true } return false }
  const tick = async () => {
    if (!scanning) return
    if (video.videoWidth) {
      try {
        if (bd) { const codes = await bd.detect(video); for (const c of codes) if (hit(c.rawValue)) return }
      } catch { /* fall through to jsQR */ }
      if (!scanning) return
      // full camera resolution (capped at 1280): dense QR modules need the pixels
      const sc = Math.min(1, 1280 / video.videoWidth); canvas.width = Math.round(video.videoWidth * sc); canvas.height = Math.round(video.videoHeight * sc)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
      if (!r) {
        // second pass at half size: some dense codes read better at lower resolution
        const half = document.createElement('canvas'); half.width = Math.round(canvas.width / 2); half.height = Math.round(canvas.height / 2)
        half.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, half.width, half.height)
        const im2 = half.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, half.width, half.height)
        r = jsQR(im2.data, im2.width, im2.height, { inversionAttempts: 'attemptBoth' })
      }
      if (r && hit(r.data)) return
    }
    setTimeout(tick, 150)
  }
  tick()
}
function stopScanner() { scanning = false; if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null } }

// ---------- rendering ----------
function render() {
  applyTheme()
  const app = $('#app'); if (!app) return
  if (S.view !== 'scan') stopScanner()
  if (S.view === 'boot') { app.innerHTML = '<div class="center"><div class="logo">T</div><div class="spin"></div></div>'; return }
  if (S.view === 'pair') {
    app.innerHTML = '<div class="center"><div class="logo">T</div><h1 style="margin:0">TRL Agent</h1>' +
      '<div class="mut">تحكّم ببرنامجك على الكمبيوتر من التلفون. الاتصال مشفّر من الطرفين.</div>' +
      (S.pairErr ? '<div class="card" style="border-color:var(--dng);width:100%">' + esc(S.pairErr) + '</div>' : '') +
      '<div class="card mut" style="width:100%;text-align:start">1) افتح البرنامج عالكمبيوتر ← الإعدادات ← «تطبيق الموبايل» وفعّل الربط.<br>2) دوس «ربط جهاز جديد» بيطلع QR.<br>3) امسحو من هون.</div>' +
      '<button class="btn" id="scanBtn">📷 مسح QR</button><button class="btn ghost" id="pasteBtn">لصق الرمز كنص</button><div id="pasteBox"></div></div>'
    return
  }
  if (S.view === 'scan') {
    app.innerHTML = '<div class="center"><div class="scan"><video id="vid" playsinline muted></video></div><div class="mut">وجّه الكاميرا عالـ QR اللي ظاهر بالبرنامج</div><button class="btn ghost" id="scanCancel">رجوع</button></div>'
    return
  }
  if (S.view === 'pairing') {
    app.innerHTML = '<div class="center"><div class="logo">T</div>' + (S.sas
      ? '<h2 style="margin:0">تأكد من الرمز</h2><div class="sas">' + esc(S.sas) + '</div><div class="mut">لازم يكون نفس الرمز الظاهر عالكمبيوتر. بعدين دوس «الرمز متطابق» هناك.</div><div class="spin"></div>'
      : '<div class="mut">عم نتصل بالكمبيوتر وبنأمّن الجلسة…</div><div class="spin"></div>') + '<button class="btn ghost" id="pairCancel">إلغاء</button></div>'
    return
  }
  // main
  app.innerHTML = '<div class="top"><span id="dot" class="dot"></span><h1><span id="hostName"></span><div class="mut" id="connTxt" style="font-weight:400;font-size:12px"></div></h1>' +
    '<button class="chip" id="modeBtn"></button><button class="iconbtn" id="newBtn" title="جديدة">＋</button><button class="iconbtn" id="histBtn" title="المحادثات">☰</button></div>' +
    '<div class="main" id="page"></div><div class="tabs" id="tabs"></div><div id="sheetHost"></div><div id="apprHost"></div>'
  renderHeader(); renderTabs(); renderPage(); renderApproval(); updateDot()
}
const modeLabel = () => {
  const m = S.mode
  if (m.kind === 'auto') return 'تلقائي'
  if (m.kind === 'free') return 'مجاني'
  if (m.kind === 'council') return 'council'
  const mm = S.models.find((x) => x.value === m.id); return mm ? mm.label : 'موديل'
}
function renderHeader() {
  const h = $('#hostName'); if (h) h.textContent = S.host || (S.device && S.device.name) || 'TRL'
  const b = $('#modeBtn'); if (b) { const pr = S.project && S.projects.find((x) => x.id === S.project); b.textContent = '⚙ ' + modeLabel() + (pr ? ' · 📁 ' + String(pr.name).slice(0, 12) : '') }
  updateDot()
}
// ---------- theme: light / dark / follow device, plus the optional Syrian identity palette (colors + font + eagle) ----------
const EAGLE = '<img class="eagle" src="syria-eagle.svg" alt="">'
function applyTheme() {
  const light = S.themeMode === 'light' || (S.themeMode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
  const r = document.documentElement
  r.classList.toggle('light', light)
  r.classList.toggle('syrian', S.pal === 'syrian')
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0f1419')
}
function renderTabs() {
  const t = $('#tabs'); if (!t) return
  const n = S.tasks.length + (S.feed || []).filter((x) => x.n > S.feedSeen).length
  t.innerHTML = [['chat', '💬', 'الشات'], ['proj', '📁', 'المشاريع'], ['agents', '🤖', 'الوكلاء'], ['sched', '📅', 'الجدولة'], ['report', '📊', 'التقارير'], ['todo', '📝', 'ملاحظات'], ['more', '⚙️', 'المزيد']].map(([id, i, l]) => '<button data-tab="' + id + '" class="' + (S.tab === id ? 'act' : '') + '"><span class="i">' + (id === 'agents' && S.pal === 'syrian' ? EAGLE : i) + '</span>' + l + (id === 'agents' && n ? '<span class="badge">' + n + '</span>' : '') + '</button>').join('')
}
const lastPage = { tab: '', html: '' }
function renderPage() {
  const p = $('#page'); if (!p) return
  const tdi = $('#todoIn'); if (tdi) S.todoDraft = tdi.value
  const ta0 = $('#agTask'); if (ta0 && S.agentOpen) { const st0 = S.agentOut[S.agentOpen] || (S.agentOut[S.agentOpen] = {}); st0.task = ta0.value }
  const top = document.querySelector('.top'); if (top) top.style.display = S.tab === 'chat' ? 'flex' : 'none'
  if (S.tab === 'chat') {
    p.innerHTML = '<div class="msgs" id="msgs"></div><div class="status" id="status"></div><div class="composer"><div class="atts" id="atts"></div><div class="row">' +
      '<button class="iconbtn" id="attBtn">📎</button><button class="iconbtn" id="camBtn">📷</button><button class="iconbtn" id="mic">🎙️</button>' +
      '<textarea id="ta" rows="1" placeholder="اكتب هون…"></textarea><button class="send" id="send">➤</button></div>' +
      '<input type="file" id="fileIn" multiple hidden><input type="file" id="camIn" accept="image/*" capture="environment" hidden></div>'
    renderMsgs(); renderAtts(); renderStatus(); renderSend(); renderRec()
    lastPage.tab = 'chat'; lastPage.html = ''
  } else {
    const fn = { agents: agentsHtml, sched: schedHtml, report: reportHtml, todo: todoHtml, proj: projHtml, more: moreHtml }[S.tab] || moreHtml
    const html = fn(VC)
    // same tab + same content: leave the DOM alone (no flicker); the fade-in only plays when switching tabs
    if (lastPage.tab === S.tab && lastPage.html === html && p.firstChild) return
    p.innerHTML = '<div class="page' + (lastPage.tab === S.tab ? '' : ' fade') + '">' + html + '</div>'
    lastPage.tab = S.tab; lastPage.html = html
  }
}
function renderApproval() {
  const h = $('#apprHost'); if (!h) return
  const a = S.approval
  if (!a) { h.innerHTML = ''; return }
  h.innerHTML = '<div class="appr ' + (a.danger ? 'dng' : '') + '"><div class="box"><h2 style="margin:0 0 6px">' + (a.danger ? '⚠️ أمر خطير' : '🔐 طلب موافقة') + '</h2><div style="margin-bottom:8px">' + esc(a.title) + '</div><pre>' + esc(a.detail) + '</pre><div class="mut" id="apprLeft" style="margin-top:8px"></div><div class="acts"><button class="btn danger" id="apprNo">رفض</button><button class="btn" id="apprYes">سماح</button></div></div></div>'
  const upd = () => { const e = $('#apprLeft'); if (!e || !S.approval) return; const s = Math.round((S.approval.exp - Date.now()) / 1000); e.textContent = s > 0 ? 'بتنتهي بعد ' + s + ' ثانية' : 'انتهت المهلة'; if (s > 0) setTimeout(upd, 1000) }
  upd()
}
function renderSheet() {
  const h = $('#sheetHost'); if (!h) return
  if (!S.sheet) { h.innerHTML = ''; return }
  if (S.sheet === 'mode') {
    const m = S.mode; const mods = S.models
    const opt = (id, v) => '<option value="' + esc(v.value) + '" ' + (id === v.value ? 'selected' : '') + '>' + esc(v.label) + '</option>'
    h.innerHTML = '<div class="sheet-bg" data-close="1"><div class="sheet" id="sheetBody"><h2>طريقة الشغل</h2><div class="seg">' +
      [['auto', 'تلقائي'], ['free', 'مجاني'], ['model', 'موديل'], ['council', 'council']].map(([k, l]) => '<button data-mode="' + k + '" class="' + (m.kind === k ? 'act' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<div class="mut" style="margin-bottom:10px">' + ({ auto: 'يختار أنسب موديل (مجاني أو مدفوع) حسب الطلب.', free: 'موديلات مجانية بس (الأرخص والأأمن).', model: 'موديل محدد بتختاره إنت.', council: 'كاتب ومراجع: جواب أدق بس أبطأ.' })[m.kind] + '</div>' +
      (m.kind === 'model' ? '<select class="sel" id="selModel"><option value="">— اختر —</option>' + mods.map((v) => opt(m.id, v)).join('') + '</select>' : '') +
      (m.kind === 'council' ? '<div class="mut">الكاتب</div><select class="sel" id="selAuthor"><option value="">تلقائي</option>' + mods.map((v) => opt(m.author, v)).join('') + '</select><div class="mut">المراجع</div><select class="sel" id="selCritic"><option value="">تلقائي</option>' + mods.map((v) => opt(m.critic, v)).join('') + '</select>' : '') +
      '<div class="mut" style="margin-top:6px">المشروع</div><select class="sel" id="selProj"><option value="">بدون مشروع</option>' + S.projects.map((p) => '<option value="' + esc(p.id) + '" ' + (S.project === p.id ? 'selected' : '') + (p.confidential ? ' disabled' : '') + '>' + (p.confidential ? '🔒 ' : '') + esc(p.name) + '</option>').join('') + '</select>' +
      '<button class="btn" data-close="1" style="margin-top:6px">تم</button></div></div>'
  } else if (S.sheet === 'hist') {
    h.innerHTML = '<div class="sheet-bg" data-close="1"><div class="sheet" id="sheetBody"><h2>المحادثات</h2>' + (S.convs.length ? S.convs.map((c) => '<div class="opt ' + (c.id === S.cur ? 'sel' : '') + '" data-conv="' + esc(c.id) + '"><div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.title) + '</div><small>' + new Date(c.at).toLocaleDateString('ar') + ' · ' + c.msgs.length + ' رسالة</small></div><button class="chip" data-delconv="' + esc(c.id) + '">حذف</button></div>').join('') : '<div class="mut">ما في محادثات.</div>') + '</div></div>'
  }
}


// ---------- long-press menu on my own messages: copy / resend / delete (phone only) ----------
let lpTimer = null; let lpFired = 0
const closeMsgMenu = () => { const m = $('#msgMenu'); if (m) m.remove() }
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true } catch { /* fall back */ }
  try { const x = document.createElement('textarea'); x.value = s; x.style.position = 'fixed'; x.style.opacity = '0'; document.body.appendChild(x); x.select(); const ok = document.execCommand('copy'); x.remove(); return ok } catch { return false }
}
function showMsgMenu(i) {
  const c = curConv(); const m = c.msgs[i]; if (!m || m.role !== 'user') return
  closeMsgMenu()
  const bg = document.createElement('div'); bg.id = 'msgMenu'; bg.className = 'mm-bg'
  bg.innerHTML = '<div class="mm"><button data-ma="copy">📋 نسخ</button><button data-ma="resend">🔁 إعادة إرسال</button><button data-ma="del" class="danger">🗑 حذف (من الموبايل بس)</button><button data-ma="x">إلغاء</button></div>'
  bg.addEventListener('click', async (ev) => {
    ev.stopPropagation()
    if (ev.target === bg) return closeMsgMenu()
    const a = ev.target.closest('[data-ma]'); if (!a) return
    const act = a.dataset.ma
    closeMsgMenu()
    if (act === 'copy') toast((await copyText(m.content)) ? 'اننسخت' : 'ما قدرت أنسخ')
    else if (act === 'resend') {
      if (S.running) return toast('استنى لحد ما يخلص الرد الحالي')
      const ta = $('#ta'); if (!ta) return
      ta.value = m.content === '(مرفقات)' ? '' : m.content
      if (m.atts && m.atts.length) toast('المرفقات ما بتنبعت من جديد')
      if (ta.value.trim()) sendChat()
    } else if (act === 'del') {
      const k = c.msgs.indexOf(m); if (k < 0) return
      c.msgs.splice(k, 1)
      if (m.qid) lsSet('trl.queue', getQ().filter((q) => q.id !== m.qid))
      saveConvs(); renderMsgs(false); updateDot(); toast('انحذفت من الموبايل')
    }
  })
  document.body.appendChild(bg)
}
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest && e.target.closest('.msg[data-mi]'); if (!el) return
  clearTimeout(lpTimer); lpTimer = setTimeout(() => { lpTimer = null; lpFired = Date.now(); showMsgMenu(Number(el.dataset.mi)) }, 500)
}, { passive: true })
for (const ev of ['touchmove', 'touchend', 'touchcancel']) document.addEventListener(ev, () => { clearTimeout(lpTimer); lpTimer = null }, { passive: true })
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest && e.target.closest('.msg[data-mi]'); if (!el) return
  e.preventDefault()
  if (Date.now() - lpFired > 800) { lpFired = Date.now(); showMsgMenu(Number(el.dataset.mi)) }
})

// ---------- events (delegated) ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,[data-conv],[data-close],[data-agopen],[data-sopen],[data-proj],[data-feedopen]'); if (!t) return
  const id = t.id
  if (viewClick(t)) return
  if (t.dataset.close && (t === e.target || t.tagName === 'BUTTON') && t.closest('#sheetHost')) { if (t.classList.contains('sheet-bg') ? e.target === t : true) { S.sheet = null; renderSheet(); renderHeader() } return }
  if (t.dataset.tab) { S.tab = t.dataset.tab; renderTabs(); renderPage(); return }
  if (t.dataset.stop) { sendHost({ k: 'stop', tab: t.dataset.stop }); toast('طلبت الإيقاف'); return }
  if (t.dataset.mode) { const k = t.dataset.mode; S.mode = k === 'model' ? { kind: 'model', id: S.mode.id || '' } : k === 'council' ? { kind: 'council', author: S.mode.author || '', critic: S.mode.critic || '' } : { kind: k }; lsSet('trl.mode', S.mode); renderSheet(); renderHeader(); if (S.tab === 'more') renderPage(); return }
  if (t.dataset.delconv) { S.convs = S.convs.filter((c) => c.id !== t.dataset.delconv); if (S.cur === t.dataset.delconv) S.cur = null; saveConvs(); renderSheet(); if (S.tab === 'chat') renderMsgs(); return }
  if (t.dataset.conv) { S.cur = t.dataset.conv; saveConvs(); S.sheet = null; renderSheet(); S.tab = 'chat'; renderTabs(); renderPage(); return }
  if (t.dataset.rm) { S.atts.splice(Number(t.dataset.rm), 1); renderAtts(); return }
  switch (id) {
    case 'scanBtn': return openScanner()
    case 'scanCancel': stopScanner(); S.view = 'pair'; render(); return
    case 'pairCancel': S.view = 'pair'; render(); return
    case 'pasteBtn': { const b = $('#pasteBox'); if (b) b.innerHTML = '<textarea class="paste" id="pasteTa" placeholder="TRLR1:…"></textarea><button class="btn" id="pasteGo" style="margin-top:8px">اربط</button>'; return }
    case 'pasteGo': return startPair(($('#pasteTa') || {}).value)
    case 'modeBtn': S.sheet = 'mode'; renderSheet(); return
    case 'histBtn': S.sheet = 'hist'; renderSheet(); return
    case 'newBtn': { S.cur = null; curConv(); S.tab = 'chat'; renderTabs(); renderPage(); return }
    case 'send': return sendChat()
    case 'attBtn': return $('#fileIn') && $('#fileIn').click()
    case 'camBtn': return $('#camIn') && $('#camIn').click()
    case 'mic': return toggleRec()
    case 'apprYes': return answerApproval(true)
    case 'apprNo': return answerApproval(false)
    case 'reconBtn': toast('عم يعيد الاتصال…'); conn.recon = true; dropConn(); setTimeout(wake, 100); return
    case 'unpairBtn': if (confirm('تلغي ربط هالجهاز؟')) { sendHost({ k: 'unpair' }); setTimeout(() => wipeDevice(''), 250) } return
  }
})
document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'fileIn' || t.id === 'camIn') { for (const f of t.files) addFile(f); t.value = ''; return }
  if (t.dataset.sw) { sendHost({ k: 'sched.toggle', id: t.dataset.sw, enabled: t.checked }); return }
  if (t.id === 'kaChk') { S.keepAlive = t.checked; lsSet('trl.keepalive', S.keepAlive); applyKeepAlive(); return }
  if (t.id === 'selModel') { S.mode = { kind: 'model', id: t.value }; lsSet('trl.mode', S.mode); renderHeader(); return }
  if (t.id === 'selAuthor' || t.id === 'selCritic') { S.mode = { kind: 'council', author: ($('#selAuthor') || {}).value || '', critic: ($('#selCritic') || {}).value || '' }; lsSet('trl.mode', S.mode); return }
  if (t.id === 'selProj') { S.project = t.value || null; lsSet('trl.project', S.project); renderHeader(); return }
})
document.addEventListener('input', (e) => { const t = e.target; if (t.id === 'ta') { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px' } })
document.addEventListener('keydown', (e) => { if (e.target.id === 'ta' && e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendChat() } })
document.addEventListener('visibilitychange', () => { if (!document.hidden) { wake(); void feedPoll() } })
setInterval(() => { if (!document.hidden && S.view === 'main') void feedPoll() }, 45000)
setTimeout(() => { void feedPoll() }, 4000)
window.addEventListener('online', wake)
setInterval(() => { if (S.view === 'main' && S.tab === 'agents' && S.tasks.length && !document.activeElement.matches('textarea')) renderPage() }, 1000 * 5)

// ---------- share-to-app ----------
async function handleShare(data) {
  if (!data || (!data.text && !(data.files && data.files.length))) return
  if (S.view !== 'main') { S.pendingShare = data; return }
  S.tab = 'chat'; renderTabs(); renderPage()
  const ta = $('#ta'); if (ta && data.text) { ta.value = (ta.value ? ta.value + '\n' : '') + data.text; ta.dispatchEvent(new Event('input')) }
  for (const f of data.files || []) {
    try { const blob = await (await fetch(Capacitor.convertFileSrc(f.path))).blob(); await addFile(new File([blob], f.name || 'file', { type: f.mime || blob.type })) } catch { toast('ما قدرت أقرا الملف المشارَك') }
  }
}

// ---------- boot ----------
async function boot() {
  render()
  await sodium.ready
  L = lib(sodium)
  const dev = lsGet('trl.device', null); const ppk = lsGet('trl.ppk', '')
  let psk = ''
  try { psk = (await AirNative.secureGet({ key: 'psk' })).value || '' } catch { /* */ }
  if (dev && ppk && psk) { S.device = dev; S.ppk = ppk; S.psk = psk; S.host = dev.name; S.view = 'main'; curConv(); render(); connect(); startHeartbeat(); applyKeepAlive() }
  else { S.view = 'pair'; render() }
  startHeartbeat()
  try {
    if (AirNative.addListener) Promise.resolve(AirNative.addListener('shareReceived', (d) => handleShare(d))).catch(() => {})
    const p = await AirNative.getPendingShare(); if (p && (p.text || (p.files && p.files.length))) handleShare(p)
  } catch { /* */ }
  try { CapApp.addListener('resume', () => wake()) } catch { /* */ }
  if (S.pendingShare && S.view === 'main') { const d = S.pendingShare; S.pendingShare = null; handleShare(d) }
}
boot()
window.__trl = { S, conn }  // handy for debugging
