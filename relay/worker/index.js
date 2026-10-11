// Blind WebSocket relay for the TRL phone link, as a Cloudflare Worker + Durable Object (free plan works).
// It only forwards opaque, end-to-end encrypted frames between the "host" (desktop) and "guest" (phone) of a random room id.
const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname !== '/ws' || request.headers.get('Upgrade') !== 'websocket') return new Response('not found', { status: 404 })
    const room = url.searchParams.get('room') || ''
    const role = url.searchParams.get('role')
    if (!ROOM_RE.test(room) || (role !== 'host' && role !== 'guest')) return new Response('bad request', { status: 400 })
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request)
  }
}

export class Room {
  constructor(state) {
    this.state = state
  }
  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role')
    const other = role === 'host' ? 'guest' : 'host'
    // a newer connection with the same role replaces the old one
    for (const old of this.state.getWebSockets(role)) {
      try { old.close(4000, 'replaced') } catch {}
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server, [role])
    const others = this.state.getWebSockets(other)
    try { server.send(JSON.stringify({ t: 'peer', up: others.length > 0 })) } catch {}
    for (const o of others) { try { o.send(JSON.stringify({ t: 'peer', up: true })) } catch {} }
    return new Response(null, { status: 101, webSocket: client })
  }
  webSocketMessage(ws, message) {
    if (typeof message !== 'string') return
    const role = this.state.getTags(ws)[0]
    const other = role === 'host' ? 'guest' : 'host'
    for (const o of this.state.getWebSockets(other)) { try { o.send(message) } catch {} }
  }
  webSocketClose(ws) { this.#gone(ws) }
  webSocketError(ws) { this.#gone(ws) }
  #gone(ws) {
    const role = this.state.getTags(ws)[0]
    const other = role === 'host' ? 'guest' : 'host'
    for (const o of this.state.getWebSockets(other)) { try { o.send(JSON.stringify({ t: 'peer', up: false })) } catch {} }
    try { ws.close() } catch {}
  }
}
