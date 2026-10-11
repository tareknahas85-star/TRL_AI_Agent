/* A stand-in desktop (no Electron) used to test the phone app's UI and protocol end to end. */
import http from 'http'
import sodium from 'libsodium-wrappers'
import WebSocket from 'ws'
import { attachRelay } from '../src/remote/relay'
import { approvalHash, approvalMsg, lib, PAIR_TTL_MS, type QrPayload } from '../src/remote/protocol'
import { HostLink } from '../src/remote/session'

type Json = Record<string, unknown>
export async function startFakeHost(port = 0) {
  await sodium.ready
  const L = lib(sodium)
  const desk = L.newIdentity()
  const server = http.createServer()
  const relay = attachRelay(server)
  await new Promise<void>((r) => server.listen(port, '0.0.0.0', r))
  const p = (server.address() as { port: number }).port
  const url = `ws://127.0.0.1:${p}/ws`
  const log: Json[] = []
  const devices: { ppk: string; link: HostLink; ws: WebSocket }[] = []
  const approvals = new Map<string, { hash: string; exp: number; resolve: (v: boolean) => void }>()
  let lastSas = ''
  let autoApprove = true
  let pendingApprove: ((ok: boolean) => void) | null = null

  const open = (room: string, link: () => HostLink): WebSocket => {
    const ws = new WebSocket(`${url}?room=${room}&role=host`)
    ws.on('message', (d) => link().receive(d.toString()))
    ws.on('close', () => link().receive(JSON.stringify({ t: 'peer', up: false })))
    return ws
  }

  const onMsg = (ppk: string, m: Json): void => {
    log.push(m)
    const d = devices.find((x) => x.ppk === ppk)
    if (!d) return
    const send = (o: Json): void => void d.link.send(o)
    switch (m.k) {
      case 'hello':
        send({ k: 'state', v: 1, host: 'FAKE-PC', models: [{ value: 'cli:claude:sonnet', label: 'Claude Sonnet', tier: 'SUBSCRIPTION' }, { value: 'custom:x', label: 'GPT test', tier: 'PAID' }], projects: [{ id: 'p1', name: 'Demo', confidential: false }, { id: 'p2', name: 'Secret', confidential: true }], activeProject: null, approve: true, urls: [url] })
        break
      case 'ping': send({ k: 'pong' }); break
      case 'chat': {
        const id = m.id as string
        send({ k: 'prog', id, text: 'عم يفكّر…' })
        setTimeout(() => send({ k: 'stream', id, kind: 'chunk', text: 'مرحبا ' }), 80)
        setTimeout(() => send({ k: 'stream', id, kind: 'chunk', text: 'من **الكمبيوتر**\n```js\nconsole.log(1)\n```' }), 160)
        setTimeout(() => send({ k: 'done', id, tab: m.tab, content: 'مرحبا من **الكمبيوتر** — سؤالك: ' + String(m.text) + (Array.isArray(m.atts) && m.atts.length ? ' [' + m.atts.length + ' مرفق]' : '') + '\n```js\nconsole.log(1)\n```', meta: 'Model: Fake | Skill: x', failed: false }), 320)
        break
      }
      case 'file.begin': files.set(m.fid as string, { name: m.name as string, n: 0 }); break
      case 'file.chunk': { const f = files.get(m.fid as string); if (f) f.n += Buffer.from(m.d as string, 'base64').length; break }
      case 'file.end': { const f = files.get(m.fid as string); send({ k: 'file.ok', fid: m.fid, att: { name: f?.name, kind: f?.name?.endsWith('.webm') ? 'audio' : 'text', size: f?.n, note: '', preview: f?.name?.endsWith('.webm') ? 'نص مفرّغ من الصوت' : 'preview' } }); break }
      case 'approve': {
        const a = approvals.get(m.id as string)
        if (!a) break
        const ok = L.verify(ppk, approvalMsg(L, m.id as string, a.hash, m.ok === true, a.exp), m.sig as string)
        log.push({ k: 'approve.verified', ok })
        approvals.delete(m.id as string)
        a.resolve(ok && m.ok === true)
        break
      }
      case 'stop': case 'cancel': break
    }
  }
  const files = new Map<string, { name: string; n: number }>()

  const startDevice = (ppk: string): void => {
    const room = L.roomOf(desk.pk, ppk)
    let ws!: WebSocket
    const link: HostLink = new HostLink({ sodium, room, dsk: desk.sk, dpk: desk.pk, device: { ppk }, send: (f) => ws.readyState === 1 && ws.send(f), onMessage: (m) => onMsg(ppk, m) })
    ws = open(room, () => link)
    devices.push({ ppk, link, ws })
  }

  return {
    url, port: p, log, devices,
    get lastSas() { return lastSas },
    set autoApprove(v: boolean) { autoApprove = v },
    approvePair(ok: boolean): void { pendingApprove?.(ok) },
    pair(): string {
      const room = L.newPairRoom()
      const secret = L.newPairSecret()
      const exp = Date.now() + PAIR_TTL_MS
      const qr: QrPayload = { v: 1, u: [url], room, dpk: desk.pk, s: secret, exp, name: 'FAKE-PC' }
      let ws!: WebSocket
      const link: HostLink = new HostLink({
        sodium, room, dsk: desk.sk, dpk: desk.pk, pair: { secret, exp }, send: (f) => ws.readyState === 1 && ws.send(f),
        onSas: (i, a) => { lastSas = i.sas; log.push({ k: 'sas', sas: i.sas, name: i.name }); pendingApprove = a; if (autoApprove) a(true) },
        onReady: (ppk) => { startDevice(ppk); setTimeout(() => ws.close(), 1000) }, onMessage: () => undefined
      })
      ws = open(room, () => link)
      return 'TRLR1:' + Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')
    },
    ask(title: string, detail: string): Promise<boolean> {
      const id = L.b64(sodium.randombytes_buf(9))
      const exp = Date.now() + 60000
      const hash = approvalHash(L, title, detail)
      return new Promise((resolve) => {
        approvals.set(id, { hash, exp, resolve })
        for (const d of devices) d.link.send({ k: 'approval', id, title, detail, danger: false, exp, hash })
      })
    },
    tasks(list: Json[]): void { for (const d of devices) d.link.send({ k: 'tasks', list }) },
    close(): void { relay.close(); server.close() }
  }
}
