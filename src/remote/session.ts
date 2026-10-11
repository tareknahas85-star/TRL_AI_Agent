/* Transport-agnostic endpoints for the handshake + encrypted stream. See protocol.ts for the design. */
import { lib, PAIR_TTL_MS, PROTO, type Lib, type QrPayload, type Sodium } from './protocol'

type Json = Record<string, unknown>
const parse = (f: string): Json | null => {
  try {
    const o = JSON.parse(f)
    return o && typeof o === 'object' ? (o as Json) : null
  } catch {
    return null
  }
}
const str = (v: unknown, max = 400): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

export type HostOpts = {
  sodium: Sodium
  room: string
  dsk: string
  dpk: string
  /** pairing room: carries the QR secret. device room: carries the paired phone's public key. */
  pair?: { secret: string; exp: number }
  device?: { ppk: string }
  send: (frame: string) => void
  /** pairing only: both screens show `sas`; call approve(true/false). */
  onSas?: (info: { sas: string; name: string; ppk: string }, approve: (ok: boolean) => void) => void
  onReady?: (ppk: string) => void
  onMessage: (m: Json) => void
  onPeer?: (up: boolean) => void
}

export class HostLink {
  private L: Lib
  private out: InstanceType<Lib['Out']> | null = null
  private inn: InstanceType<Lib['In']> | null = null
  private keys: { rx: Uint8Array; tx: Uint8Array } | null = null
  private ready = false
  private used = false
  private ppk = ''
  peerUp = false
  constructor(private o: HostOpts) {
    this.L = lib(o.sodium)
  }
  get isReady(): boolean {
    return this.ready
  }
  get room(): string {
    return this.o.room
  }
  private reset(): void {
    this.out = null
    this.inn = null
    this.keys = null
    this.ready = false
  }
  private beginStream(keys: { rx: Uint8Array; tx: Uint8Array }): void {
    this.keys = keys
    this.out = new this.L.Out(keys.tx)
    this.o.send(JSON.stringify({ t: 's', h: this.out.header }))
  }
  receive(frame: string): void {
    const m = parse(frame)
    if (!m) return
    const L = this.L
    const s = this.o.sodium
    try {
      if (m.t === 'peer') {
        this.peerUp = m.up === true
        if (!this.peerUp) this.reset()
        this.o.onPeer?.(this.peerUp)
        return
      }
      if (m.t === 'pair1' && this.o.pair) {
        if (this.used || Date.now() > this.o.pair.exp) return
        const ppk = str(m.ppk, 64), ex = str(m.ex, 64), n = str(m.n, 64), name = str(m.name, 60), mac = str(m.mac, 64)
        if (!ppk || !ex || !n || !name || !mac || m.v !== PROTO) return
        if (!L.eq(L.unb64(mac), L.unb64(L.pair1Mac(this.o.pair.secret, ppk, ex, n, name)))) return // not holding the QR secret
        this.used = true // one-time secret: burned by the first valid attempt
        this.reset()
        const e = L.newEphemeral()
        const hx = L.b64(e.publicKey)
        const n2 = L.nonce()
        const T = L.pairTranscript(this.o.dpk, ppk, ex, hx, n, n2, name)
        const sig = L.sign(this.o.dsk, L.pairSigMsg(T))
        const keys = L.sessionKeys('host', e.publicKey, e.privateKey, L.unb64(ex), T, L.unb64(this.o.pair.secret))
        this.ppk = ppk
        this.o.send(JSON.stringify({ t: 'pair2', hx, n2, sig }))
        this.keys = keys
        const code = L.sas(T, keys.rx) // host.rx == phone.tx == p2h
        this.o.onSas?.({ sas: code, name, ppk }, (ok) => {
          if (!ok) {
            this.o.send(JSON.stringify({ t: 'deny' }))
            return
          }
          this.beginStream(keys)
          this.ready = true
          this.send({ k: 'paired' })
          this.o.onReady?.(ppk)
        })
        return
      }
      if (m.t === 'c1' && this.o.device) {
        const ex = str(m.ex, 64), n = str(m.n, 64), sig = str(m.sig, 128)
        if (!ex || !n || !sig || m.v !== PROTO) return
        if (!L.verify(this.o.device.ppk, L.c1Msg(this.o.room, ex, n), sig)) return // not the paired phone
        this.reset()
        const e = L.newEphemeral()
        const hx = L.b64(e.publicKey)
        const n2 = L.nonce()
        const T = L.reconnectTranscript(this.o.room, ex, hx, n, n2)
        const sg = L.sign(this.o.dsk, L.c2Msg(T))
        this.ppk = this.o.device.ppk
        this.o.send(JSON.stringify({ t: 'c2', hx, n2, sig: sg }))
        this.beginStream(L.sessionKeys('host', e.publicKey, e.privateKey, L.unb64(ex), T))
        this.ready = true
        this.o.onReady?.(this.ppk)
        return
      }
      if (m.t === 's') {
        const h = str(m.h, 100)
        if (h && this.keys) this.inn = new L.In(this.keys.rx, h)
        return
      }
      if (m.t === 'd' && this.inn) {
        const c = str(m.c, 1_000_000)
        if (!c) return
        const msg = this.inn.open(c) as Json
        if (!this.ready && msg.k !== 'paired-ack') return
        this.o.onMessage(msg)
      }
    } catch {
      this.reset() // any crypto failure drops the session; the phone re-handshakes
    }
    void s
  }
  send(obj: Json): boolean {
    if (!this.out || !this.ready) return false
    this.o.send(JSON.stringify({ t: 'd', c: this.out.seal(obj) }))
    return true
  }
}

