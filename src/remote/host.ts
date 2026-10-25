/*
 * Desktop side of the phone link: paired-device registry, embedded relay (LAN), outbound relay connections,
 * pairing (QR + confirmation code), and the bridge between phone messages and the app (chat, tasks, approvals, files).
 */
import { setPhoneLocationProvider } from '../tools/place-tools'
import { BrowserWindow, app, safeStorage } from 'electron'
import http from 'http'
import os from 'os'
import path from 'path'
import fsp from 'fs/promises'
import WebSocket from 'ws'
import QRCode from 'qrcode'
import sodium from 'libsodium-wrappers'
import { readJson, writeJson, newId } from '../core/json-store'
import { listTodo, onTodoChange, splitLines, todoOp } from '../core/todo-store'
import { listProjects, activeProject, setActiveProject } from '../core/workspace'
import { listAgents } from '../core/agents'
import { listDirShallow } from '../core/project-files'
import { learnView } from '../core/learning'
import { phoneGateInfo } from '../core/gate'
import { listSchedules, runScheduleNow, runningSchedules, updateSchedule } from '../core/scheduler'
import { tasksReport } from '../main/extras'
import { listRuns, cancelRun, runHub } from '../core/progress'
import { prepareFile, type Attachment } from '../main/attach'
import { attachRelay } from './relay'
import { approvalHash, approvalMsg, lib, PAIR_TTL_MS, type Lib, type QrPayload } from './protocol'
import { HostLink } from './session'

type Json = Record<string, unknown>
type Device = { id: string; name: string; ppk: string; createdAt: number; lastSeen: number }
type Cfg = {
  enabled: boolean
  port: number
  relayUrl: string
  approveFromPhone: boolean
  destructiveFromPhone: boolean
  identity?: { pk: string; sk: string; enc: boolean }
  devices: Device[]
}
const FILE = 'remote.json'
const DEFAULTS: Cfg = { enabled: false, port: 47821, relayUrl: '', approveFromPhone: true, destructiveFromPhone: false, devices: [] }

export type Bridge = {
  models: () => { value: string; label: string; tier: string }[]
  run: (a: { text: string; tabId: string; projectId: string | null; mode: unknown; history: unknown }, sink: (ch: string, args: unknown[]) => void) => Promise<Json>
}
let bridge: Bridge | null = null
export const setRemoteBridge = (b: Bridge): void => {
  bridge = b
}

let L: Lib
let cfg: Cfg = { ...DEFAULTS }
let identity: { pk: string; sk: string } | null = null
let server: http.Server | null = null
let relayCtl: { close: () => void; rooms: () => number } | null = null
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

// ---------- persistence ----------
function load(): void {
  cfg = { ...DEFAULTS, ...readJson<Partial<Cfg>>(FILE, {}) }
  if (!Array.isArray(cfg.devices)) cfg.devices = []
}
function save(): void {
  writeJson(FILE, cfg)
}
function ensureIdentity(): { pk: string; sk: string } {
  if (identity) return identity
  if (cfg.identity) {
    const sk = cfg.identity.enc ? safeStorage.decryptString(Buffer.from(cfg.identity.sk, 'base64')) : cfg.identity.sk
    identity = { pk: cfg.identity.pk, sk }
    return identity
  }
  const k = L.newIdentity()
  const canEnc = safeStorage.isEncryptionAvailable()
  cfg.identity = { pk: k.pk, sk: canEnc ? safeStorage.encryptString(k.sk).toString('base64') : k.sk, enc: canEnc }
  save()
  identity = k
  return k
}

// ---------- events to the UI ----------
type UiEvent = { type: 'sas'; sas: string; name: string } | { type: 'paired'; name: string } | { type: 'pair-end'; reason: string } | { type: 'status' }
const emitUi = (e: UiEvent): void => {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('remote:event', e)
    } catch {
      /* window gone */
    }
  }
}

