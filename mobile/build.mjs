import { build } from 'esbuild'
import fs from 'fs'
const VER = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'www/app.js',
  format: 'iife',
  platform: 'browser',
  target: ['chrome90'],
  logLevel: 'info',
  // libsodium's node-only branches are never taken in a WebView
  external: ['fs', 'path', 'crypto'],
  // the ESM build of libsodium-wrappers expects a sibling file; the CommonJS build is self-contained
  alias: { 'libsodium-wrappers': './node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js' },
  define: { 'process.env.NODE_ENV': '"production"', __APP_VERSION__: JSON.stringify(VER) }
})
fs.copyFileSync('src/index.html', 'www/index.html')
fs.copyFileSync('src/style.css', 'www/style.css')
console.log('bundle ok')