export type GuestOpts = {
  sodium: Sodium
  ppk: string
  psk: string
  name: string
  mode: 'pair' | 'device'
  qr?: QrPayload
  device?: { dpk: string; room: string }
  send: (frame: string) => void
  onSas?: (sas: string) => void
  onReady?: () => void
  onDenied?: () => void
  onMessage: (m: Json) => void
  onPeer?: (up: boolean) => void
}

export class GuestLink {
  private L: Lib
  private e: ReturnType<Lib['newEphemeral']> | null = null
  private n = ''
  private out: InstanceType<Lib['Out']> | null = null
  private inn: InstanceType<Lib['In']> | null = null
  private keys: { rx: Uint8Array; tx: Uint8Array } | null = null
  private ready = false
  private pairedPending = false
  constructor(private o: GuestOpts) {
    this.L = lib(o.sodium)
  }
  get isReady(): boolean {
    return this.ready
  }
  private reset(): void {
    this.out = this.inn = null
    this.keys = null
    this.ready = false
    this.pairedPending = false
  }
  /** Start (or restart) the handshake; called whenever the host shows up on the relay. */
  start(): void {
    const L = this.L
    this.reset()
    this.e = L.newEphemeral()
    this.n = L.nonce()
    const ex = L.b64(this.e.publicKey)
    if (this.o.mode === 'pair' && this.o.qr) {
      const mac = L.pair1Mac(this.o.qr.s, this.o.ppk, ex, this.n, this.o.name)
      this.o.send(JSON.stringify({ t: 'pair1', v: PROTO, ppk: this.o.ppk, ex, n: this.n, name: this.o.name, mac }))
    } else if (this.o.device) {
      const sig = L.sign(this.o.psk, L.c1Msg(this.o.device.room, ex, this.n))
      this.o.send(JSON.stringify({ t: 'c1', v: PROTO, ex, n: this.n, sig }))
    }
  }
  private beginStream(keys: { rx: Uint8Array; tx: Uint8Array }): void {
    this.keys = keys
    this.out = new this.L.Out(keys.tx)
    this.o.send(JSON.stringify({ t: 's', h: this.out.header }))
  }
  receive(frame: string): void {
    const m = parse(frame)
    if (!m) return
    const L = this.L
    try {
      if (m.t === 'peer') {
        const up = m.up === true
        if (up) this.start()
        else this.reset()
        this.o.onPeer?.(up)
        return
      }
      if (m.t === 'deny') {
        this.o.onDenied?.()
        return
      }
      if (m.t === 'pair2' && this.o.mode === 'pair' && this.o.qr && this.e) {
        const hx = str(m.hx, 64), n2 = str(m.n2, 64), sig = str(m.sig, 128)
        if (!hx || !n2 || !sig) return
        const q = this.o.qr
        const ex = L.b64(this.e.publicKey)
        const T = L.pairTranscript(q.dpk, this.o.ppk, ex, hx, this.n, n2, this.o.name)
        if (!L.verify(q.dpk, L.pairSigMsg(T), sig)) return // not the desktop that showed the QR
        const keys = L.sessionKeys('phone', this.e.publicKey, this.e.privateKey, L.unb64(hx), T, L.unb64(q.s))
        this.pairedPending = true
        this.beginStream(keys)
        this.o.onSas?.(L.sas(T, keys.tx)) // phone.tx == p2h
        return
      }
      if (m.t === 'c2' && this.o.mode === 'device' && this.o.device && this.e) {
        const hx = str(m.hx, 64), n2 = str(m.n2, 64), sig = str(m.sig, 128)
        if (!hx || !n2 || !sig) return
        const T = L.reconnectTranscript(this.o.device.room, L.b64(this.e.publicKey), hx, this.n, n2)
        if (!L.verify(this.o.device.dpk, L.c2Msg(T), sig)) return
        this.beginStream(L.sessionKeys('phone', this.e.publicKey, this.e.privateKey, L.unb64(hx), T))
        this.ready = true
        this.o.onReady?.()
        return
      }
      if (m.t === 's') {
        const h = str(m.h, 100)
        if (h && this.keys) this.inn = new L.In(this.keys.rx, h)
        return
      }
      if (m.t === 'd' && this.inn) {
        const c = str(m.c, 1_000_000)
        if (!c) return
        const msg = this.inn.open(c) as Json
        if (this.pairedPending && msg.k === 'paired') {
          this.pairedPending = false
          this.ready = true
          this.o.onReady?.()
          return
        }
        if (!this.ready) return
        this.o.onMessage(msg)
      }
    } catch {
      this.reset()
    }
  }
  send(obj: Json): boolean {
    if (!this.out || !this.ready) return false
    this.o.send(JSON.stringify({ t: 'd', c: this.out.seal(obj) }))
    return true
  }
}

export { PAIR_TTL_MS }