// ---------- relay connections (outbound, auto-reconnect) ----------
class RoomConn {
  ws: WebSocket | null = null
  private closed = false
  private retry = 0
  private timer: NodeJS.Timeout | null = null
  onFrame: (f: string) => void = () => undefined
  onDown: () => void = () => undefined
  constructor(readonly url: string, readonly room: string) {
    this.open()
  }
  private open(): void {
    if (this.closed) return
    let ws: WebSocket
    try {
      ws = new WebSocket(`${this.url}?room=${this.room}&role=host`, { handshakeTimeout: 10_000, maxPayload: 1_000_000 })
    } catch {
      this.schedule()
      return
    }
    this.ws = ws
    ws.on('open', () => (this.retry = 0))
    ws.on('message', (d) => this.onFrame(d.toString()))
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null
      this.onDown()
      this.schedule()
    })
    ws.on('error', () => undefined)
  }
  private schedule(): void {
    if (this.closed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.open()
    }, Math.min(30_000, 1000 * 2 ** Math.min(this.retry++, 5)))
  }
  send(f: string): void {
    if (this.ws?.readyState === 1) this.ws.send(f)
  }
  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }
}

const relayUrls = (): string[] => {
  const urls = [`ws://127.0.0.1:${cfg.port}/ws`]
  const ext = cfg.relayUrl.trim()
  if (ext) urls.push(/\/ws\/?$/.test(ext) ? ext.replace(/\/$/, '') : ext.replace(/\/$/, '') + '/ws')
  return urls
}
const lanUrls = (): string[] => {
  const virt = /vmware|virtualbox|vethernet|wsl|hyper-v|docker|vpn|tap|tun|wireguard|nord|proton|pseudo|bluetooth|loopback/i
  const real: string[] = []
  const all: string[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue
      const u = `ws://${i.address}:${cfg.port}/ws`
      all.push(u)
      if (!virt.test(name)) real.push(u)
    }
  }
  // keep the QR small (dense QR codes are hard for phone cameras): real adapters first, at most 3
  return (real.length ? real : all).slice(0, 3)
}
/** Addresses the phone may try, nearest first: LAN addresses, then the optional public relay. */
const phoneUrls = (): string[] => [...lanUrls(), ...relayUrls().slice(1)]

// ---------- per-device runtime ----------
type Link = { conn: RoomConn; link: HostLink }
const runtimes = new Map<string, Link[]>() // device id -> links (one per relay)

function startDevice(d: Device): void {
  stopDevice(d.id)
  const me = ensureIdentity()
  const room = L.roomOf(me.pk, d.ppk)
  const links: Link[] = relayUrls().map((url) => {
    const conn = new RoomConn(url, room)
    const link: HostLink = new HostLink({
      sodium, room, dsk: me.sk, dpk: me.pk, device: { ppk: d.ppk },
      send: (f) => conn.send(f),
      onReady: () => {
        d.lastSeen = Date.now()
        save()
        emitUi({ type: 'status' })
        send(d.id, { k: 'state', ...stateFor() })
        pushTasks()
      },
      onMessage: (m) => void handle(d, m),
      onPeer: () => emitUi({ type: 'status' })
    })
    conn.onFrame = (f) => link.receive(f)
    conn.onDown = () => {
      link.receive(JSON.stringify({ t: 'peer', up: false }))
    }
    return { conn, link }
  })
  runtimes.set(d.id, links)
}
function stopDevice(id: string): void {
  for (const l of runtimes.get(id) ?? []) l.conn.close()
  runtimes.delete(id)
}
const readyLinks = (id: string): HostLink[] => (runtimes.get(id) ?? []).map((l) => l.link).filter((l) => l.isReady)
const online = (id: string): boolean => readyLinks(id).length > 0
function send(id: string, m: Json): boolean {
  const l = readyLinks(id)[0]
  return l ? l.send(m) : false
}
// Replies that finished while the phone was unreachable: kept (max 20, 24 h) and replayed when it says hello again.
const missed = new Map<string, Json[]>()
function stashMissed(id: string, m: Json): void {
  const a = missed.get(id) ?? []
  a.push({ ...m, _at: Date.now() })
  missed.set(id, a.slice(-20))
}
function replayMissed(id: string): void {
  const a = (missed.get(id) ?? []).filter((x) => Date.now() - Number(x._at) < 86_400_000)
  missed.delete(id)
  for (const x of a) {
    const r: Json = { ...x }
    delete r._at
    if (!send(id, { ...r, late: true })) stashMissed(id, r)
  }
}
const broadcast = (m: Json): void => {
  for (const d of cfg.devices) send(d.id, m)
}
const anyOnline = (): boolean => cfg.devices.some((d) => online(d.id))

