import { DurableObject } from 'cloudflare:workers';

const enc = new TextEncoder();
const safeEq = (a, b) => {
  a = enc.encode(String(a ?? ''));
  b = enc.encode(String(b ?? ''));
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return d === 0;
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const clip = (s, n) => String(s ?? '').slice(0, n);
const cleanSrc = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
const cleanSrcList = (l) => (Array.isArray(l) ? l : []).map(cleanSrc).filter(Boolean).slice(0, 5);
const AP_RE = /^ap:([0-9a-f]{12}):([01])$/;
const MODES = { local: 'محلي', cloud: 'سحابي', auto: 'تلقائي' };
// --- cloud schedule helpers ---
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return String(tz); } catch { return 'Asia/Damascus'; } };
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function zoned(date, tz) {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date)) o[p.type] = p.value;
  return { key: o.year + '-' + o.month + '-' + o.day, mins: Number(o.hour) * 60 + Number(o.minute), dow: DOW[o.weekday] };
}
const HELP = [
  'أوامر البوت:',
  '/agents - لائحة الوكلاء',
  '/agent <اسم الوكيل> <المهمة> - شغّل وكيل',
  '/status - حالة الكمبيوتر',
  '/stop - أوقف كل المهام الجارية',
  '/mail - آخر 5 إيميلات بصندوق الوكلاء',
  'أي رسالة عادية بتروح للكمبيوتر، وإذا مطفي بتشتغل على السحابة.',
].join('\n');

export default {
  // Cron (every 5 min): fire scheduled agents.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(env.GATE.get(env.GATE.idFromName('main')).tick());
  },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/health') return json({ ok: true });
    return env.GATE.get(env.GATE.idFromName('main')).fetch(req);
  },
};

