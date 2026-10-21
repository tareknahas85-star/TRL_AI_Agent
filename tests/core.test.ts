import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { crossedLevel, usagePct, recordClaudeRun, getClaudeUsage, setClaudeCap } from '../src/core/claude-usage'
import { getRoles, setRoles } from '../src/core/roles'
import { workDir, quarantineEmptyFragments } from '../src/core/run-report'
import { recordEngineRun, getEngineSeries } from '../src/core/usage-log'
import { createStreamBatcher } from '../src/core/stream-batch'
import { rotateLogFile, LOG_MAX_BYTES } from '../src/core/log-rotate'
import { checkSideUrl, clampSideWidth, windowWidthFor } from '../src/core/side-url'
import { interpretRelease, interpretFailure, describeUpdate, isNewer, shouldPrompt, POSTPONE_MS } from '../src/core/update-state'

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

// --- F06: backoff for failed tasks ---
import { retryDelayMs, MAX_FAILS } from '../src/core/schedule-time'

test('F06: تأخير الإعادة يتضاعف ومحدود بـ 6 ساعات', () => {
  assert.equal(retryDelayMs(0), 0)
  assert.equal(retryDelayMs(1), 5 * MIN)
  assert.equal(retryDelayMs(2), 10 * MIN)
  assert.equal(retryDelayMs(3), 20 * MIN)
  assert.equal(retryDelayMs(4), 40 * MIN)
  assert.equal(retryDelayMs(30), 6 * 3600000)
})

test('F06: مهمة يومية فشلت تنعاد بعد التأخير، ومهمة ما فشلت ما تنعاد', () => {
  const slot = zonedToUtc(2026, 10, 20, 12, 0, RIY)
  const base = { enabled: true, kind: 'daily' as const, time: '12:00', days: [], everyMin: 60, createdAt: 0, tz: RIY, lastRun: slot + 10000 }
  assert.equal(isScheduleDue({ ...base, failStreak: 1 }, slot + 2 * MIN, false), false) // still backing off
  assert.equal(isScheduleDue({ ...base, failStreak: 1 }, slot + 6 * MIN, false), true) // retry after 5 min
  assert.equal(isScheduleDue({ ...base, failStreak: 0 }, slot + 6 * MIN, false), false) // no failure, no retry
})

test('F06: بعد الحد الأقصى من الفشلات ما تنعاد تلقائياً', () => {
  const slot = zonedToUtc(2026, 10, 20, 12, 0, RIY)
  const t = { enabled: true, kind: 'daily' as const, time: '12:00', days: [], everyMin: 60, createdAt: 0, tz: RIY, lastRun: slot + 10000, failStreak: MAX_FAILS }
  assert.equal(isScheduleDue(t, slot + 6 * 3600000, false), false)
})

test('F06: فترة فشلت تنعاد بعد التأخير دون ما تكرر الخانة الناجحة', () => {
  const t = { enabled: true, kind: 'interval' as const, time: '12:00', days: [], everyMin: 10, createdAt: 0, lastRun: 20 * MIN + 5000, failStreak: 1 }
  assert.equal(isScheduleDue(t, 25 * MIN + 4000, false), false) // retry not ready yet (delay is 5 min after the failed run)
  assert.equal(isScheduleDue(t, 25 * MIN + 5000, false), true) // exactly 5 min after the failed run: ready
  assert.equal(isScheduleDue(t, 26 * MIN, false), true)
})

test('F06: مهمة مرة وحدة فشلت تنعاد بتأخير', () => {
  const runAt = Date.UTC(2026, 9, 21, 9, 0)
  const t = { enabled: true, kind: 'once' as const, time: '12:00', days: [], everyMin: 60, createdAt: 0, runAt, lastRun: runAt + 1, failStreak: 1 }
  assert.equal(isScheduleDue(t, runAt + MIN, false), false)
  assert.equal(isScheduleDue(t, runAt + 6 * MIN, false), true)
})

// --- F07–F08: LLM backoff + Retry-After (src/core/rate-limit.ts, pure) ---
import { isRateLimitError, parseRetryAfterMs, cooldownMs, RL_CAP_MS } from '../src/core/rate-limit'