// Phone GPS for the get_location tool: the phone is asked for ONE fix, only when a request needs the location (it prompts for the Android permission the first time).
type PhoneLocResult = { lat: number; lon: number; accuracyM?: number } | { error: string }
const pendingLoc = new Map<string, { devId: string; resolve: (v: PhoneLocResult | null) => void }>()
export function requestPhoneLocation(): Promise<PhoneLocResult | null> {
  const dev = cfg.devices.find((d) => online(d.id))
  if (!dev) return Promise.resolve(null)
  const id = Math.random().toString(36).slice(2, 12)
  return new Promise((resolve) => {
    // 40 s: the first request makes Android show the permission prompt and a cold GPS fix can take a while.
    const timer = setTimeout(() => {
      pendingLoc.delete(id)
      resolve({ error: 'no answer from the phone within 40 seconds (app in the background, or the permission prompt was not accepted)' })
    }, 40000)
    pendingLoc.set(id, {
      devId: dev.id,
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      }
    })
    if (!send(dev.id, { k: 'loc.req', id })) {
      clearTimeout(timer)
      pendingLoc.delete(id)
      resolve(null)
    }
  })
}

// ---------- pairing ----------
let pairing: { exp: number; conns: RoomConn[]; timer: NodeJS.Timeout; approve?: (ok: boolean) => void } | null = null

function endPairing(reason: string): void {
  if (!pairing) return
  clearTimeout(pairing.timer)
  for (const c of pairing.conns) c.close()
  pairing = null
  emitUi({ type: 'pair-end', reason })
}

export async function startPairing(): Promise<{ qr: string; text: string; exp: number; urls: string[] }> {
  if (!cfg.enabled) throw new Error('فعّل الربط مع الموبايل أول')
  endPairing('restart')
  const me = ensureIdentity()
  const room = L.newPairRoom()
  const secret = L.newPairSecret()
  const exp = Date.now() + PAIR_TTL_MS
  const urls = phoneUrls()
  const payload: QrPayload = { v: 1, u: urls, room, dpk: me.pk, s: secret, exp, name: os.hostname().slice(0, 40) }
  const conns = relayUrls().map((url) => {
    const conn = new RoomConn(url, room)
    const link: HostLink = new HostLink({
      sodium, room, dsk: me.sk, dpk: me.pk, pair: { secret, exp },
      send: (f) => conn.send(f),
      onSas: (info, approve) => {
        if (pairing) pairing.approve = approve
        emitUi({ type: 'sas', sas: info.sas, name: info.name })
        // remember the phone key for when the user confirms
        pendingPpk = { ppk: info.ppk, name: info.name }
      },
      onReady: (ppk) => {
        if (!pendingPpk || pendingPpk.ppk !== ppk) return
        const dev: Device = { id: newId(), name: pendingPpk.name, ppk, createdAt: Date.now(), lastSeen: Date.now() }
        cfg.devices = [...cfg.devices.filter((x) => x.ppk !== ppk), dev]
        save()
        startDevice(dev)
        emitUi({ type: 'paired', name: dev.name })
        setTimeout(() => endPairing('done'), 1500) // leave the pairing socket up long enough for the phone to get its confirmation
      },
      onMessage: () => undefined
    })
    conn.onFrame = (f) => link.receive(f)
    conn.onDown = () => link.receive(JSON.stringify({ t: 'peer', up: false }))
    return conn
  })
  const timer = setTimeout(() => endPairing('expired'), PAIR_TTL_MS + 500)
  pairing = { exp, conns, timer }
  const text = 'TRLR1:' + Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
  const qr = await QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 2, width: 640 })
  return { qr, text, exp, urls }
}
let pendingPpk: { ppk: string; name: string } | null = null
export const answerPairing = (ok: boolean): void => {
  pairing?.approve?.(ok)
  if (!ok) endPairing('rejected')
}
export const cancelPairing = (): void => endPairing('cancelled')

