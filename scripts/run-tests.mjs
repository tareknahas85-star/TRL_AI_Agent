// Bundles the core tests with esbuild (electron replaced by a stub) and runs them with node:test.
import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(os.tmpdir(), 'trl-core-tests.cjs')
await build({
  entryPoints: [path.join(root, 'tests', 'core.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'warning',
  plugins: [
    {
      name: 'electron-stub',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(root, 'tests', 'electron-stub.cjs') }))
      },
    },
  ],
})
const r = spawnSync(process.execPath, ['--test', out], { stdio: 'inherit' })
process.exit(r.status ?? 1)