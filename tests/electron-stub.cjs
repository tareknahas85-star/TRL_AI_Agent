// Test stub for the electron module: only what the core modules touch at runtime.
const os = require('os')
const path = require('path')
const dataDir = () => process.env.TRL_TEST_DATA || path.join(os.tmpdir(), 'trl-test-data')
const app = { getPath: () => dataDir(), getVersion: () => '0.0.0-test', isPackaged: false, on: () => undefined }
const noop = () => undefined
module.exports = new Proxy({ app }, {
  get: (t, k) => (k in t ? t[k] : k === 'safeStorage' ? { isEncryptionAvailable: () => false } : noop),
})