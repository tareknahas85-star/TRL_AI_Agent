# Cloud agents (optional) / الوكلاء السحابيين (اختياري)

This lets your agents run on a free GitHub Actions "virtual PC" when your own
computer is off, and lets you control them from Telegram. Everything uses free
tiers and lives in **this one repository** (no separate runner repo). You need
your own accounts: Cloudflare, GitHub, Telegram (a bot) and OpenRouter (free
models). Nothing here contains anyone's keys.

## What is where

- `relay/gate/` - the Cloudflare Worker (the "gate"). It owns the Telegram
  webhook, tracks if the app is online, and starts the cloud runner when it is
  not. Helper scripts: `setup-cloud.ps1`, `webhook.ps1`, `rotate-secrets.ps1`,
  `rotate-gate-key.ps1`, `common.ps1`, and an optional agent mailbox
  (`setup-mail.ps1` + `mail-appsscript.gs`).
- `relay/runner/runner.mjs` and `.github/workflows/agent.yml` - the cloud runner.

The repo is public, so the task text is never sent through the workflow inputs
(they are world-readable). The gate stores the task and passes only an opaque
job id; the runner fetches the task once from the gate using your gate key.

## Setup (short)

1. Fork or clone this repo into **your own** GitHub account (the license allows
   viewing and forking on GitHub; see `LICENSE`). Make sure `git remote -v`
   points at your copy.
2. Install the tools: Node 22, `gh` (run `gh auth login`), and
   `npx wrangler login` for Cloudflare.
3. In PowerShell run `relay/gate/setup-cloud.ps1` yourself. It asks for your
   Telegram bot token, chat id, OpenRouter key, a fine-grained GitHub token
   (Actions: read/write on your repo only) and your Worker URL, using hidden
   prompts. It sets the Worker secrets and the repo's Actions secrets, deploys
   the Worker, and puts the gate key on your clipboard.
4. Run `relay/gate/webhook.ps1 on` to point Telegram at the gate.
5. In the app, open the Agents tab and enter your gate URL and key.

Never paste keys into a chat or into a file in this repo.

## بالشامي

هاد الجزء اختياري. بيخلّي وكلاءك يشتغلوا على "كمبيوتر وهمي" مجاني عند GitHub
حتى لو جهازك مطفي، وبتتحكم فيهم من تيليغرام. كلشي مجاني وبنفس الريبو (ما في
ريبو منفصل). بدك حساباتك إنت: Cloudflare وGitHub وبوت تيليغرام وOpenRouter. ما
في أي مفتاح لحدا جوّا الملفات.

1. اعمل Fork أو clone للريبو على حسابك إنت (الترخيص بيسمح بالعرض والـ fork على
   GitHub، شوف `LICENSE`)، وتأكد إنو `git remote -v` بيشاور على نسختك.
2. نزّل Node 22 و`gh` (وسجّل دخول `gh auth login`) وسجّل دخول Cloudflare بـ
   `npx wrangler login`.
3. شغّل بنفسك `relay/gate/setup-cloud.ps1` على PowerShell. بيسألك عن توكن البوت
   ورقم الشات ومفتاح OpenRouter وتوكن GitHub (صلاحية Actions على ريبوك بس) ورابط
   الـ Worker بإدخال مخفي. بيحط الأسرار على الـ Worker وعلى الريبو، وبينشر الـ
   Worker، وبينسخلك مفتاح الـ gate عالكليبورد.
4. شغّل `relay/gate/webhook.ps1 on` ليتصل تيليغرام بالـ gate.
5. بالتطبيق، تبويب الوكلاء، حط رابط الـ gate ومفتاحو.

لا تلصق مفتاح بأي شات ولا بأي ملف.