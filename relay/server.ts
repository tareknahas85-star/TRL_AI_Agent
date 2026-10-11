// Standalone relay (VPS / Docker / any Node host): `node relay.mjs [port]`. Put it behind TLS (Caddy/nginx/Cloudflare) for wss://.
import http from 'http'
import { attachRelay } from '../src/remote/relay'

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787)
const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' })
  res.end(req.url === '/health' ? 'ok' : 'not found')
})
attachRelay(server)
server.listen(port, () => console.log('relay listening on :' + port))
