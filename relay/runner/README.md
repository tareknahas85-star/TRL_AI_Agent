# Cloud agents (optional) / الوكلاء السحابيين (اختياري)

This lets your agents run on a free GitHub Actions "virtual PC" when your own
computer is off, and lets you control them from Telegram. Everything uses free
tiers. You need your own accounts: Cloudflare, GitHub, Telegram (a bot) and
OpenRouter (free models). Nothing here contains anyone's keys.

## What is in this folder

- `../gate/` - the Cloudflare Worker (the "gate"). It owns the Telegram webhook,
  tracks if the app is online, and starts the cloud runner when it is not.
  Helper scripts: `setup-cloud.ps1`, `webhook.ps1`, `rotate-secrets.ps1`,
  `rotate-gate-key.ps1`, and an optional agent mailbox (`setup-mail.ps1` +
  `mail-appsscript.gs`).
- `runner.mjs` and `workflows/agent.yml` - the cloud runner.

## Setup (short)

1. Create a **private** GitHub repo named `trl-agent-runner`. Put `runner.mjs`
   at its root and `workflows/agent.yml` at `.github/workflows/agent.yml`.
2. In that repo add these Actions secrets: `TG_TOKEN`, `TG_CHAT_ID`,
   `OPENROUTER_KEY`, `GATE_URL`, `GATE_KEY`.
3. In `../gate/` replace the placeholders `YOUR-SUBDOMAIN` and
   `YOUR-GITHUB-USER` (and `YOUR-AGENT-MAILBOX` if you use the mailbox) with
   your own values, then deploy the Worker with `npx wrangler deploy`.
4. Run the helper scripts yourself in PowerShell. They ask for your keys with
   hidden prompts. Never paste keys into a chat or into a file in this repo.
5. In the app, open the Agents tab and enter your gate URL and key.

## بالشامي

هاد الجزء اختياري. بيخلّي وكلاءك يشتغلوا على "كمبيوتر وهمي" مجاني عند GitHub
حتى لو جهازك مطفي، وبتتحكم فيهم من تيليغرام. كلشي مجاني وبدك حساباتك إنت:
Cloudflare وGitHub وبوت تيليغرام وOpenRouter. ما في أي مفتاح لحدا جوّا الملفات.

1. اعمل ريبو **خاص** اسمو `trl-agent-runner`، وحط فيه `runner.mjs` بالجذر
   و`workflows/agent.yml` بمسار `.github/workflows/agent.yml`.
2. ضيف عليه الأسرار: `TG_TOKEN` و`TG_CHAT_ID` و`OPENROUTER_KEY` و`GATE_URL`
   و`GATE_KEY`.
3. بمجلد `../gate/` بدّل `YOUR-SUBDOMAIN` و`YOUR-GITHUB-USER` (و`YOUR-AGENT-MAILBOX`
   إذا بدك الصندوق) بقيمك، وبعدين `npx wrangler deploy`.
4. شغّل السكربتات بنفسك على PowerShell. بتطلب المفاتيح بإدخال مخفي. لا تلصق
   مفتاح بأي شات ولا بأي ملف.
5. بالتطبيق، تبويب الوكلاء، حط رابط الـ gate ومفتاحو.