test('F07: خطأ الحد (429/503 أو نص الحد) يُعتبر حد؛ الفوترة والرصيد لا', () => {
  assert.equal(isRateLimitError(429, ''), true)
  assert.equal(isRateLimitError(503, 'overloaded'), true)
  assert.equal(isRateLimitError(undefined, 'Rate limit reached for model'), true)
  assert.equal(isRateLimitError(400, 'bad request'), false)
  assert.equal(isRateLimitError(429, 'insufficient credit balance'), false)
  assert.equal(isRateLimitError(429, 'free-models-per-day'), false) // handled by the daily-limit logic
})

test('F08: Retry-After بثواني، وبتاريخ HTTP، وقيم غلط', () => {
  const now = Date.UTC(2026, 9, 20, 10, 0, 0)
  assert.equal(parseRetryAfterMs('120', now), 120000)
  assert.equal(parseRetryAfterMs(new Date(now + 90000).toUTCString(), now), 90000)
  assert.equal(parseRetryAfterMs(null, now), null)
  assert.equal(parseRetryAfterMs('abc', now), null)
  assert.equal(parseRetryAfterMs('0', now), 0)
})

test('F07: التبريد يتضاعف بدون Retry-After: 30ث، 60ث، 120ث … وبسقف 30 دقيقة', () => {
  assert.equal(cooldownMs(1, null), 30000)
  assert.equal(cooldownMs(2, null), 60000)
  assert.equal(cooldownMs(3, null), 120000)
  assert.equal(cooldownMs(30, null), RL_CAP_MS)
})

test('F08: Retry-After يتقدّم على الحساب الافتراضي، لكن بالسقف، وصفر يعني ما فيه قيمة', () => {
  assert.equal(cooldownMs(1, 120000), 120000)
  assert.equal(cooldownMs(1, 99999999), RL_CAP_MS)
  assert.equal(cooldownMs(1, 0), 30000) // zero is not a usable value: fall back to the default
})

// --- Strong-first policy: a complex request never drops to a weaker model while a strong one is busy ---
import { refuseDowngrade, STRONG_WAIT_MAX_SEC } from '../src/core/strong-policy'

test('policy: موديل قوي ما يتمنع أبداً', () => {
  assert.equal(refuseDowngrade('anthropic/claude', ['anthropic/claude'], ['anthropic/claude'], true), false)
})

test('policy: لو ما في قوي بالقائمة أصلاً (إعداد مجاني فقط) ما نمنع', () => {
  assert.equal(refuseDowngrade('openrouter/free-x', [], [], false), false)
})

test('policy: موديل أضعف + قوي مشغول = ممنوع النزول', () => {
  assert.equal(refuseDowngrade('google/gemini-cheap', ['anthropic/claude'], ['anthropic/claude'], false), true)
})

test('policy: حد الانتظار 60 ثانية', () => {
  assert.equal(STRONG_WAIT_MAX_SEC, 60)
})

test('F30: الدفعات تحفظ الترتيب ومافي تكرار', () => {
  const sent: string[] = []
  const b = createStreamBatcher((k, t) => sent.push(k + ':' + (t ?? '')), 1000)
  b.chunk('مرحبا ')
  b.chunk('من ')
  b.chunk('الكمبيوتر')
  b.flush()
  assert.deepEqual(sent, ['chunk:مرحبا من الكمبيوتر'])
  b.flush()
  assert.equal(sent.length, 1, 'flush بدون نص ما يرسل شي')
})

test('F30: reset يمسح النص المعلّق قبل ما يوصل (ما يطلع نص محاولة فاشلة)', () => {
  const sent: string[] = []
  const b = createStreamBatcher((k, t) => sent.push(k + ':' + (t ?? '')), 1000)
  b.chunk('نص فشل')
  b.reset()
  b.chunk('نص جديد')
  b.flush()
  assert.deepEqual(sent, ['reset:', 'chunk:نص جديد'])
})

