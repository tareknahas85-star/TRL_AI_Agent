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

// --- F13: atomic write (src/core/json-atomic.ts) ---
import { writeFileAtomic } from '../src/core/json-atomic'

test('F13: الكتابة الذرّية تنشئ الملف وتستبدله بدون بقايا مؤقتة', () => {
  const dir = tmp()
  const file = path.join(dir, 'data.json')
  writeFileAtomic(file, '{"a":1}')
  assert.equal(fs.readFileSync(file, 'utf-8'), '{"a":1}')
  writeFileAtomic(file, '{"a":2}')
  assert.equal(fs.readFileSync(file, 'utf-8'), '{"a":2}')
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
})

test('F13: فشل الكتابة يترك الملف القديم سليماً', () => {
  const dir = tmp()
  const file = path.join(dir, 'data.json')
  writeFileAtomic(file, 'OLD')
  // Target is a directory: rename must fail, and the old content must survive.
  const blocker = path.join(dir, 'blocked')
  fs.mkdirSync(blocker)
  assert.throws(() => writeFileAtomic(blocker, 'NEW'))
  assert.equal(fs.readFileSync(file, 'utf-8'), 'OLD')
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [])
})

// --- F01–F04: scheduling math (src/core/schedule-time.ts) ---
import { zonedParts, zonedToUtc, lastDueSlot, intervalSlot, isScheduleDue, isValidTimeZone, systemTz } from '../src/core/schedule-time'

const RIY = 'Asia/Riyadh'
const NY = 'America/New_York'
const MIN = 60000

test('F02: تحويل الوقت الجداري لمنطقة IANA (الرياض UTC+3 بدون توقيت صيفي)', () => {
  assert.equal(zonedToUtc(2026, 10, 20, 12, 0, RIY), Date.UTC(2026, 9, 20, 9, 0))
  const p = zonedParts(Date.UTC(2026, 9, 20, 9, 0), RIY)
  assert.equal(p.h, 12)
  assert.equal(p.dow, 2) // Tuesday
})

test('F02: التوقيت الصيفي في نيويورك (EDT = UTC-4)', () => {
  assert.equal(zonedToUtc(2026, 7, 1, 12, 0, NY), Date.UTC(2026, 6, 1, 16, 0))
  // Day DST starts (2026-03-08): the 12:00 wall time is already EDT
  assert.equal(zonedToUtc(2026, 3, 8, 12, 0, NY), Date.UTC(2026, 2, 8, 16, 0))
})

test('F02: منطقة غير صحيحة مرفوضة، والمنطقة الافتراضية موجودة', () => {
  assert.equal(isValidTimeZone(RIY), true)
  assert.equal(isValidTimeZone('Mars/Base'), false)
  assert.ok(systemTz().length > 0)
})

test('daily: آخر موعد قبل الآن، حتى لو قبل ساعة من الموعد اليوم يرجع لأمس', () => {
  const t = { enabled: true, kind: 'daily' as const, time: '12:00', days: [], everyMin: 60, createdAt: 0, tz: RIY }
  const at11 = zonedToUtc(2026, 10, 20, 11, 0, RIY)
  const at13 = zonedToUtc(2026, 10, 20, 13, 0, RIY)
  assert.equal(lastDueSlot(t, at11), zonedToUtc(2026, 10, 19, 12, 0, RIY))
  assert.equal(lastDueSlot(t, at13), zonedToUtc(2026, 10, 20, 12, 0, RIY))
})

test('weekly: يتجاهل الأيام غير المحددة (الاثنين فقط، الآن الثلاثاء)', () => {
  const t = { enabled: true, kind: 'weekly' as const, time: '12:00', days: [1], everyMin: 60, createdAt: 0, tz: RIY }
  const tue13 = zonedToUtc(2026, 10, 20, 13, 0, RIY)
  assert.equal(lastDueSlot(t, tue13), zonedToUtc(2026, 10, 19, 12, 0, RIY)) // Monday 19 Oct
})

test('F03: الفترة على شبكة ثابتة من وقت الإنشاء وما تنجرف', () => {
  const created = 0
  assert.equal(intervalSlot(created, 10, 5 * MIN), null) // first slot is one step after creation
  assert.equal(intervalSlot(created, 10, 25 * MIN), 20 * MIN)
  assert.equal(intervalSlot(created, 10, 20 * MIN), 20 * MIN)
})

test('F03: فترة تشغّل مرة لكل خانة من الشبكة، حتى لو تأخر التشغيل', () => {
  const t = { enabled: true, kind: 'interval' as const, time: '12:00', days: [], everyMin: 10, createdAt: 0 }
  assert.equal(isScheduleDue(t, 25 * MIN, false), true) // slot 20 not run yet
  assert.equal(isScheduleDue({ ...t, lastRun: 21 * MIN }, 25 * MIN, false), false) // slot 20 already covered
  assert.equal(isScheduleDue({ ...t, lastRun: 21 * MIN }, 31 * MIN, false), true) // slot 30 is new
})

test('F01: مهمة مرة وحدة تشتغل بالوقت المحدد وما تتكرر', () => {
  const runAt = Date.UTC(2026, 9, 21, 9, 0)
  const t = { enabled: true, kind: 'once' as const, time: '12:00', days: [], everyMin: 60, createdAt: 0, runAt }
  assert.equal(isScheduleDue(t, runAt - 1, false), false)
  assert.equal(isScheduleDue(t, runAt, false), true)
  assert.equal(isScheduleDue({ ...t, lastRun: runAt + 5000 }, runAt + 60 * MIN, false), false)
})

test('F04/الأساسي: مهمة معطّلة أو قيد التنفيذ ما تنشغّل', () => {
  const runAt = Date.UTC(2026, 9, 21, 9, 0)
  const t = { enabled: true, kind: 'once' as const, time: '12:00', days: [], everyMin: 60, createdAt: 0, runAt }
  assert.equal(isScheduleDue({ ...t, enabled: false }, runAt, false), false)
  assert.equal(isScheduleDue(t, runAt, true), false)
})