// ---------- phone -> app ----------
type Hist = unknown
const files = new Map<string, { name: string; size: number; chunks: Buffer[]; got: number; at: number }>()
const prepared = new Map<string, Attachment>() // `${deviceId}:${fid}`
const MAX_FILE = 30 * 1024 * 1024
const clean = (s: string): string => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || 'file'
const attBlock = (a: Attachment): string => '--- ' + a.name + ' [' + a.kind + ', ' + Math.round(a.size / 1024) + ' KB]\npath: ' + a.path + '\n' + (a.text ?? '') + (a.note ? '\n[ملاحظة] ' + a.note : '')

function stateFor(): Json {
  const p = listProjects()
  return {
    v: 1,
    host: os.hostname(),
    models: bridge?.models() ?? [],
    projects: p.projects.map((x) => ({ id: x.id, name: x.name, confidential: !!x.confidential })),
    activeProject: activeProject()?.id ?? null,
    approve: cfg.approveFromPhone,
    urls: phoneUrls()
  }
}

const labelOf = (tab: string): string =>
  tab.startsWith('phone-') ? 'من الموبايل' : tab === 'sched-tg' ? 'تيليغرام' : tab.startsWith('sched-') ? 'مهمة مجدولة' : 'نافذة البرنامج'
let tasksTimer: NodeJS.Timeout | null = null
export function pushTasks(): void {
  if (tasksTimer) return
  tasksTimer = setTimeout(() => {
    tasksTimer = null
    if (!anyOnline()) return
    broadcast({ k: 'tasks', list: listRuns().map((r) => ({ tab: r.tabId, label: labelOf(r.tabId), text: r.last, started: r.started })) })
  }, 400)
}
runHub.on('change', pushTasks)
const todoMsg = (): Json => ({ k: 'todo', list: listTodo().slice(0, 300) })
onTodoChange(() => broadcast(todoMsg()))

const confIds = (): Set<string> => new Set(listProjects().projects.filter((p) => p.confidential).map((p) => p.id))
const schedMsg = (): Json => {
  const run = new Set(runningSchedules())
  const conf = confIds()
  return {
    k: 'sched',
    list: listSchedules().map((t) => ({
      id: t.id, name: t.name, kind: t.kind, time: t.time, days: t.days, everyMin: t.everyMin, enabled: t.enabled,
      lastRun: t.lastRun ?? 0, status: run.has(t.id) ? 'running' : (t.lastStatus ?? ''),
      result: t.projectId && conf.has(t.projectId) ? '🔒 مشروع سري' : (t.lastResult ?? '').slice(0, 1500)
    }))
  }
}
const reportMsg = (): Json => {
  const conf = confIds()
  const rows = tasksReport(200).filter((r) => !(r.projectId && conf.has(r.projectId)))
  return { k: 'report', rows: rows.map((r) => ({ at: r.at, model: r.model, tier: r.tier, tokens: r.tokens, cost: r.cost, ck: r.costKnown, ms: r.totalMs, fails: r.failures, esc: r.escalated, prompt: r.prompt })) }
}