test('F30: الدفعة تنرسل تلقائياً بعد المهلة بدون flush', async () => {
  const sent: string[] = []
  const b = createStreamBatcher((k, t) => sent.push(k + ':' + (t ?? '')), 10)
  b.chunk('أ')
  b.chunk('ب')
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(sent, ['chunk:أب'])
})

test('F30: سجل أكبر من الحد يتدوّر لملف .1، والصغير ما ينقل', () => {
  const dir = tmp()
  const file = path.join(dir, 'router.log')
  fs.writeFileSync(file, 'x'.repeat(200))
  rotateLogFile(file, 100)
  assert.equal(fs.existsSync(file + '.1'), true)
  assert.equal(fs.existsSync(file), false)
  fs.writeFileSync(file, 'small')
  rotateLogFile(file, 100)
  assert.equal(fs.readFileSync(file, 'utf8'), 'small')
  assert.equal(LOG_MAX_BYTES, 2 * 1024 * 1024)
  rotateLogFile(path.join(dir, 'missing.log'))
})

test('F28: رابط بدون بروتوكول يصير https', () => {
  const r = checkSideUrl('example.com/path?q=1')
  assert.deepEqual(r, { ok: true, url: 'https://example.com/path?q=1' })
})

test('F28: http و https مقبولين', () => {
  assert.equal(checkSideUrl('http://example.com').ok, true)
  assert.equal(checkSideUrl('https://example.com').ok, true)
})

test('F28: بروتوكولات خطرة مرفوضة (file, javascript, data)', () => {
  assert.equal(checkSideUrl('file:///C:/Windows/system.ini').ok, false)
  assert.equal(checkSideUrl('javascript:alert(1)').ok, false)
  assert.equal(checkSideUrl('data:text/html,<b>x</b>').ok, false)
})

test('F28: رابط فيه كلمة مرور مرفوض', () => {
  const r = checkSideUrl('https://user:secret@example.com')
  assert.equal(r.ok, false)
})

test('F28: فاضي أو طويل زيادة مرفوض', () => {
  assert.equal(checkSideUrl('   ').ok, false)
  assert.equal(checkSideUrl('https://example.com/' + 'a'.repeat(3000)).ok, false)
})

test('F28: نص مش رابط مرفوض', () => {
  assert.equal(checkSideUrl('هذا مش رابط ..').ok, false)
})

test('F28: عرض اللوحة يتقيّد بحدودها فقط', () => {
  assert.equal(clampSideWidth(100), 320)
  assert.equal(clampSideWidth(2000), 900)
  assert.equal(clampSideWidth(500), 500)
})

test('F28: قيمة مش رقم ترجع للحد الأدنى', () => {
  assert.equal(clampSideWidth(Number.NaN), 320)
})

test('F28: النافذة تتوسّع لتتسع اللوحة مع الشات والشريط', () => {
  // 900px نافذة + لوحة 420px = لازم 280 + 420 + 420 = 1120
  assert.equal(windowWidthFor(900, 420, 1920), 1120)
})

test('F28: النافذة ما تتصغّر أبداً', () => {
  assert.equal(windowWidthFor(1600, 420, 1920), 1600)
})

test('F28: النافذة ما تتجاوز عرض الشاشة', () => {
  assert.equal(windowWidthFor(900, 900, 1280), 1280)
})

test('F23: الإصدار الأحدث يُعلَن كـ available مع الرابط', () => {
  const r = interpretRelease(200, { tag_name: 'v5.17.0', html_url: 'https://github.com/x/y/releases/tag/v5.17.0' }, '5.16.0')
  assert.equal(r.status, 'available')
  assert.equal(r.latest, 'v5.17.0')
  assert.equal(r.url, 'https://github.com/x/y/releases/tag/v5.17.0')
})

test('F23: نفس الإصدار أو أقدم = current', () => {
  assert.equal(interpretRelease(200, { tag_name: 'v5.16.0' }, '5.16.0').status, 'current')
  assert.equal(interpretRelease(200, { tag_name: 'v5.15.9' }, '5.16.0').status, 'current')
})

test('F23: 404 = لا يوجد إصدار منشور', () => {
  assert.equal(interpretRelease(404, null, '5.16.0').status, 'no-release')
})

