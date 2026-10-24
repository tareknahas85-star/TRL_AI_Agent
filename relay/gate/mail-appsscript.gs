// Google Apps Script - paste into the agent mailbox account (YOUR-AGENT-MAILBOX@gmail.com).
// script.google.com > New project > paste > Project Settings > Script properties:
//   MAIL_KEY = (the key from setup-mail.ps1)
// Then run installTrigger() once (authorize), and it checks mail every minute.
// It only READS mail and POSTs plain text to the gate. It never sends or deletes anything.
const GATE = 'https://trl-agent-gate.YOUR-SUBDOMAIN.workers.dev';

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pushMail').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().setProperty('LAST', String(Date.now()));
}

function pushMail() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('MAIL_KEY');
  if (!key) throw new Error('MAIL_KEY missing in Script properties');
  const last = Number(props.getProperty('LAST') || Date.now());
  const out = [];
  let newest = last;
  GmailApp.search('in:inbox newer_than:1d', 0, 15).forEach((th) => {
    th.getMessages().forEach((m) => {
      const t = m.getDate().getTime();
      if (t <= last) return;
      newest = Math.max(newest, t);
      out.push({
        id: m.getId(),
        from: m.getFrom(),
        subject: m.getSubject(),
        date: m.getDate().toISOString(),
        body: m.getPlainBody().slice(0, 6000),
      });
    });
  });
  if (!out.length) return;
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  const r = UrlFetchApp.fetch(GATE + '/mail', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-mail-key': key, 'x-mail-src': props.getProperty('MAIL_SRC') || 'main' },
    payload: JSON.stringify(out.slice(0, 10)),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() === 200) props.setProperty('LAST', String(newest));
  else console.error('gate ' + r.getResponseCode());
}