export class Gate extends DurableObject {
  async fetch(req) {
    const env = this.env;
    const u = new URL(req.url);
    const p = u.pathname;
    const st = this.ctx.storage;

    // Telegram webhook (secret path + secret header)
    if (env.WEBHOOK_PATH && env.WEBHOOK_SECRET && p === '/tg/' + env.WEBHOOK_PATH) {
      const ok =
        req.method === 'POST' &&
        safeEq(req.headers.get('x-telegram-bot-api-secret-token'), env.WEBHOOK_SECRET);
      if (!ok) return new Response('not found', { status: 404 });
      try {
        await this.onUpdate(await req.json());
      } catch (e) {
        console.log('update error', clip(e, 200));
      }
      return new Response('ok');
    }

    // Mailbox push from the agent mailbox (Apps Script). Separate write-only key.
    if (p === '/mail' && req.method === 'POST') {
      if (!env.MAIL_KEY || !safeEq(req.headers.get('x-mail-key'), env.MAIL_KEY))
        return new Response('unauthorized', { status: 401 });
      const body = await req.text();
      if (body.length > 400000) return json({ error: 'too large' }, 413);
      let arr;
      try { arr = JSON.parse(body); } catch { return json({ error: 'bad json' }, 400); }
      if (!Array.isArray(arr)) return json({ error: 'expected array' }, 400);
      return json(await this.addMail(arr, cleanSrc(req.headers.get('x-mail-src')) || 'main'));
    }

    // Phone app (separate narrow key, registered by the PC app): same routing as the Telegram bot.
    // /status says whether the PC is online; /run sends a task (to the PC if online, else the cloud runner).
    const phonePath =
      p === '/run' || p === '/status' || p === '/approvals' || p.startsWith('/result/') ||
      (p.startsWith('/approval/') && (req.method === 'POST' || req.method === 'OPTIONS'));
    if (phonePath) {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'x-phone-key,content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      };
      const out = (o, s = 200) =>
        new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...cors } });
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const pk = await st.get('phoneKey');
      if (!pk || !safeEq(req.headers.get('x-phone-key'), pk)) return out({ error: 'unauthorized' }, 401);
      if (p === '/status' && req.method === 'GET') return out({ ok: true, online: await this.online() });
      // results of a job (cloud runner or the PC post progress/final text here, so Telegram is optional)
      const rm = p.match(/^\/result\/([0-9a-f]{12})$/);
      if (rm && req.method === 'GET') {
        const r = await st.get('res:' + rm[1]);
        return out({ ok: true, events: r && Date.now() - r.ts < 3600000 ? r.events : [] });
      }
      // approvals requested by a cloud run: the phone lists the pending ones and answers
      if (p === '/approvals' && req.method === 'GET') {
        const all = await st.list({ prefix: 'apreq:' });
        const items = [];
        for (const [k, v] of all) {
          if (Date.now() - v.ts > 600000) { await st.delete(k); continue; }
          items.push({ id: k.slice(6), title: v.title, preview: v.preview, job: v.job });
        }
        return out({ ok: true, items });
      }
      const am = p.match(/^\/approval\/([0-9a-f]{12})$/);
      if (am && req.method === 'POST') {
        let b;
        try { b = await req.json(); } catch { return out({ error: 'bad json' }, 400); }
        if (b?.v !== 0 && b?.v !== 1) return out({ error: 'bad value' }, 400);
        if (!(await st.get('apreq:' + am[1]))) return out({ error: 'not found' }, 404);
        await st.put('ap:' + am[1], { v: b.v, ts: Date.now() });
        await st.delete('apreq:' + am[1]);
        return out({ ok: true });
      }
      if (p === '/run' && req.method === 'POST') {
        const last = (await st.get('lastPhoneRun')) || 0;
        if (Date.now() - last < 2000) return out({ error: 'too fast' }, 429);
        await st.put('lastPhoneRun', Date.now());
        let b;
        try { b = await req.json(); } catch { return out({ error: 'bad json' }, 400); }
        const task = clip(b?.task, 4000).trim();
        if (!task) return out({ error: 'empty task' }, 400);
        const name = clip(b?.agent, 40).trim().toLowerCase();
        let agent = null;
        if (name) {
          agent = ((await st.get('agents')) || []).find((a) => a.name.toLowerCase() === name) || null;
          if (!agent) return out({ error: 'agent not found' }, 404);
        }
        const mode = agent ? agent.runOn : 'auto';
        const online = await this.online();
        const force = b?.force === 'cloud';
        if (force && mode === 'local') return out({ error: 'local only' }, 400);
        const where = force ? 'cloud' : mode === 'local' || (mode === 'auto' && online) ? (online ? 'pc' : 'none') : 'cloud';
        const job = where === 'none' ? '' : await this.run(agent, task, where);
        return out({ ok: true, where, job });
      }
      return out({ error: 'not found' }, 404);
    }

    // Everything else needs the app key
    if (!env.GATE_KEY || !safeEq(req.headers.get('x-gate-key'), env.GATE_KEY))
      return new Response('unauthorized', { status: 401 });

    if (p === '/heartbeat' && req.method === 'POST') {
      await st.put('hb', Date.now());
      return json({ ok: true });
    }
    if (p === '/inbox' && req.method === 'GET') {
      await st.put('hb', Date.now());
      const after = parseInt(u.searchParams.get('after') || '0', 10) || 0;
      const inbox = (await st.get('inbox')) || [];
      return json({ items: inbox.filter((i) => i.id > after), last: (await st.get('seq')) || 0 });
    }
    if (p === '/phone-key' && req.method === 'PUT') {
      let b;
      try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!/^[0-9a-f]{32,128}$/.test(String(b?.key ?? ''))) return json({ error: 'bad key' }, 400);
      await st.put('phoneKey', b.key);
      return json({ ok: true });
    }
    if (p === '/agents' && req.method === 'PUT') {
      const body = await req.text();
      if (body.length > 100000) return json({ error: 'too large' }, 413);
      let arr;
      try { arr = JSON.parse(body); } catch { return json({ error: 'bad json' }, 400); }
      if (!Array.isArray(arr)) return json({ error: 'expected array' }, 400);
      const clean = arr
        .slice(0, 50)
        .map((a) => ({
          name: clip(a?.name, 40).trim(),
          prompt: clip(a?.prompt, 3000),
          runOn: Object.hasOwn(MODES, a?.runOn) ? a.runOn : 'auto',
          memory: a?.memory === 'none' ? 'none' : 'basic',
      model: /^[A-Za-z0-9._:\/-]{1,80}$/.test(String(a?.model || '')) ? String(a.model) : '',
      tool: a?.tool === 'image' ? 'image' : 'text',
      sources: cleanSrcList(a?.sources),
      schedule:
        a?.schedule && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(a.schedule.time || '')) && String(a.schedule.task || '').trim()
          ? { time: a.schedule.time, days: a.schedule.days === 'work' ? 'work' : 'all', task: clip(a.schedule.task, 2000).trim(), tz: validTz(a.schedule.tz) }
          : null,
        }))
        .filter((a) => a.name);
      await st.put('agents', clean);
      return json({ ok: true, count: clean.length });
    }
    // Basic-facts pack the app builds (already filtered on the PC). Read-only for the runner, given to a job only if its agent allows it.
    if (p === '/memory' && req.method === 'PUT') {
      let b;
      try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      await st.put('memory', clip(b?.text, 6000));
      return json({ ok: true });
    }
    if (p === '/mail' && req.method === 'GET') {
      const after = parseInt(u.searchParams.get('after') || '0', 10) || 0;
      const mail = (await st.get('mail')) || [];
      const want = cleanSrcList((u.searchParams.get('src') || '').split(','));
      return json({ items: mail.filter((m) => m.n > after && (!want.length || want.includes(m.src || 'main'))), last: (await st.get('mseq')) || 0 });
    }
    if (p === '/agents' && req.method === 'GET')
      return json({ agents: (await st.get('agents')) || [] });

    if (p === '/result' && req.method === 'POST') {
      let b;
      try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!/^[0-9a-f]{12}$/.test(String(b?.job ?? ''))) return json({ error: 'bad job' }, 400);
      const kind = ['say', 'done', 'fail'].includes(b?.kind) ? b.kind : 'say';
      await this.addResult(b.job, kind, clip(b?.text, 3500));
      return json({ ok: true });
    }
    if (p === '/approval-req' && req.method === 'POST') {
      let b;
      try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!/^[0-9a-f]{12}$/.test(String(b?.id ?? ''))) return json({ error: 'bad id' }, 400);
      await st.put('apreq:' + b.id, { ts: Date.now(), job: clip(b?.job, 12), title: clip(b?.title, 200), preview: clip(b?.preview, 2500) });
      return json({ ok: true });
    }
    const m = p.match(/^\/approval\/([0-9a-f]{12})$/);
    if (m && req.method === 'GET') {
      const a = await st.get('ap:' + m[1]);
      return json(a && Date.now() - a.ts < 3600000 ? { v: a.v } : {});
    }
    const j = p.match(/^\/job\/([0-9a-f]{12})$/);
    if (j && req.method === 'GET') {
      // one-time read: the task never appears in public Actions inputs or logs
      const job = await st.get('job:' + j[1]);
      if (!job || Date.now() - job.ts > 3600000) return json({ error: 'not found' }, 404);
      await st.delete('job:' + j[1]);
      return json({ task: job.task, agent: job.agent, prompt: job.prompt, model: job.model || '', tool: job.tool || 'text', sources: job.sources || [], memory: job.memory || '' });
    }
    return json({ error: 'not found' }, 404);
  }

  // ---------- helpers ----------
  async tg(method, body) {
    if (!this.env.TG_TOKEN || !this.env.TG_CHAT_ID) return false;
    const r = await fetch(`https://api.telegram.org/bot${this.env.TG_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.log('tg api failed', method, r.status, clip(await r.text(), 150));
    return r.ok;
  }
  say(text) {
    return this.tg('sendMessage', { chat_id: this.env.TG_CHAT_ID, text: clip(text, 4000) });
  }
  gh() {
    return {
      authorization: `Bearer ${this.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'trl-agent-gate',
      'content-type': 'application/json',
    };
  }
  async online() {
    return Date.now() - ((await this.ctx.storage.get('hb')) || 0) < 90000;
  }
  async enqueue(item) {
    const st = this.ctx.storage;
    const id = ((await st.get('seq')) || 0) + 1;
    const now = Date.now();
    const inbox = ((await st.get('inbox')) || []).filter((i) => now - i.ts < 3600000).slice(-49);
    inbox.push({ id, ts: now, ...item });
    await st.put({ seq: id, inbox });
  }

  // ---------- Telegram ----------
  async onUpdate(up) {
    const st = this.ctx.storage;
    const last = (await st.get('lastUpd')) || 0;
    if (typeof up.update_id !== 'number' || up.update_id <= last) {
      console.log('skip update', up.update_id, 'last', last);
      return;
    }
    await st.put('lastUpd', up.update_id);
    if (up.callback_query) return this.onCallback(up.callback_query);
    const m = up.message;
    if (!m || !m.text) return;
    if (String(m.chat?.id) !== String(this.env.TG_CHAT_ID) || m.chat.type !== 'private') {
      console.log('ignored chat', m.chat?.type, 'id-match', String(m.chat?.id) === String(this.env.TG_CHAT_ID));
      return;
    }
    return this.onText(m.text.trim());
  }

  async onCallback(cq) {
    if (String(cq.message?.chat?.id) !== String(this.env.TG_CHAT_ID)) return;
    const m = AP_RE.exec(cq.data || '');
    if (!m) return;
    await this.ctx.storage.put('ap:' + m[1], { v: Number(m[2]), ts: Date.now() });
    await this.tg('answerCallbackQuery', {
      callback_query_id: cq.id,
      text: m[2] === '1' ? 'تمت الموافقة' : 'تم الرفض',
    });
    await this.tg('editMessageReplyMarkup', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  }

  async onText(t) {
    const first = t.split(/\s+/)[0];
    const cmd = first.toLowerCase().replace(/@\w+$/, '');
    const arg = t.slice(first.length).trim();
    const agents = (await this.ctx.storage.get('agents')) || [];

    if (cmd === '/start' || cmd === '/help') return this.say(HELP);
    if (cmd === '/agents') {
      if (!agents.length) return this.say('ما في وكلاء. أنشئ وكيل من تبويب "وكلاء" بالتطبيق.');
      return this.say('الوكلاء:\n' + agents.map((a) => `• ${a.name} (${MODES[a.runOn]})`).join('\n'));
    }
    if (cmd === '/mail') {
      const mail = ((await this.ctx.storage.get('mail')) || []).slice(-5).reverse();
      if (!mail.length) return this.say('📭 ما في إيميلات لسا.');
      return this.say(
        '📧 آخر الإيميلات:\n' +
          mail.map((m) => `• ${clip(m.from, 50)} — ${clip(m.subject, 70)}`).join('\n'),
      );
    }
    if (cmd === '/status') {
      const on = await this.online();
      return this.say(on ? '🟢 الكمبيوتر شغّال.' : '🔴 الكمبيوتر مطفي أو التطبيق مسكّر.');
    }
    if (cmd === '/stop') {
      await this.enqueue({ type: 'stop' });
      const n = await this.cancelCloud();
      return this.say(`⛔ أوقفت المهام. مهام سحابية انلغت: ${n}`);
    }
    if (cmd === '/agent') {
      if (!arg) return this.say('الاستخدام: /agent <اسم الوكيل> <المهمة>');
      const low = arg.toLowerCase();
      const found = [...agents]
        .sort((a, b) => b.name.length - a.name.length)
        .find((a) => {
          const n = a.name.toLowerCase();
          return low.startsWith(n) && (low.length === n.length || /\s/.test(low[n.length]));
        });
      if (!found) return this.say('ما لقيت وكيل بهالاسم. جرّب /agents');
      const task = arg.slice(found.name.length).trim();
      if (!task) return this.say(`شو المهمة لـ ${found.name}؟`);
      return this.run(found, task);
    }
    if (t.startsWith('/')) return this.say(HELP);
    return this.run(null, t);
  }

  // Called by the cron trigger. Fires each due scheduled agent once per day (15-minute grace window for cron delays).
  async tick() {
    const st = this.ctx.storage;
    const agents = (await st.get('agents')) || [];
    const now = new Date();
    for (const a of agents) {
      const s = a.schedule;
      if (!s) continue;
      const z = zoned(now, s.tz || 'Asia/Damascus');
      const [h, m] = s.time.split(':').map(Number);
      const t = h * 60 + m;
      if (z.mins < t || z.mins >= t + 15) continue;
      if (s.days === 'work' && (z.dow === 5 || z.dow === 6)) continue;
      const mark = 'sch:' + a.name.toLowerCase();
      if ((await st.get(mark)) === z.key) continue;
      if (a.runOn === 'local' && !(await this.online())) continue; // retried on the next tick inside the window
      await st.put(mark, z.key);
      try { await this.run(a, s.task); } catch (e) { console.log('schedule error', clip(e, 150)); }
    }
  }

  newJob() {
    return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // where: optional override ('pc' | 'cloud'); returns the job id (phone polls /result/<job>), '' if nothing started
  async run(agent, task, where) {
    const mode = agent ? agent.runOn : 'auto';
    const online = await this.online();
    const toPc = where ? where === 'pc' : mode === 'local' || (mode === 'auto' && online);
    if (toPc) {
      if (!online) { await this.say('🔴 الكمبيوتر مطفي، والوكيل هاد مضبوط يشتغل محلي بس.'); return ''; }
      const job = this.newJob();
      await this.enqueue({ type: agent ? 'agent' : 'msg', agent: agent?.name, text: task, job });
      await this.say('📥 وصلت المهمة للكمبيوتر.');
      return job;
    }
    return this.dispatch(agent, task);
  }
  async addResult(job, kind, text) {
    const st = this.ctx.storage;
    const cur = (await st.get('res:' + job)) || { ts: Date.now(), events: [] };
    cur.events = [...cur.events, { n: cur.events.length + 1, kind, text }].slice(-30);
    cur.ts = Date.now();
    await st.put('res:' + job, cur);
    // lazy cleanup of old results
    for (const [k, v] of await st.list({ prefix: 'res:' })) if (Date.now() - v.ts > 3600000) await st.delete(k);
  }

  // ---------- Agent mailbox ----------
  // Mail content is untrusted data: stored and shown as plain text only, never executed.
  async addMail(arr, src = 'main') {
    const st = this.ctx.storage;
    const mail = (await st.get('mail')) || [];
    let seq = (await st.get('mseq')) || 0;
    const seen = new Set(mail.map((m) => m.mid));
    let added = 0;
    for (const x of arr.slice(0, 10)) {
      const mid = clip(x?.id, 80);
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      mail.push({
        n: ++seq,
        mid,
        src,
        ts: Date.now(),
        from: clip(x.from, 200),
        subject: clip(x.subject, 200),
        date: clip(x.date, 40),
        body: clip(x.body, 6000),
      });
      added++;
      await this.say(`📧 إيميل جديد\nمن: ${clip(x.from, 80)}\nالموضوع: ${clip(x.subject, 100)}`);
    }
    await st.put({ mseq: seq, mail: mail.slice(-60) });
    return { ok: true, added };
  }

  // ---------- GitHub Actions (cloud PC) ----------
  async dispatch(agent, task) {
    const { GH_TOKEN, GH_REPO } = this.env;
    if (!GH_TOKEN || !GH_REPO) return this.say('☁️ السحابة مو مفعّلة لسا.');
    const id = this.newJob();
    await this.ctx.storage.put('job:' + id, {
      ts: Date.now(),
      task: clip(task, 4000),
      agent: clip(agent?.name || '', 40),
      prompt: clip(agent?.prompt || '', 3000),
      model: agent?.model || '',
      tool: agent?.tool === 'image' ? 'image' : 'text',
      sources: cleanSrcList(agent?.sources),
      memory: agent && agent.memory === 'none' ? '' : clip((await this.ctx.storage.get('memory')) || '', 6000),
    });
    const r = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/agent.yml/dispatches`,
      {
        method: 'POST',
        headers: this.gh(),
        body: JSON.stringify({
          ref: 'main',
          inputs: { job: id },
        }),
      },
    );
    if (r.status === 204) { await this.say('☁️ بلّشت المهمة على الكمبيوتر السحابي.'); return id; }
    let why = '';
    try { why = clip(String((await r.json()).message || ''), 120); } catch {}
    await this.addResult(id, 'fail', `فشل تشغيل السحابة (${r.status}).${why ? ' ' + why : ''}`);
    await this.say(`⚠️ فشل تشغيل السحابة (${r.status}).${why ? '\n' + why : ''}`);
    return id;
  }

  async cancelCloud() {
    const { GH_TOKEN, GH_REPO } = this.env;
    if (!GH_TOKEN || !GH_REPO) return 0;
    let n = 0;
    for (const status of ['in_progress', 'queued']) {
      const r = await fetch(
        `https://api.github.com/repos/${GH_REPO}/actions/workflows/agent.yml/runs?status=${status}&per_page=20`,
        { headers: this.gh() },
      );
      if (!r.ok) continue;
      for (const run of (await r.json()).workflow_runs || []) {
        const c = await fetch(
          `https://api.github.com/repos/${GH_REPO}/actions/runs/${run.id}/cancel`,
          { method: 'POST', headers: this.gh() },
        );
        if (c.status === 202) n++;
      }
    }
    return n;
  }
}