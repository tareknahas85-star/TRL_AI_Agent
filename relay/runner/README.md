# Cloud agents (optional) / الوكلاء السحابيين (اختياري)

Agents you create in the app's **Agents** tab run on your own computer by
default, with no cloud setup at all. This optional part lets them keep working
on a free GitHub Actions "virtual PC" when your computer is off, and lets you
see results and approve actions from the app on your computer or phone.
Everything uses free tiers and lives in **this one repository**. You need your
own accounts; nothing here contains anyone's keys.

## What you need

| Item | Required? | Used for |
|---|---|---|
| GitHub account (fork of this repo) | yes | the cloud runner (GitHub Actions) |
| Cloudflare account (free) | yes | the "gate" (a small Worker) |
| GitHub fine-grained token (Actions: read/write on your fork only) | yes | lets the gate start the runner |
| Gemini API key (free tier) | recommended | the model the cloud runner uses first |
| OpenRouter API key (free models) | optional | fallback if Gemini is not set or fails |
| Telegram bot token + chat id | optional | control and notifications from Telegram |

You need at least one model key (Gemini or OpenRouter).

## What is where

- `relay/gate/` - the Cloudflare Worker (the "gate"). It tracks whether the app
  is online, stores each task, and starts the cloud runner when the app is not
  online. Helper scripts: `setup-cloud.ps1`, `webhook.ps1` (Telegram only),
  `rotate-secrets.ps1`, `rotate-gate-key.ps1`, `common.ps1`, and an optional
  agent mailbox (`setup-mail.ps1` + `mail-appsscript.gs`).
- `relay/runner/runner.mjs` and `.github/workflows/agent.yml` - the cloud runner.

How a task flows: the app (or phone) sends it to the gate. If the app is
online, the gate hands it to the app and it runs on your PC. If not, the gate
starts the runner on GitHub Actions. Results and approval requests come back
through the gate to the app and the phone.

The repo is public, so the task text is never sent through the workflow inputs
(they are world-readable). The gate stores the task and passes only an opaque
job id; the runner fetches the task once from the gate using your gate key.

## Setup (short)

1. Fork this repo into **your own** GitHub account and clone your fork, so
   `git remote -v` points at it.
2. Install Node 22 and `gh` (run `gh auth login`), then run
   `npx wrangler login` for Cloudflare.
3. In PowerShell run `relay/gate/setup-cloud.ps1` yourself. It asks (hidden
   prompts) for your GitHub token, Gemini key, optional OpenRouter key and
   optional Telegram details, plus your Worker URL. It sets the Worker and
   repo secrets, deploys the Worker, and puts the gate key on your clipboard.
4. In the app open the **Agents** tab and enter your Worker URL and gate key.
5. Telegram only: run `relay/gate/webhook.ps1 on`. Skip this if you do not use
   Telegram.

Never paste keys into a chat or into a file in this repo.

## بالشامي

هاد الجزء اختياري. الوكلاء اللي بتعملهن بتبويب "وكلاء" بيشتغلوا على جهازك
لحالهم بدون أي إعداد سحابي. هاد الإعداد بس إذا بدك الوكلاء يكملوا شغل وجهازك
مطفي، على "كمبيوتر وهمي" مجاني عند GitHub، وتشوف النتايج وتوافق على الطلبات
من التطبيق على الكمبيوتر أو الموبايل. كلشي مجاني وبنفس الريبو، وما في أي مفتاح
لحدا جوّا الملفات. بدك حساباتك إنت.

**شو بدك:**

- حساب GitHub (نسخة fork من الريبو): ضروري.
- حساب Cloudflare مجاني: ضروري.
- توكن GitHub دقيق (صلاحية Actions على الـ fork تبعك بس): ضروري.
- مفتاح Gemini (الباقة المجانية): مفضّل، وهو الموديل اللي بيجرّبه الـ runner أول.
- مفتاح OpenRouter: اختياري، احتياط إذا Gemini ما اشتغل.
- بوت تيليغرام: اختياري كلياً.

لازم على الأقل مفتاح موديل واحد (Gemini أو OpenRouter).

**كيف بيمشي الشغل:** التطبيق أو الموبايل بيبعت المهمة للـ gate. إذا
التطبيق أونلاين بينزلها عليه وبتشتغل على جهازك. إذا لأ، بيشغّل الـ runner
على GitHub Actions. النتايج وطلبات الموافقة بترجع للتطبيق وللموبايل.

**الإعداد:**

1. اعمل fork للريبو على حسابك وسوّي clone، وتأكد إنو `git remote -v`
   بيشاور على نسختك.
2. نزّل Node 22 و`gh` (وسجّل دخول `gh auth login`) وسجّل دخول Cloudflare بـ
   `npx wrangler login`.
3. شغّل بنفسك `relay/gate/setup-cloud.ps1` على PowerShell. بيسألك بإدخال مخفي
   عن توكن GitHub ومفتاح Gemini ومفتاح OpenRouter (اختياري) وتفاصيل تيليغرام
   (اختياري)، وعن رابط الـ Worker. بيحط الأسرار، وبينشر الـ Worker، وبينسخلك
   مفتاح الـ gate عالكليبورد.
4. بالتطبيق، تبويب الوكلاء، حط رابط الـ Worker ومفتاح الـ gate.
5. تيليغرام بس: شغّل `relay/gate/webhook.ps1 on`. اتركها إذا ما بتستعمل تيليغرام.

لا تلصق مفتاح بأي شات ولا بأي ملف.