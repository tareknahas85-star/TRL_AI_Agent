// New tabs for the phone app: agents (run them), scheduled tasks, reports, and "more" (projects, models, connection).
// Pure view code: every function takes the shared context (state + helpers) from main.js.
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const RUNON = { local: 'محلي', cloud: 'سحابي', auto: 'تلقائي' }
const TIER = { free: 'مجاني', cheap: 'رخيص', sub: 'اشتراك', custom: 'مخصص', other: 'مدفوع' }
const TIERC = { free: 'var(--ok)', cheap: 'var(--pri)', sub: '#a78bfa', custom: 'var(--warn)', other: 'var(--dng)' }

export const ago = (t) => {
  if (!t) return 'ما اشتغلت لسا'
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'هلأ'
  if (m < 60) return 'من ' + m + ' دقيقة'
  const h = Math.round(m / 60)
  if (h < 48) return 'من ' + h + ' ساعة'
  return 'من ' + Math.round(h / 24) + ' يوم'
}
const when = (t) => (t ? new Date(t).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' }) : '-')
const kindTxt = (t) =>
  t.kind === 'daily' ? 'يومياً الساعة ' + t.time
    : t.kind === 'weekly' ? 'أسبوعياً (' + (t.days || []).map((d) => DAYS[d]).join('، ') + ') ' + t.time
      : 'كل ' + (t.everyMin >= 60 && t.everyMin % 60 === 0 ? t.everyMin / 60 + ' ساعة' : t.everyMin + ' دقيقة')
const EAGLE = '<img class="eagle" src="syria-eagle.svg" alt="">'
const head = (icon, title, sub, right = '') =>
  '<div class="ph"><div class="phi">' + icon + '</div><div class="pht"><h2>' + title + '</h2><div class="mut">' + sub + '</div></div>' + right + '</div>'
const empty = (msg) => '<div class="emp">' + msg + '</div>'

// ---------- agents ----------
export function feedHtml(c) {
  const { S, esc, md } = c
  const q = S.tgQuiet === true
  let h = '<div class="card"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1"><b>إشعارات تيليغرام</b><div class="mut">' + (q ? 'مسكّرة: النتائج بتطلع هون بس.' : 'شغّالة: النتائج بتنبعت لتيليغرام كمان.') + '</div></div><button class="chip' + (q ? ' pri' : '') + '" data-tgq="1">' + (q ? 'شغّلها' : 'سكّرها') + '</button></div>' +
    '<div class="acts" style="margin-top:10px"><button class="btn danger" data-stopall="1">■ أوقف كل المهام</button><button class="chip" data-feedclear="1">مسح القائمة</button></div></div>'
  const items = [...(S.feed || [])].reverse()
  if (!items.length) return h + empty('ما في نتائج لسا. أي وكيل بيخلص (مجدول أو مشغّل من أي مكان) بتطلع نتيجتو هون.')
  return h + items.map((i) => {
    const open = S.feedOpen === i.n
    return '<div class="card' + (open ? ' open' : '') + '" data-feedopen="' + i.n + '"><div><b>' + (i.kind === 'fail' ? '⚠️ ' : '✅ ') + esc(i.agent || 'مهمة') + '</b><span class="mut"> · ' + esc(when(i.ts)) + '</span></div>' +
      (open
        ? '<div class="msg bot' + (i.kind === 'fail' ? ' err' : '') + '" style="margin-top:8px">' + md(i.text || '') + '</div>' + (i.task ? '<div class="mut" style="margin-top:6px">المهمة: ' + esc(i.task) + '</div>' : '')
        : '<div class="mut ag-h">' + esc(String(i.text || '').replace(/\s+/g, ' ').slice(0, 120)) + '</div>') + '</div>'
  }).join('')
}

export function agentsHtml(c) {
  const { S, esc, md, fmtDur } = c
  const online = S.conn === 'online'
  let h = head(S.pal === 'syrian' ? EAGLE : '🤖', 'الوكلاء', 'شغّل أي وكيل من التلفون وبينفّذ عالكمبيوتر', '<button class="chip" data-refresh="agents">تحديث</button>')
  const unread = (S.feed || []).filter((x) => x.n > S.feedSeen).length
  h += '<div class="seg"><button data-agview="list" class="' + (S.agView !== 'feed' ? 'act' : '') + '">الوكلاء</button><button data-agview="feed" class="' + (S.agView === 'feed' ? 'act' : '') + '">النتائج' + (unread ? ' (' + unread + ')' : '') + '</button></div>'
  if (S.agView === 'feed') return h + feedHtml(c)
  h += '<div class="mut" style="margin:0 4px 10px">' + (online ? '🟢 الكمبيوتر شغّال.' : S.gate ? (S.pc === 'on' ? '🟡 الكمبيوتر شغّال بس التلفون مو واصلو مباشرة، فالمهام بتنبعت عبر البوابة.' : S.pc === 'off' ? '🔴 الكمبيوتر مطفي أو التطبيق مسكّر. المهام بتشتغل بالسحابة.' : '⏳ عم يفحص حالة الكمبيوتر…') : '⚪ مو متصل بالكمبيوتر.') + '</div>'
  if (S.tasks.length) {
    h += '<div class="card glow"><h3>⏳ شغّال هلأ</h3>' + S.tasks.map((t) => '<div class="task"><span class="spin" style="margin-top:4px"></span><div class="t"><b>' + esc(t.label) + '</b> <span class="mut">· ' + fmtDur(Date.now() - t.started) + '</span><div class="mut">' + esc(t.text || 'عم يشتغل…') + '</div></div><button class="chip" data-stop="' + esc(t.tab) + '">إيقاف</button></div>').join('') + '</div>'
  }
  if (!online && !S.agents.length) return h + empty('وصّل بالكمبيوتر أول عشان تظهر الوكلاء.')
  if (!S.agents.length) return h + empty('ما في وكلاء لسا. أنشئ وكيل من تبويب «وكلاء» ببرنامج الكمبيوتر وبيظهر هون.')
  h += S.agents.map((a) => {
    const st = S.agentOut[a.id] || {}
    const open = S.agentOpen === a.id
    return '<div class="card agent' + (open ? ' open' : '') + '">' +
      '<div class="ag-top" data-agopen="' + esc(a.id) + '"><div class="av">' + esc((a.name || '?').trim().slice(0, 1).toUpperCase()) + '</div><div class="ag-i"><b>' + esc(a.name) + '</b><span class="pill">' + (RUNON[a.runOn] || a.runOn) + '</span>' +
      (a.hint ? '<div class="mut ag-h">' + esc(a.hint) + '</div>' : '') + '</div><span class="chev">' + (open ? '▾' : '◂') + '</span></div>' +
      (open
        ? '<div class="ag-body"><textarea id="agTask" rows="3" placeholder="المهمة يلي بدك الوكيل ينفذها…">' + esc(st.task || '') + '</textarea>' +
          '<div class="acts">' + (st.running
            ? '<button class="btn danger" data-agstop="' + esc(a.id) + '">■ إيقاف</button>'
            : '<button class="btn" data-agrun="' + esc(a.id) + '">▶ نفّذ</button>') + '</div>' +
          (!st.running && !online ? '<div class="mut" style="margin-top:8px">' + (S.gate ? '⚠️ الكمبيوتر مو واصل هلأ: لما تكبس نفّذ بتنبعت المهمة عبر البوابة (للكمبيوتر إذا شغّال، أو للسحابة)، والنتيجة بتظهر هون.' : '⚠️ الكمبيوتر مو متصل هلأ. وصّل التلفون بالكمبيوتر مرة لتفعيل البوابة السحابية.') + '</div>' : '') +
          (st.running ? '<div class="status" id="agStatus"><span class="spin"></span> ' + esc(st.status || 'عم يشتغل…') + '</div>' : '') +
          (st.running && st.stale ? '<div class="mut" style="margin-top:8px">الكمبيوتر ما ردّ لهلأ. <button class="btn" data-agcloud="' + esc(a.id) + '">☁️ شغّلها بالسحابة</button></div>' : '') +
          (S.approvals || []).filter((x) => x.job && x.job === st.job).map((x) => '<div class="card" style="margin-top:8px"><b>🔐 ' + esc(x.title || 'طلب موافقة') + '</b><pre class="code" style="white-space:pre-wrap;max-height:160px;overflow:auto">' + esc(x.preview || '') + '</pre><div class="acts"><button class="btn" data-apv="' + esc(x.id) + '|1">✅ موافق</button> <button class="btn danger" data-apv="' + esc(x.id) + '|0">❌ رفض</button></div></div>').join('') +
          '<div class="agout" id="agOut">' + (st.out ? '<div class="msg bot' + (st.failed ? ' err' : '') + '">' + md(st.out) + '<div class="meta">' + esc(when(st.at)) + '</div></div>' : '') + '</div></div>'
        : '') + '</div>'
  }).join('')
  return h
}

// ---------- notes (same list as the desktop «ملاحظات» page) ----------
export function todoHtml(c) {
  const S = c.S; const esc = c.esc
  let h = head('📝', 'ملاحظات', 'نفس قائمة «ملاحظات» ببرنامج الكمبيوتر، بتتزامن بين الجهازين', '<button class="chip" data-refresh="todo">تحديث</button>')
  h += '<div class="card"><textarea id="todoIn" class="tdin" rows="3" dir="auto" placeholder="اكتب مهمة، أو الصق عدة أسطر ليصير كل سطر مهمة…">' + esc(S.todoDraft || '') + '</textarea><button class="btn" data-tdadd="1" style="margin-top:8px">➕ ضيف</button></div>'
  if (S.todo === null) return h + empty(S.conn === 'online' ? '<span class="spin"></span> عم يجيب الملاحظات…' : 'وصّل بالكمبيوتر أول عشان تظهر الملاحظات.')
  const open = S.todo.filter((i) => !i.done).length; const done = S.todo.length - open
  const f = S.todoFilter || 'open'
  h += '<div class="tdf">' + [['open', 'المتبقي (' + open + ')'], ['done', 'المنجز (' + done + ')'], ['all', 'الكل (' + S.todo.length + ')']].map(([id, l]) => '<button class="chip' + (f === id ? ' act' : '') + '" data-tdf="' + id + '">' + l + '</button>').join('') + (done ? '<button class="chip" data-tdclear="1">امسح المنجزة</button>' : '') + '</div>'
  const shown = S.todo.filter((i) => (f === 'all' ? true : f === 'open' ? !i.done : i.done))
  if (!shown.length) return h + empty(S.todo.length ? 'ما في شي بهالتصنيف.' : 'ما في مهام لسا. ضيف أول وحدة من فوق.')
  return h + shown.map((i) => '<div class="card tdrow"><button class="tdchk' + (i.done ? ' on' : '') + '" data-tdtog="' + esc(i.id) + '" aria-label="تبديل">' + (i.done ? '✓' : '') + '</button><div class="tdtxt' + (i.done ? ' dn' : '') + '" dir="auto">' + esc(i.text) + '</div><button class="tddel" data-tddel="' + esc(i.id) + '" aria-label="احذف">🗑</button></div>').join('')
}

// ---------- schedules ----------
export function schedHtml(c) {
  const { S, esc, md } = c
  let h = head('📅', 'الجدولة', 'مهام بتشتغل لحالها بأوقات محددة', '<button class="chip" data-refresh="sched">تحديث</button>')
  if (S.sched === null) return h + empty(S.conn === 'online' ? '<span class="spin"></span> عم يجيب المهام…' : 'وصّل بالكمبيوتر أول عشان تظهر المهام.')
  if (!S.sched.length) return h + empty('ما في مهام مجدولة. أنشئ وحدة من تبويب «جدولة» ببرنامج الكمبيوتر.')
  h += S.sched.map((t) => {
    const open = S.schedOpen === t.id
    const stc = t.status === 'running' ? 'run' : t.status === 'ok' ? 'ok' : t.status === 'failed' ? 'bad' : ''
    const stx = t.status === 'running' ? 'عم يشتغل' : t.status === 'ok' ? 'نجحت' : t.status === 'failed' ? 'فشلت' : 'بعدها'
    return '<div class="card sc' + (t.enabled ? '' : ' off') + '"><div class="sc-top"><div class="sc-i" data-sopen="' + esc(t.id) + '"><b>' + esc(t.name) + '</b><div class="mut">' + esc(kindTxt(t)) + '</div>' +
      '<div class="mut"><span class="st ' + stc + '">' + stx + '</span> · ' + esc(ago(t.lastRun)) + '</div></div>' +
      '<label class="sw"><input type="checkbox" data-sw="' + esc(t.id) + '" ' + (t.enabled ? 'checked' : '') + '><i></i></label></div>' +
      (open ? '<div class="sc-body">' + (t.result ? '<div class="msg bot">' + md(t.result) + '</div>' : '<div class="mut">ما في نتيجة لسا.</div>') + '</div>' : '') +
      '<div class="acts"><button class="chip pri" data-srun="' + esc(t.id) + '"' + (t.status === 'running' || S.conn !== 'online' ? ' disabled' : '') + '>▶ شغّلها هلأ</button><button class="chip" data-sopen="' + esc(t.id) + '">' + (open ? 'إخفاء النتيجة' : 'آخر نتيجة') + '</button></div></div>'
  }).join('')
  return h
}

// ---------- reports ----------
export function reportHtml(c) {
  const { S, esc } = c
  const per = S.rperiod
  let h = head('📊', 'التقارير', 'شو اشتغل وكم كلّف وبأي موديل', '<button class="chip" data-refresh="report">تحديث</button>')
  h += '<div class="seg">' + [['7', '7 أيام'], ['30', '30 يوم'], ['all', 'الكل']].map(([k, l]) => '<button data-rperiod="' + k + '" class="' + (per === k ? 'act' : '') + '">' + l + '</button>').join('') + '</div>'
  if (S.report === null) return h + empty(S.conn === 'online' ? '<span class="spin"></span> عم يجهّز التقرير…' : 'وصّل بالكمبيوتر أول عشان يظهر التقرير.')
  const since = per === 'all' ? 0 : Date.now() - Number(per) * 86400000
  const rows = S.report.filter((r) => r.at >= since)
  if (!rows.length) return h + empty('ما في مهام بهالفترة.')
  const n = rows.length
  const free = rows.filter((r) => r.tier === 'free').length
  const fails = rows.filter((r) => r.fails > 0).length
  const esc2 = rows.filter((r) => r.esc).length
  const timed = rows.filter((r) => r.ms > 0)
  const avg = timed.length ? timed.reduce((s, r) => s + r.ms, 0) / timed.length : 0
  const cost = rows.reduce((s, r) => s + (r.cost || 0), 0)
  const unk = rows.filter((r) => r.ck === false).length
  const tokens = rows.reduce((s, r) => s + (r.tokens || 0), 0)
  const stat = (v, l, tone = '') => '<div class="stat ' + tone + '"><div class="sv">' + v + '</div><div class="sl">' + l + '</div></div>'
  h += '<div class="stats">' + stat(n, 'مهمة') + stat(Math.round((free / n) * 100) + '%', 'مجانية', 'ok') + stat(cost > 0 ? '$' + (cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)) : (unk ? 'غير معروفة' : '$0'), unk ? 'تكلفة تقديرية (+' + unk + ' بدون سعر)' : 'تكلفة تقديرية') +
    stat(avg ? (avg >= 60000 ? Math.floor(avg / 60000) + 'د ' + Math.round((avg % 60000) / 1000) + 'ث' : (avg / 1000).toFixed(1) + 'ث') : '-', 'متوسط الوقت') + stat(fails, 'فيها أخطاء', fails ? 'bad' : '') + stat(esc2, 'تصعيد لموديل أقوى') + '</div>'
  const tiers = {}
  rows.forEach((r) => { tiers[r.tier] = (tiers[r.tier] || 0) + 1 })
  h += '<div class="card"><h3>توزيع الأنواع</h3><div class="bar">' + Object.entries(tiers).map(([k, v]) => '<i style="width:' + (v / n) * 100 + '%;background:' + (TIERC[k] || 'var(--mut)') + '"></i>').join('') + '</div><div class="legend">' +
    Object.entries(tiers).map(([k, v]) => '<span><b style="background:' + (TIERC[k] || 'var(--mut)') + '"></b>' + (TIER[k] || k) + ' ' + v + '</span>').join('') + '</div><div class="mut" style="margin-top:6px">توكنز: ' + tokens.toLocaleString('en') + '</div></div>'
  const byModel = {}
  rows.forEach((r) => { byModel[r.model] = (byModel[r.model] || 0) + 1 })
  const top = Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 5)
  h += '<div class="card"><h3>أكثر الموديلات استخداماً</h3>' + top.map(([m, v]) => '<div class="mrow"><span dir="ltr">' + esc(m) + '</span><div class="mb"><i style="width:' + (v / top[0][1]) * 100 + '%"></i></div><b>' + v + '</b></div>').join('') + '</div>'
  h += '<div class="card"><h3>آخر المهام</h3>' + rows.slice(0, 15).map((r) => '<div class="rrow"><div class="rp">' + esc(r.prompt || '(بدون عنوان)') + '</div><div class="mut"><span dir="ltr">' + esc(r.model) + '</span> · ' + esc(when(r.at)) + (r.fails ? ' · ⚠️' : '') + '</div></div>').join('') + '</div>'
  return h
}