async function handle(dev: Device, m: Json): Promise<void> {
  let k = str(m.k, 30)
  if (k === 'agent.run') {
    // an agent run is a normal chat turn whose text is the agent's instructions + the task
    const a = listAgents().find((x) => x.id === str(m.agent, 20))
    const task = typeof m.task === 'string' ? m.task.trim().slice(0, 20000) : ''
    const rid = str(m.id, 60)
    if (!a || !rid) return void send(dev.id, { k: 'error', text: 'ما لقيت الوكيل' })
    if (!task) return void send(dev.id, { k: 'error', text: 'اكتب المهمة أول' })
    if (a.runOn === 'cloud') return void send(dev.id, { k: 'done', id: rid, tab: 'agent-' + a.id, content: 'هالوكيل مضبوط سحابي بس. شغّلو من الموبايل (بيروح عالسحابة) أو من تيليغرام.', failed: true })
    // same as Telegram: auto mode, the desktop's active project (never confidential), no phone history
    const ap = activeProject()
    if (ap?.confidential) return void send(dev.id, { k: 'done', id: rid, tab: 'agent-' + a.id, content: '🔒 المشروع الفعّال سري. غيّر المشروع من البرنامج أول.', failed: true })
    m = { ...m, text: (a.prompt ? a.prompt + '\n\n' : '') + 'المهمة: ' + task, tab: 'agent-' + a.id, project: ap?.id ?? null, mode: { kind: 'auto' }, hist: [] }
    k = 'chat'
  }
  dev.lastSeen = Date.now()
  try {
    switch (k) {
      case 'hello':
      case 'state.get':
        send(dev.id, { k: 'state', ...stateFor() })
        pushTasks()
        if (k === 'hello') replayMissed(dev.id)
        return
      case 'ping':
        send(dev.id, { k: 'pong' })
        return
      case 'agents.get':
        send(dev.id, { k: 'agents', list: listAgents().map((a) => ({ id: a.id, name: a.name, runOn: a.runOn, hint: a.prompt.replace(/\s+/g, ' ').slice(0, 140) })), gate: await phoneGateInfo().catch(() => null) })
        return
      case 'sched.get':
        send(dev.id, schedMsg())
        return
      case 'todo.get':
        send(dev.id, todoMsg())
        return
      case 'todo.add': {
        const text = str(m.text, 20000)
        if (text) todoOp({ op: 'add', lines: splitLines(text) })
        return
      }
      case 'todo.toggle':
      case 'todo.del': {
        const id = str(m.id, 80)
        if (id) todoOp({ op: m.k === 'todo.toggle' ? 'toggle' : 'del', id })
        return
      }
      case 'todo.clear':
        todoOp({ op: 'clearDone' })
        return
      case 'sched.run': {
        const id = str(m.id, 40)
        if (!id) return
        void runScheduleNow(id).finally(() => broadcast(schedMsg()))
        setTimeout(() => broadcast(schedMsg()), 400)
        return
      }
      case 'sched.toggle': {
        const id = str(m.id, 40)
        if (id) updateSchedule(id, { enabled: m.enabled === true })
        broadcast(schedMsg())
        return
      }
      case 'report.get':
        send(dev.id, reportMsg())
        return
      case 'learn.get': {
        const v = learnView()
        send(dev.id, {
          k: 'learn',
          v: {
            enabled: v.enabled, paused: v.paused, turns: v.turns, level: v.level,
            rings: v.rings.map((r) => ({ label: r.label, pct: r.pct, detail: String(r.detail).slice(0, 120) })),
            topics: v.topics.slice(0, 8).map((t) => ({ label: t.label, pct: t.pct })),
            summary: String(v.summary?.text ?? '').slice(0, 400)
          }
        })
        return
      }
      case 'project.files': {
        const id = str(m.id, 60)
        const p = listProjects().projects.find((x) => x.id === id)
        if (!p || p.confidential) { send(dev.id, { k: 'project.files', id, error: p ? 'confidential' : 'missing' }); return }
        send(dev.id, { k: 'project.files', id, items: listDirShallow(p.path) })
        return
      }
      case 'project.set': {
        const id = str(m.id, 60)
        if (id === null || listProjects().projects.some((p) => p.id === id)) setActiveProject(id)
        broadcast({ k: 'state', ...stateFor() })
        return
      }
      case 'loc.res': {
        const id = str(m.id, 40)
        const p = id ? pendingLoc.get(id) : null
        if (!id || !p || p.devId !== dev.id) return
        pendingLoc.delete(id)
        const lat = Number(m.lat)
        const lon = Number(m.lon)
        const acc = Number(m.acc)
        const err = str(m.err, 160)
        p.resolve(
          Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
            ? { lat, lon, accuracyM: Number.isFinite(acc) ? Math.round(acc) : undefined }
            : { error: err || 'invalid location from the phone' }
        )
        return
      }
      case 'unpair':
        removeDevice(dev.id)
        return
      case 'cancel': {
        const tab = str(m.tab, 60)
        if (tab) cancelRun('phone-' + dev.id + '-' + tab.replace(/[^\w-]/g, '').slice(0, 40))
        return
      }
      case 'stop': {
        const tab = str(m.tab, 80)
        if (tab && listRuns().some((r) => r.tabId === tab)) cancelRun(tab)
        return
      }
      case 'file.begin': {
        const fid = str(m.fid, 40), name = str(m.name, 200), size = Number(m.size)
        if (!fid || !name || !(size >= 0) || size > MAX_FILE) return void send(dev.id, { k: 'file.err', fid, error: 'الملف كبير (الحد 30MB)' })
        files.set(dev.id + ':' + fid, { name: clean(name), size, chunks: [], got: 0, at: Date.now() })
        return
      }
      case 'file.chunk': {
        const f = files.get(dev.id + ':' + String(m.fid))
        const d = str(m.d, 400_000)
        if (!f || !d) return
        const b = Buffer.from(d, 'base64')
        f.got += b.length
        if (f.got > f.size + 1024) return void files.delete(dev.id + ':' + String(m.fid))
        f.chunks.push(b)
        return
      }
      case 'file.end': {
        const fid = str(m.fid, 40)
        const f = fid ? files.get(dev.id + ':' + fid) : null
        if (!fid || !f) return
        files.delete(dev.id + ':' + fid)
        const projectId = str(m.project, 60)
        const conf = !!projectId && !!listProjects().projects.find((p) => p.id === projectId)?.confidential
        const dir = path.join(app.getPath('userData'), 'attachments', String(Date.now()))
        await fsp.mkdir(dir, { recursive: true })
        const file = path.join(dir, f.name)
        await fsp.writeFile(file, Buffer.concat(f.chunks))
        const att = await prepareFile(file, conf)
        prepared.set(dev.id + ':' + fid, att)
        send(dev.id, { k: 'file.ok', fid, att: { name: att.name, kind: att.kind, size: att.size, note: att.note ?? '', preview: (att.text ?? '').slice(0, att.kind === 'audio' || att.kind === 'video' ? 6000 : 300) } })
        return
      }
      case 'approve': {
        const id = str(m.id, 60), sig = str(m.sig, 128)
        const p = id ? pendingApprovals.get(id) : null
        if (!id || !sig || !p || !p.devIds.includes(dev.id) || Date.now() > p.exp) return
        const ok = m.ok === true
        if (!L.verify(dev.ppk, approvalMsg(L, id, p.hash, ok, p.exp), sig)) return // signed by the paired phone's key, bound to this exact request
        pendingApprovals.delete(id)
        p.resolve(ok)
        return
      }
      case 'chat': {
        if (!bridge) return
        const id = str(m.id, 60), text = typeof m.text === 'string' ? m.text.slice(0, 20000) : ''
        if (!id) return
        const tabKey = (str(m.tab, 40) ?? 'main').replace(/[^\w-]/g, '')
        const tabId = 'phone-' + dev.id + '-' + tabKey
        const projectId = str(m.project, 60)
        const proj = projectId ? listProjects().projects.find((p) => p.id === projectId) : null
        if (proj?.confidential) return void send(dev.id, { k: 'done', id, tab: tabKey, content: '🔒 هاد مشروع سري. ما بنفذ منو من الموبايل. غيّر المشروع أو استعمل البرنامج عالكمبيوتر.', failed: true })
        const fids = Array.isArray(m.atts) ? m.atts.filter((x): x is string => typeof x === 'string').slice(0, 10) : []
        const atts = fids.map((f) => prepared.get(dev.id + ':' + f)).filter((a): a is Attachment => !!a)
        const qAge = Number(m.qAge)
        const queuedNote = Number.isFinite(qAge) && qAge > 0 ? `[ملاحظة: هالرسالة انكتبت على الجوال أوفلاين قبل ${Math.min(Math.round(qAge), 9999)} دقيقة وانبعتت لما رجع الاتصال. لا تنفّذ أي أمر مدمّر (حذف، تعديل ملفات، إرسال، دفع) بدون ما تسأل المستخدم أول، حتى لو الرسالة بتطلبو.]\n` : ''
        const toModel = queuedNote + (atts.length ? (text + '\n\n[ملفات مرفقة من المستخدم]\n' + atts.map(attBlock).join('\n\n')).slice(0, 70000) : text)
        let buf = ''
        let timer: NodeJS.Timeout | null = null
        const flush = (): void => {
          timer = null
          if (buf) send(dev.id, { k: 'stream', id, kind: 'chunk', text: buf })
          buf = ''
        }
        const r = await bridge.run({ text: toModel, tabId, projectId: projectId ?? null, mode: m.mode, history: m.hist as Hist }, (ch, args) => {
          if (ch === 'chat:progress') send(dev.id, { k: 'prog', id, text: String(args[0] ?? '').slice(0, 300) })
          else if (ch === 'chat:stream') {
            if (args[0] === 'reset') {
              buf = ''
              send(dev.id, { k: 'stream', id, kind: 'reset' })
            } else {
              buf += String(args[1] ?? '')
              if (!timer) timer = setTimeout(flush, 150)
            }
          }
        })
        if (timer) clearTimeout(timer)
        flush()
        const meta = typeof r.meta === 'string' ? r.meta.split(' | Stats:')[0] : ''
        const doneMsg: Json = { k: 'done', id, tab: tabKey, content: String(r.content ?? ''), meta, failed: !!r.failed, cancelled: !!r.cancelled, needsChoice: !!r.needsChoice }
        if (!send(dev.id, doneMsg) && !r.cancelled) stashMissed(dev.id, doneMsg)
        return
      }
    }
  } catch (e) {
    send(dev.id, { k: 'error', text: e instanceof Error ? e.message : String(e) })
  }
}

