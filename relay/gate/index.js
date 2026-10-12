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
const AP_RE = /^ap:([0-9a-f]{12}):([01])$/;
const MODES = { local: 'محلي', cloud: 'سحابي', auto: 'تلقائي' };
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
      return json(await this.addMail(arr));
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
        }))
        .filter((a) => a.name);
      await st.put('agents', clean);
      return json({ ok: true, count: clean.length });
    }
    if (p === '/mail' && req.method === 'GET') {
      const after = parseInt(u.searchParams.get('after') || '0', 10) || 0;
      const mail = (await st.get('mail')) || [];
      return json({ items: mail.filter((m) => m.n > after), last: (await st.get('mseq')) || 0 });
    }
    if (p === '/agents' && req.method === 'GET')
      return json({ agents: (await st.get('agents')) || [] });

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
      return json({ task: job.task, agent: job.agent, prompt: job.prompt });
    }
    return json({ error: 'not found' }, 404);
  }

  // ---------- helpers ----------
  async tg(method, body) {
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

  async run(agent, task) {
    const mode = agent ? agent.runOn : 'auto';
    const online = await this.online();
    if (mode === 'local' || (mode === 'auto' && online)) {
      if (!online) return this.say('🔴 الكمبيوتر مطفي، والوكيل هاد مضبوط يشتغل محلي بس.');
      await this.enqueue({ type: agent ? 'agent' : 'msg', agent: agent?.name, text: task });
      return this.say('📥 وصلت المهمة للكمبيوتر.');
    }
    return this.dispatch(agent, task);
  }

  // ---------- Agent mailbox ----------
  // Mail content is untrusted data: stored and shown as plain text only, never executed.
  async addMail(arr) {
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
    const id = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await this.ctx.storage.put('job:' + id, {
      ts: Date.now(),
      task: clip(task, 4000),
      agent: clip(agent?.name || '', 40),
      prompt: clip(agent?.prompt || '', 3000),
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
    return this.say(
      r.status === 204 ? '☁️ بلّشت المهمة على الكمبيوتر السحابي.' : `⚠️ فشل تشغيل السحابة (${r.status}).`,
    );
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