// ---------- projects (own tab) ----------
export function projHtml(c) {
  const { S, esc } = c
  let h = head('📁', 'المشاريع', 'المشروع يلي بتختاروا بتشتغل عليه محادثاتك من التلفون')
  h += '<div class="card">' +
    '<div class="prj' + (!S.project ? ' sel' : '') + '" data-proj=""><div class="pn">بدون مشروع</div></div>' +
    S.projects.map((p) => '<div class="prj' + (S.project === p.id ? ' sel' : '') + (p.confidential ? ' lock' : '') + '" data-proj="' + esc(p.id) + '"><div class="pn">' + (p.confidential ? '🔒 ' : '📂 ') + esc(p.name) + '</div>' +
      (S.activeProject === p.id ? '<span class="pill ok">فعّال عالكمبيوتر</span>' : (p.confidential ? '' : '<button class="chip" data-projdesk="' + esc(p.id) + '">فعّله عالكمبيوتر</button>')) + '</div>').join('') +
    (S.projects.length ? '' : '<div class="mut">ما في مشاريع. أضف مشروع من برنامج الكمبيوتر.</div>') + '</div>'
  return h
}

// ---------- more: models, look, connection ----------
export function moreHtml(c) {
  const { S, esc, version } = c
  const d = S.device || {}
  const m = S.mode
  const opt = (id, v) => '<option value="' + esc(v.value) + '" ' + (id === v.value ? 'selected' : '') + '>' + esc(v.label) + '</option>'
  let h = head('⚙️', 'المزيد', 'الموديلات والمظهر والاتصال')
  h += '<div class="card"><h3>🧠 الموديل وطريقة الشغل</h3><div class="seg">' +
    [['auto', 'تلقائي'], ['free', 'مجاني'], ['model', 'موديل'], ['council', 'council']].map(([k, l]) => '<button data-mode="' + k + '" class="' + (m.kind === k ? 'act' : '') + '">' + l + '</button>').join('') + '</div>' +
    '<div class="mut" style="margin-bottom:8px">' + ({ auto: 'يختار أنسب موديل (مجاني أو مدفوع) حسب الطلب.', free: 'موديلات مجانية بس (الأرخص والأأمن).', model: 'موديل محدد بتختاره إنت.', council: 'كاتب ومراجع: جواب أدق بس أبطأ.' })[m.kind] + '</div>' +
    (m.kind === 'model' ? '<select class="sel" id="selModel"><option value="">— اختر —</option>' + S.models.map((v) => opt(m.id, v)).join('') + '</select>' : '') +
    (m.kind === 'council' ? '<div class="mut">الكاتب</div><select class="sel" id="selAuthor"><option value="">تلقائي</option>' + S.models.map((v) => opt(m.author, v)).join('') + '</select><div class="mut">المراجع</div><select class="sel" id="selCritic"><option value="">تلقائي</option>' + S.models.map((v) => opt(m.critic, v)).join('') + '</select>' : '') +
    '<div class="mut">' + S.models.length + ' موديل متاح</div></div>'
  h += '<div class="card"><h3>🎨 المظهر</h3><div class="seg">' + [['light', 'فاتح'], ['dark', 'غامق'], ['auto', 'حسب الجهاز']].map(([k, l]) => '<button data-theme-mode="' + k + '" class="' + (S.themeMode === k ? 'act' : '') + '">' + l + '</button>').join('') + '</div><div class="seg" style="margin-top:8px">' + [['default', 'الألوان الافتراضية'], ['syrian', 'الهوية السورية']].map(([k, l]) => '<button data-pal="' + k + '" class="' + (S.pal === k ? 'act' : '') + '">' + l + '</button>').join('') + '</div><div class="mut" style="margin-top:8px">الهوية السورية: ألوان وخط (حيّاكم الله) والنسر مكان الروبوت، متل برنامج الكمبيوتر.</div></div>'
  h += '<div class="card"><h3>🔌 الاتصال</h3><div class="mut">الكمبيوتر: <b>' + esc(S.host || d.name) + '</b><br>الحالة: ' + esc(({ online: 'متصل ✅', connecting: 'عم يتصل…', hostdown: 'الكمبيوتر مو متصل بالـ relay', offline: 'غير متصل' })[S.conn]) + '<br>العناوين: <span dir="ltr">' + esc((d.urls || []).map((u) => u.replace(/^wss?:\/\//, '').replace('/ws', '')).join(' , ')) + '</span></div></div>' +
    '<div class="card"><h3>الخلفية</h3><label class="mut"><input type="checkbox" id="kaChk" ' + (S.keepAlive ? 'checked' : '') + '> خلّي التطبيق متصل بالخلفية (بيظهر إشعار ثابت) عشان توصلك الموافقات والنتائج</label></div>' +
    '<div class="card"><h3>🔐 الأمان</h3><div class="mut">كل شي بين التلفون والكمبيوتر مشفّر من الطرفين. مفتاح هالجهاز محفوظ بمخزن أندرويد الآمن (Keystore).</div></div>' +
    '<button class="btn ghost" id="reconBtn" style="margin-bottom:10px">إعادة الاتصال</button><button class="btn danger" id="unpairBtn">إلغاء ربط هالجهاز</button>' +
    '<div class="mut" style="text-align:center;margin-top:14px">TRL Agent ' + esc(version) + ' · Tarek Nahas · AI</div>'
  return h
}