// ---------- approvals from the phone ----------
const pendingApprovals = new Map<string, { devIds: string[]; hash: string; exp: number; resolve: (ok: boolean | null) => void }>()

/** Asks every online phone. Resolves true/false when one answers, or null (=> fall back to the desktop dialog) when not applicable. */
export function phoneApproval(a: { title: string; detail: string; danger: boolean }): { promise: Promise<boolean | null>; cancel: () => void } | null {
  if (!cfg.enabled || !cfg.approveFromPhone || (a.danger && !cfg.destructiveFromPhone)) return null
  const devs = cfg.devices.filter((d) => online(d.id))
  if (!devs.length) return null
  const id = newId() + newId()
  const exp = Date.now() + 120_000
  const hash = approvalHash(L, a.title, a.detail)
  const promise = new Promise<boolean | null>((resolve) => {
    const t = setTimeout(() => done(null), 120_000)
    const done = (v: boolean | null): void => {
      clearTimeout(t)
      pendingApprovals.delete(id)
      resolve(v)
    }
    // one pending entry per request; the first online paired phone that answers (signature checked) wins
    pendingApprovals.set(id, { devIds: devs.map((d) => d.id), hash, exp, resolve: done })
    for (const d of devs) {
      send(d.id, { k: 'approval', id, title: a.title.slice(0, 200), detail: a.detail.slice(0, 1500), danger: a.danger, exp, hash })
    }
  })
  return {
    promise,
    cancel: () => {
      if (pendingApprovals.delete(id)) for (const d of devs) send(d.id, { k: 'approval.cancel', id })
    }
  }
}