test('F23: 200 بدون tag_name = لا يوجد إصدار', () => {
  assert.equal(interpretRelease(200, {}, '5.16.0').status, 'no-release')
})

test('F23: 403 مع remaining=0 = تجاوز الحد، ويقرأ وقت الإعادة', () => {
  const r = interpretRelease(403, null, '5.16.0', { remaining: '0', reset: '1800000000' }, 0)
  assert.equal(r.status, 'rate-limited')
  assert.equal(r.retryAt, 1800000000 * 1000)
})

test('F23: 429 = تجاوز الحد، وبدون وقت إعادة يقدّر ساعة من الآن', () => {
  const r = interpretRelease(429, null, '5.16.0', {}, 1000)
  assert.equal(r.status, 'rate-limited')
  assert.equal(r.retryAt, 1000 + 3600_000)
})

test('F23: 500 أو أي رد غير ناجح = error', () => {
  assert.equal(interpretRelease(500, null, '5.16.0').status, 'error')
})

test('F23: انتهاء المهلة = timeout', () => {
  const err = new Error('The operation was aborted due to timeout')
  err.name = 'TimeoutError'
  assert.equal(interpretFailure(err, '5.16.0').status, 'timeout')
})

test('F23: انقطاع الاتصال (fetch يرمي TypeError) = offline', () => {
  assert.equal(interpretFailure(new TypeError('fetch failed'), '5.16.0').status, 'offline')
})

test('F23: أي خطأ آخر = error', () => {
  assert.equal(interpretFailure(new Error('boom'), '5.16.0').status, 'error')
})

test('F23: isNewer تقارن الأرقام لا النص', () => {
  assert.equal(isNewer('5.10.0', '5.9.0'), true)
  assert.equal(isNewer('5.9.0', '5.10.0'), false)
  assert.equal(isNewer('v6.0.0', '5.16.0'), true)
  assert.equal(isNewer('5.16.0', '5.16.0'), false)
})

test('F23: كل حالة لها نص عربي مختلف وواضح', () => {
  const statuses = ['current', 'available', 'no-release', 'rate-limited', 'offline', 'timeout', 'error'] as const
  const texts = statuses.map((s) => describeUpdate({ status: s, current: '5.16.0', latest: 'v5.17.0' }))
  assert.equal(new Set(texts).size, statuses.length)
  for (const t of texts) assert.ok(t.length > 0)
})

test('F23: يسأل المستخدم فقط إذا في إصدار أجدد ومو مؤجّل', () => {
  const avail = { status: 'available' as const, current: '5.16.0', latest: 'v5.17.0' }
  assert.equal(shouldPrompt(avail, 0, 1000), true)
})

test('F23: ما يسأل إذا الإصدار الحالي هو الأحدث', () => {
  assert.equal(shouldPrompt({ status: 'current', current: '5.16.0' }, 0, 1000), false)
})

test('F23: ما يسأل إذا كان المستخدم قال "بعدين" ولسا ما انتهت المهلة', () => {
  const avail = { status: 'available' as const, current: '5.16.0', latest: 'v5.17.0' }
  const snoozeUntil = 1000 + POSTPONE_MS
  assert.equal(shouldPrompt(avail, snoozeUntil, 1000 + POSTPONE_MS - 1), false)
  assert.equal(shouldPrompt(avail, snoozeUntil, 1000 + POSTPONE_MS), true)
})

test('F23: المهلة المؤجّلة = 24 ساعة', () => {
  assert.equal(POSTPONE_MS, 24 * 3600 * 1000)
})

import { strongRequiredFor } from '../src/core/strong-policy'

test('allowWeaker: الطلب المعقّد يبقى على موديلات قوية إلا إذا المستخدم وافق على الخفيف', () => {
  assert.equal(strongRequiredFor(false, 'complex', false), true)
  assert.equal(strongRequiredFor(true, 'complex', false), false)
})

test('allowWeaker: طلب فيه أدوات يبقى قوي حتى لو البساطة', () => {
  assert.equal(strongRequiredFor(false, 'simple', true), true)
  assert.equal(strongRequiredFor(false, 'simple', false), false)
})
