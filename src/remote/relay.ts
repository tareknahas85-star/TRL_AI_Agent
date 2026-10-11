/*
 * Blind relay: pairs a "host" socket and a "guest" socket that name the same room and forwards text frames between them.
 * It never parses application data and stores nothing, so it learns nothing but the (random) room id and traffic sizes.
 * Used embedded in the desktop app (LAN) and standalone (relay/server.mjs, and the Cloudflare Worker has the same behaviour).
 */
import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'http'

const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/
const MAX_FRAME = 700_000
const MAX_ROOMS = 5000

type Room = { host?: WebSocket; guest?: WebSocket }

export type RelayHandle = { port: number; close: () => void; rooms: () => number }

export function attachRelay(server: Server, path = '/ws'): { close: () => void; rooms: () => number } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })
  const rooms = new Map<string, Room>()

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    let url: URL
    try {
      url = new URL(req.url ?? '', 'http://x')
    } catch {
      socket.destroy()
      return
    }
    const room = url.searchParams.get('room') ?? ''
    const role = url.searchParams.get('role')
    if (url.pathname !== path || !ROOM_RE.test(room) || (role !== 'host' && role !== 'guest') || (!rooms.has(room) && rooms.size >= MAX_ROOMS)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConn(ws, room, role))
  })

  const onConn = (ws: WebSocket, id: string, role: 'host' | 'guest'): void => {
    let r = rooms.get(id)
    if (!r) rooms.set(id, (r = {}))
    const other = role === 'host' ? 'guest' : 'host'
    const old = r[role]
    r[role] = ws
    if (old && old !== ws) {
      try {
        old.close(4000, 'replaced')
      } catch {
        /* ignore */
      }
    }
    const note = (to: WebSocket | undefined, up: boolean): void => {
      if (to && to.readyState === 1) to.send(JSON.stringify({ t: 'peer', up }))
    }
    note(ws, !!r[other] && r[other]!.readyState === 1)
    note(r[other], true)

    // crude flood control per 10 s window: 2000 frames or 40 MB
    let count = 0
    let bytes = 0
    const tick = setInterval(() => ((count = 0), (bytes = 0)), 10_000)
    ;(ws as WebSocket & { isAlive?: boolean }).isAlive = true
    ws.on('pong', () => ((ws as WebSocket & { isAlive?: boolean }).isAlive = true))
    ws.on('message', (data, isBinary) => {
      const text = data.toString()
      bytes += text.length
      if (isBinary || ++count > 2000 || bytes > 40_000_000) return
      const peer = rooms.get(id)?.[other]
      if (peer && peer.readyState === 1) peer.send(text)
    })
    ws.on('close', () => {
      clearInterval(tick)
      const cur = rooms.get(id)
      if (!cur) return
      if (cur[role] === ws) {
        delete cur[role]
        note(cur[other], false)
      }
      if (!cur.host && !cur.guest) rooms.delete(id)
    })
    ws.on('error', () => undefined)
  }

  const ping = setInterval(() => {
    for (const c of wss.clients) {
      const w = c as WebSocket & { isAlive?: boolean }
      if (w.isAlive === false) {
        w.terminate()
        continue
      }
      w.isAlive = false
      try {
        w.ping()
      } catch {
        /* ignore */
      }
    }
  }, 25_000)

  return {
    close: () => {
      clearInterval(ping)
      for (const c of wss.clients) c.terminate()
      wss.close()
    },
    rooms: () => rooms.size
  }
}