// ---------- public API used by IPC / main ----------
export function status(): Json {
  return {
    enabled: cfg.enabled,
    port: cfg.port,
    relayUrl: cfg.relayUrl,
    approveFromPhone: cfg.approveFromPhone,
    destructiveFromPhone: cfg.destructiveFromPhone,
    lan: lanUrls(),
    listening: !!server?.listening,
    pairing: pairing ? { exp: pairing.exp } : null,
    devices: cfg.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, online: online(d.id) }))
  }
}
export function removeDevice(id: string): void {
  const d = cfg.devices.find((x) => x.id === id)
  if (!d) return
  send(id, { k: 'revoked' })
  setTimeout(() => stopDevice(id), 300)
  cfg.devices = cfg.devices.filter((x) => x.id !== id)
  save()
  emitUi({ type: 'status' })
}

async function listen(): Promise<void> {
  if (server) return
  const s = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' })
    res.end(req.url === '/health' ? 'ok' : 'not found')
  })
  relayCtl = attachRelay(s)
  server = s
  await new Promise<void>((resolve) => {
    s.once('error', () => {
      relayCtl?.close()
      relayCtl = null
      server = null
      resolve()
    })
    s.listen(cfg.port, '0.0.0.0', () => resolve())
  })
}
function stopAll(): void {
  endPairing('stopped')
  for (const id of [...runtimes.keys()]) stopDevice(id)
  relayCtl?.close()
  relayCtl = null
  try {
    server?.close()
  } catch {
    /* ignore */
  }
  server = null
}

