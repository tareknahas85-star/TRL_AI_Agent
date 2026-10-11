import http from 'http'
import sodium from 'libsodium-wrappers'
import WebSocket from 'ws'
import { attachRelay } from '../src/remote/relay'
import { lib, PAIR_TTL_MS, type QrPayload } from '../src/remote/protocol'
import { GuestLink, HostLink } from '../src/remote/session'

let fails = 0
const ok = (c: unknown, msg: string): void => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg)
  if (!c) fails++
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  await sodium.ready
  const L = lib(sodium)
  const server = http.createServer()
  const relay = attachRelay(server)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  const wire: string[] = [] // everything the relay forwards, to check it is blind

  class Conn {
    ws: WebSocket
    onFrame: (f: string) => void = () => undefined
    queue: string[] = []
    sent: string[] = []
    constructor(room: string, role: 'host' | 'guest') {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&role=${role}`)
      this.ws.on('message', (d) => {
        wire.push(d.toString())
        this.onFrame(d.toString())
      })
      this.ws.on('open', () => {
        for (const q of this.queue) this.ws.send(q)
        this.queue = []
      })
      this.ws.on('error', () => undefined)
    }
    send(f: string): void {
      this.sent.push(f)
      if (this.ws.readyState === 1) this.ws.send(f)
      else this.queue.push(f)
    }
    raw(f: string): void {
      this.ws.send(f)
    }
    close(): void {
      this.ws.close()
    }
  }
  const mkHost = (room: string, opts: Partial<ConstructorParameters<typeof HostLink>[0]> & { dsk: string; dpk: string }) => {
    const c = new Conn(room, 'host')
    const msgs: unknown[] = []
    const st = { ready: false, sas: '', approve: (_b: boolean) => undefined as void, name: '' }
    const link = new HostLink({
      sodium, room, send: (f) => c.send(f),
      onSas: (i, a) => { st.sas = i.sas; st.name = i.name; st.approve = a },
      onReady: () => (st.ready = true), onMessage: (m) => msgs.push(m), ...opts
    })
    c.onFrame = (f) => link.receive(f)
    return { c, link, msgs, st }
  }
  const mkGuest = (room: string, opts: Partial<ConstructorParameters<typeof GuestLink>[0]> & { ppk: string; psk: string; mode: 'pair' | 'device' }) => {
    const c = new Conn(room, 'guest')
    const msgs: unknown[] = []
    const st = { ready: false, sas: '', denied: false }
    const link = new GuestLink({
      sodium, name: 'Pixel', send: (f) => c.send(f),
      onSas: (s) => (st.sas = s), onReady: () => (st.ready = true), onDenied: () => (st.denied = true), onMessage: (m) => msgs.push(m), ...opts
    })
    c.onFrame = (f) => link.receive(f)
    return { c, link, msgs, st }
  }

  const desk = L.newIdentity()
  const phone = L.newIdentity()
  const secret = L.newPairSecret()
  const pairRoom = L.newPairRoom()
  const qr: QrPayload = { v: 1, u: [], room: pairRoom, dpk: desk.pk, s: secret, exp: Date.now() + PAIR_TTL_MS, name: 'PC' }

  // ---- pairing ----
  const H = mkHost(pairRoom, { dsk: desk.sk, dpk: desk.pk, pair: { secret, exp: qr.exp } })
  const G = mkGuest(pairRoom, { ppk: phone.pk, psk: phone.sk, mode: 'pair', qr })
  await sleep(400)
  ok(/^\d{6}$/.test(H.st.sas) && H.st.sas === G.st.sas, 'SAS codes match on both sides: ' + H.st.sas)
  ok(!H.st.ready && !G.st.ready, 'not ready before the desktop approves')
  H.st.approve(true)
  await sleep(300)
  ok(H.st.ready && G.st.ready, 'paired after approval')

  const SECRET_TEXT = 'سر-الكلمة-123-top-secret'
  G.link.send({ k: 'chat', text: SECRET_TEXT })
  H.link.send({ k: 'done', content: 'رد ' + SECRET_TEXT })
  await sleep(200)
  ok(JSON.stringify(H.msgs).includes(SECRET_TEXT) && JSON.stringify(G.msgs).includes(SECRET_TEXT), 'messages flow both ways')
  ok(!wire.join('').includes(SECRET_TEXT), 'relay frames contain no plaintext')

  const phone2 = L.newIdentity()
  // ---- single-use: after one valid pair1 the link ignores a second one ----
  {
    const room = L.newPairRoom()
    const s1 = L.newPairSecret()
    const q = { ...qr, room, s: s1, exp: Date.now() + 5000 }
    let count = 0
    const h = mkHost(room, { dsk: desk.sk, dpk: desk.pk, pair: { secret: s1, exp: q.exp }, onSas: () => count++ })
    const a = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'pair', qr: q })
    await sleep(300)
    const b = mkGuest(room, { ppk: phone2.pk, psk: phone2.sk, mode: 'pair', qr: q, name: 'Evil' })
    await sleep(300)
    ok(count === 1 && !b.st.sas, 'QR secret is single-use')
    h.c.close(); a.c.close(); b.c.close()
  }
  // ---- wrong secret / expired / denied ----
  {
    const room = L.newPairRoom()
    const s1 = L.newPairSecret()
    let seen = false
    const h = mkHost(room, { dsk: desk.sk, dpk: desk.pk, pair: { secret: s1, exp: Date.now() + 5000 }, onSas: () => (seen = true) })
    const g = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'pair', qr: { ...qr, room, s: L.newPairSecret() } })
    await sleep(300)
    ok(!seen && !g.st.sas, 'wrong QR secret rejected')
    h.c.close(); g.c.close()
  }
  {
    const room = L.newPairRoom()
    const s1 = L.newPairSecret()
    let seen = false
    const h = mkHost(room, { dsk: desk.sk, dpk: desk.pk, pair: { secret: s1, exp: Date.now() - 1 }, onSas: () => (seen = true) })
    const g = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'pair', qr: { ...qr, room, s: s1 } })
    await sleep(300)
    ok(!seen, 'expired pairing refused')
    h.c.close(); g.c.close()
  }
  {
    const room = L.newPairRoom()
    const s1 = L.newPairSecret()
    const h = mkHost(room, { dsk: desk.sk, dpk: desk.pk, pair: { secret: s1, exp: Date.now() + 5000 } })
    const g = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'pair', qr: { ...qr, room, s: s1 } })
    await sleep(300)
    h.st.approve(false)
    await sleep(200)
    ok(g.st.denied && !g.st.ready, 'desktop can reject a pairing')
    h.c.close(); g.c.close()
  }
  // ---- impostor desktop in pairing (different identity than the QR's dpk) ----
  {
    const room = L.newPairRoom()
    const s1 = L.newPairSecret()
    const fake = L.newIdentity()
    const h = mkHost(room, { dsk: fake.sk, dpk: fake.pk, pair: { secret: s1, exp: Date.now() + 5000 } })
    const g = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'pair', qr: { ...qr, room, s: s1 } })
    await sleep(300)
    ok(!g.st.sas, 'phone refuses a desktop that is not the one in the QR')
    h.c.close(); g.c.close()
  }

  // ---- reconnect with identity keys ----
  const room = L.roomOf(desk.pk, phone.pk)
  const HD = mkHost(room, { dsk: desk.sk, dpk: desk.pk, device: { ppk: phone.pk } })
  const GD = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'device', device: { dpk: desk.pk, room } })
  await sleep(400)
  ok(GD.st.ready && HD.link.isReady, 'reconnect handshake succeeds')
  GD.link.send({ k: 'ping', n: 1 })
  HD.link.send({ k: 'pong', n: 1 })
  await sleep(200)
  ok(HD.msgs.length === 1 && GD.msgs.length === 1, 'reconnect: data flows')

  GD.link.send({ k: 'ping', n: 2 })
  await sleep(150)
  ok(HD.msgs.length === 2, 'second message delivered')
  const lastFrame = GD.c.sent[GD.c.sent.length - 1]
  GD.c.raw(lastFrame) // replay
  await sleep(150)
  ok(HD.msgs.length === 2, 'replayed ciphertext rejected')
  ok(!HD.link.isReady, 'session torn down after a bad frame')
  GD.st.ready = false
  GD.link.start() // phone re-handshakes
  await sleep(300)
  ok(HD.link.isReady && GD.st.ready, 'phone can re-handshake after a bad frame')

  GD.link.send({ k: 'ping', n: 3 })
  await sleep(150)
  const n3 = HD.msgs.length
  const f2 = JSON.parse(GD.c.sent[GD.c.sent.length - 1]) as { t: string; c: string }
  f2.c = f2.c.slice(0, -4) + (f2.c.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  GD.c.raw(JSON.stringify(f2))
  await sleep(150)
  ok(HD.msgs.length === n3, 'tampered ciphertext rejected')
  HD.c.close(); GD.c.close()
  await sleep(100)

  // ---- unknown phone / impostor desktop on a device room ----
  {
    const evil = L.newIdentity()
    const h = mkHost(room, { dsk: desk.sk, dpk: desk.pk, device: { ppk: phone.pk } })
    const g = mkGuest(room, { ppk: evil.pk, psk: evil.sk, mode: 'device', device: { dpk: desk.pk, room } })
    await sleep(300)
    ok(!h.st.ready && !g.st.ready, 'unpaired identity refused')
    h.c.close(); g.c.close()
  }
  {
    const fake = L.newIdentity()
    const h = mkHost(room, { dsk: fake.sk, dpk: fake.pk, device: { ppk: phone.pk } })
    const g = mkGuest(room, { ppk: phone.pk, psk: phone.sk, mode: 'device', device: { dpk: desk.pk, room } })
    await sleep(300)
    ok(!g.st.ready, 'impostor desktop refused by the phone')
    h.c.close(); g.c.close()
  }
  {
    const bad = await new Promise<boolean>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=short&role=host`)
      ws.on('error', () => res(true))
      ws.on('open', () => res(false))
    })
    ok(bad, 'relay rejects malformed room ids')
  }
  relay.close()
  server.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK')
  process.exit(fails ? 1 : 0)
}
void main()
