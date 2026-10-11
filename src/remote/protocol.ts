/*
 * Remote-control protocol (desktop <-> phone), end-to-end encrypted. Runs in Node (Electron main) and in the phone's WebView.
 *
 *  - Identity keys: Ed25519 (desktop `dpk`, phone `ppk`). Pairing is bootstrapped by a QR code carrying `dpk` and a one-time secret.
 *  - Every connection derives fresh session keys from ephemeral X25519 keys (forward secrecy), authenticated by the identity keys.
 *  - After the handshake all traffic is libsodium secretstream (XChaCha20-Poly1305): ordered, replay-proof, tamper-proof, padded.
 *  - The relay only forwards opaque frames; it never sees keys or plaintext.
 */
import type SodiumDefault from 'libsodium-wrappers'
export type Sodium = typeof SodiumDefault

export const PROTO = 1
export const PAIR_TTL_MS = 120_000

export type QrPayload = { v: number; u: string[]; room: string; dpk: string; s: string; exp: number; name: string }
export type Keypair = { pk: string; sk: string }

const enc = new TextEncoder()
const dec = new TextDecoder()

export function lib(s: Sodium) {
  const b64 = (u: Uint8Array): string => s.to_base64(u, s.base64_variants.URLSAFE_NO_PADDING)
  const unb64 = (t: string): Uint8Array => s.from_base64(t, s.base64_variants.URLSAFE_NO_PADDING)
  const cat = (...parts: (Uint8Array | string)[]): Uint8Array => {
    const arr = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p))
    const out = new Uint8Array(arr.reduce((n, a) => n + a.length + 2, 0))
    let o = 0
    for (const a of arr) {
      out[o++] = (a.length >> 8) & 255 // length-prefixed so different splits never collide
      out[o++] = a.length & 255
      out.set(a, o)
      o += a.length
    }
    return out
  }
  const hash = (len: number, msg: Uint8Array, key?: Uint8Array): Uint8Array => s.crypto_generichash(len, msg, key ?? null)
  const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && s.memcmp(a, b)

  const newIdentity = (): Keypair => {
    const k = s.crypto_sign_keypair()
    return { pk: b64(k.publicKey), sk: b64(k.privateKey) }
  }
  const sign = (sk: string, msg: Uint8Array): string => b64(s.crypto_sign_detached(msg, unb64(sk)))
  const verify = (pk: string, msg: Uint8Array, sig: string): boolean => {
    try {
      return s.crypto_sign_verify_detached(unb64(sig), msg, unb64(pk))
    } catch {
      return false
    }
  }
  const newEphemeral = () => s.crypto_kx_keypair()
  const nonce = (): string => b64(s.randombytes_buf(16))
  const roomOf = (dpk: string, ppk: string): string => b64(hash(16, cat('room', unb64(dpk), unb64(ppk))))
  const newPairSecret = (): string => b64(s.randombytes_buf(32))
  const newPairRoom = (): string => b64(s.randombytes_buf(16))

  // ---- handshake pieces ----
  const pair1Mac = (secret: string, ppk: string, ex: string, n: string, name: string): string =>
    b64(hash(32, cat('pair1', String(PROTO), unb64(ppk), unb64(ex), unb64(n), name), unb64(secret)))
  const pairTranscript = (dpk: string, ppk: string, ex: string, hx: string, n: string, n2: string, name: string): Uint8Array =>
    hash(32, cat('pairT', unb64(dpk), unb64(ppk), unb64(ex), unb64(hx), unb64(n), unb64(n2), name))
  const reconnectTranscript = (room: string, ex: string, hx: string, n: string, n2: string): Uint8Array =>
    hash(32, cat('recT', unb64(room), unb64(ex), unb64(hx), unb64(n), unb64(n2)))
  const c1Msg = (room: string, ex: string, n: string): Uint8Array => cat('c1', unb64(room), unb64(ex), unb64(n))
  const c2Msg = (T: Uint8Array): Uint8Array => cat('c2', T)
  const pairSigMsg = (T: Uint8Array): Uint8Array => cat('pair2', T)

  /** Directional stream keys. `role` is who is calling: the phone is the kx client, the desktop the kx server. */
  const sessionKeys = (role: 'phone' | 'host', myPk: Uint8Array, mySk: Uint8Array, peerPk: Uint8Array, T: Uint8Array, extra?: Uint8Array) => {
    const k = role === 'phone' ? s.crypto_kx_client_session_keys(myPk, mySk, peerPk) : s.crypto_kx_server_session_keys(myPk, mySk, peerPk)
    const mix = (label: string, raw: Uint8Array): Uint8Array => hash(32, cat(label, raw, extra ?? new Uint8Array(0)), T)
    // kx: client.tx == server.rx. Name the two directions explicitly so both sides agree.
    return { rx: mix(role === 'phone' ? 'h2p' : 'p2h', k.sharedRx), tx: mix(role === 'phone' ? 'p2h' : 'h2p', k.sharedTx) }
  }
  /** 6-digit code both screens show; equal on both sides unless somebody sits in the middle. */
  const sas = (T: Uint8Array, p2hKey: Uint8Array): string => {
    const h = hash(4, cat('sas', T, p2hKey))
    const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0
    return String(n % 1_000_000).padStart(6, '0')
  }

  // ---- encrypted stream ----
  const PAD = 256
  class Out {
    private st
    readonly header: string
    constructor(key: Uint8Array) {
      const i = s.crypto_secretstream_xchacha20poly1305_init_push(key)
      this.st = i.state
      this.header = b64(i.header)
    }
    seal(obj: unknown): string {
      const padded = s.pad(enc.encode(JSON.stringify(obj)), PAD)
      return b64(s.crypto_secretstream_xchacha20poly1305_push(this.st, padded, null, s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE))
    }
  }
  class In {
    private st
    constructor(key: Uint8Array, header: string) {
      this.st = s.crypto_secretstream_xchacha20poly1305_init_pull(unb64(header), key)
    }
    open(c: string): unknown {
      const r = s.crypto_secretstream_xchacha20poly1305_pull(this.st, unb64(c), null)
      if (!r) throw new Error('bad frame')
      return JSON.parse(dec.decode(s.unpad(r.message, PAD)))
    }
  }

  return { b64, unb64, newIdentity, sign, verify, newEphemeral, nonce, roomOf, newPairSecret, newPairRoom, pair1Mac, pairTranscript, reconnectTranscript, c1Msg, c2Msg, pairSigMsg, sessionKeys, sas, Out, In, eq, cat, hash }
}
export type Lib = ReturnType<typeof lib>

/** What the phone signs to approve a request: bound to the request id, its content hash, the verdict and the expiry. */
export const approvalMsg = (L: Lib, id: string, hash: string, ok: boolean, exp: number): Uint8Array => L.cat('approval', id, hash, ok ? '1' : '0', String(exp))
export const approvalHash = (L: Lib, title: string, detail: string): string => L.b64(L.hash(16, L.cat('req', title, detail)))