export async function setRemote(p: Partial<Pick<Cfg, 'enabled' | 'port' | 'relayUrl' | 'approveFromPhone' | 'destructiveFromPhone'>>): Promise<Json> {
  const prev = { enabled: cfg.enabled, port: cfg.port, relayUrl: cfg.relayUrl }
  if (typeof p.enabled === 'boolean') cfg.enabled = p.enabled
  if (typeof p.port === 'number' && p.port >= 1024 && p.port <= 65535) cfg.port = Math.floor(p.port)
  if (typeof p.relayUrl === 'string') {
    const u = p.relayUrl.trim()
    if (u && !/^wss?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(u)) throw new Error('عنوان الـ relay لازم يبدأ بـ wss:// أو ws://')
    cfg.relayUrl = u
  }
  if (typeof p.approveFromPhone === 'boolean') cfg.approveFromPhone = p.approveFromPhone
  if (typeof p.destructiveFromPhone === 'boolean') cfg.destructiveFromPhone = p.destructiveFromPhone
  save()
  if (cfg.enabled !== prev.enabled || cfg.port !== prev.port || cfg.relayUrl !== prev.relayUrl) {
    stopAll()
    if (cfg.enabled) await boot()
  }
  emitUi({ type: 'status' })
  return status()
}

async function boot(): Promise<void> {
  await listen()
  ensureIdentity()
  for (const d of cfg.devices) startDevice(d)
}

export async function initRemote(): Promise<void> {
  await sodium.ready
  L = lib(sodium)
  load()
  if (cfg.enabled) await boot()
}
export const shutdownRemote = (): void => stopAll()
setPhoneLocationProvider(requestPhoneLocation)
