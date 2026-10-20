import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { crossedLevel, usagePct, recordClaudeRun, getClaudeUsage, setClaudeCap } from '../src/core/claude-usage'
import { getRoles, setRoles } from '../src/core/roles'
import { workDir, quarantineEmptyFragments } from '../src/core/run-report'
import { recordEngineRun, getEngineSeries } from '../src/core/usage-log'

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'trl-t-'))

test('crossedLevel يعطي أعلى عتبة عبرناها فقط', () => {
  assert.equal(crossedLevel(null, 50), null)
  assert.equal(crossedLevel(60, 75), 70)
  assert.equal(crossedLevel(60, 95), 90)
  assert.equal(crossedLevel(91, 95), null)
  assert.equal(crossedLevel(10, null), null)
})

test('usagePct يأخذ أعلى نسبة من السقفين', () => {
  assert.equal(usagePct({ runs: 5, minutes: 10 }, { capRuns: 0, capMinutes: 0 }), null)
  assert.equal(usagePct({ runs: 5, minutes: 10 }, { capRuns: 10, capMinutes: 0 }), 50)
  assert.equal(usagePct({ runs: 5, minutes: 90 }, { capRuns: 10, capMinutes: 100 }), 90)
})

test('العدّاد يسجّل ويطلع تنبيه عند 70% ومرة وحدة فقط', () => {
  process.env.TRL_TEST_DATA = tmp()
  setClaudeCap({ capRuns: 10, capMinutes: 0 })
  const alerts: (string | null)[] = []
  for (let i = 0; i < 10; i++) alerts.push(recordClaudeRun(1))
  const fired = alerts.filter((a) => a !== null)
  assert.equal(getClaudeUsage().runs, 10)
  assert.equal(fired.length, 2, 'تنبيهين: 70% و90%')
  assert.match(fired[0]!, /70%/)
  assert.match(fired[1]!, /90%/)
})

test('الأدوار: القيمة الغلط بترجع auto، والدمج ما بيمسح الباقي', () => {
  process.env.TRL_TEST_DATA = tmp()
  assert.deepEqual(getRoles(), { manager: 'auto', executor: 'auto', reviewer: 'auto' })
  setRoles({ executor: 'cli:claude' })
  setRoles({ reviewer: 'bogus-engine' as never })
  const r = getRoles()
  assert.equal(r.executor, 'cli:claude')
  assert.equal(r.reviewer, 'auto')
})

test('workDir يختار مجلد build إذا موجود', () => {
  const d = tmp()
  assert.equal(workDir(d), d)
  fs.mkdirSync(path.join(d, 'build'))
  assert.equal(workDir(d), path.join(d, 'build'))
})

test('الملفات الصفرية بأسماء شظايا تنحجر بمجلد build، والملفات العادية ما تنلمس', () => {
  const d = tmp()
  fs.mkdirSync(path.join(d, 'build'))
  const since = Date.now() - 5000
  fs.writeFileSync(path.join(d, 'build', 'drop.focus()'), '')
  fs.writeFileSync(path.join(d, 'build', 'index.html'), '')
  fs.writeFileSync(path.join(d, 'build', 'real.txt'), 'hi')
  const moved = quarantineEmptyFragments(d, since)
  assert.equal(moved.length, 1)
  assert.ok(fs.existsSync(path.join(d, 'build', '_zero-byte-quarantine', 'drop.focus()')))
  assert.ok(fs.existsSync(path.join(d, 'build', 'index.html')))
  assert.ok(fs.existsSync(path.join(d, 'build', 'real.txt')))
})
test('سجل الاستخدام لكل محرّك: يسجّل ويجمع، وكل محرّك بخط لحاله', () => {
  process.env.TRL_TEST_DATA = tmp()
  recordEngineRun('cli:gemini', 2)
  recordEngineRun('cli:gemini', 3)
  recordEngineRun('cli:codex', 1)
  const s = getEngineSeries(14)
  assert.equal(s.days.length, 14)
  const g = s.engines.find((e) => e.engine === 'cli:gemini')!
  assert.equal(g.totalRuns, 2)
  assert.equal(g.totalMinutes, 5)
  assert.equal(s.engines.find((e) => e.engine === 'cli:codex')!.totalRuns, 1)
  assert.equal(s.engines.find((e) => e.engine === 'cli:claude'), undefined)
})
// --- F11: IPC sender trust (src/main/ipc-trust.ts) ---
import { pathToFileURL } from 'url'
import { isTrustedSenderUrl } from '../src/main/ipc-trust'

test('IPC: مرسل بدون عنوان مرفوض', () => {
  assert.equal(isTrustedSenderUrl(undefined, { rendererDir: '/x' }), false)
  assert.equal(isTrustedSenderUrl('', { rendererDir: '/x' }), false)
})

test('IPC: ملف داخل مجلد الـ renderer مقبول، وخارجه مرفوض', () => {
  const rend = path.join(os.tmpdir(), 'rend')
  const opts = { rendererDir: rend }
  assert.equal(isTrustedSenderUrl(pathToFileURL(path.join(rend, 'index.html')).href, opts), true)
  assert.equal(isTrustedSenderUrl(pathToFileURL(path.join(os.tmpdir(), 'evil', 'x.html')).href, opts), false)
})

test('IPC: اسم مجلد يبدأ بنفس الاسم (rend2) ما يخدع الفحص', () => {
  const rend = path.join(os.tmpdir(), 'rend')
  assert.equal(isTrustedSenderUrl(pathToFileURL(rend + '2/index.html').href, { rendererDir: rend }), false)
})

test('IPC: التطوير يقبل نفس الأصل فقط', () => {
  const opts = { rendererDir: '/x', devUrl: 'http://localhost:5173' }
  assert.equal(isTrustedSenderUrl('http://localhost:5173/index.html', opts), true)
  assert.equal(isTrustedSenderUrl('http://evil.example/index.html', opts), false)
  assert.equal(isTrustedSenderUrl('http://localhost:5173/index.html', { rendererDir: '/x' }), false)
  assert.equal(isTrustedSenderUrl('not a url', opts), false)
})
