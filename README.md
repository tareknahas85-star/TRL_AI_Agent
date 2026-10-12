# TRL_AI_Agent (وكيل TRL الذكي)

**[⬇️ Download for Windows](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-5.10.0-windows-setup.exe)** &nbsp;|&nbsp; **[⬇️ حمّل نسخة ويندوز](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-5.10.0-windows-setup.exe)**

**[⬇️ Download the Android app (.apk)](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-5.10.0-android.apk)** &nbsp;|&nbsp; **[⬇️ حمّل تطبيق الأندرويد (.apk)](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-5.10.0-android.apk)**

**Linux / Ubuntu:** [⬇️ .deb](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-5.10.0-linux.deb) &nbsp;|&nbsp; [⬇️ AppImage](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-5.10.0-linux.AppImage) &nbsp;|&nbsp; **لينكس / أوبونتو:** نزّل الـ `.deb` أو الـ AppImage من الروابط.

---

## In English

A desktop AI agent for Windows and Linux. You type one request. A small "maestro"
model reads it, decides how hard it is, and picks the right model for the job,
cheapest first. If a model fails, the next one takes over on its own. The chat is
in Arabic first, right to left.

### Status

It works, but it is a personal project. Download the installer from the
[latest release](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest),
or build it yourself. The Windows installer is not signed, so the first time
Windows SmartScreen shows a warning: press **More info**, then **Run anyway**.
Every release has a `SHA256SUMS.txt` file so you can check your download.

### What it does

- Sends every request to the best model: free first, then cheap, then expensive.
  Under each reply it shows the model, the speed, the tokens and the tools used
- Works with OpenRouter, Gemini, OpenAI, Anthropic, and your own
  OpenAI-compatible models. A local Ollama model can be the maestro
- Can use your Claude subscription instead of an API key (see below)
- Has tabs, projects, saved conversations, and a long-term memory it reads before
  every task
- Has a copy button and the date and time under every message, and the date of
  each conversation in the history
- Hands each request to a skill: Coding, Research, or File. A skill is a plain
  `SKILL.md` file you can edit or turn off
- Connects to your apps from one Connectors page, each with Connect, Test and
  Disconnect buttons: Google (Gmail, Drive, Calendar, Docs, Sheets), GitHub,
  Microsoft 365, Canva, Miro, Notion, Linear, Cloudflare, Dropbox, Box, Google
  Cloud, Terraform, Kubernetes, Browser Use, Deepgram, AssemblyAI docs, Desktop
  Commander, and Filesystem
- Keeps write access off for every service until you turn it on, and asks you
  before each risky action. Deleting is never allowed
- Has a council mode where a second model checks and fixes the first answer
- Has a spending guard with a "free models only" switch
- Skips a model that prints fake tool calls as text, and moves to the next one
- Runs in the system tray

### How the maestro delegates

Every message goes through a small, fast maestro before any big model sees it.
The maestro does not answer you. It only decides how the request should be
handled:

```text
your message
   |
   v
 MAESTRO (local Ollama qwen3:1.7b -> OpenRouter free models -> keyword fallback)
   |  returns: complexity (simple/medium/complex), type (chat/code/research/file),
   |           which skill to use, and whether tools are needed
   +--> skill: Coding / Research / File (or any imported skill) --> its SKILL.md becomes the system prompt
   +--> tools: needed? --> builds a toolset from your enabled connectors (MCP) and project files
   +--> tier : simple = free then cheap | medium = free, cheap, expensive | complex = expensive first
   v
 chosen model answers (if it fails, the next model in the tier takes over)
```

**How a skill is picked.** A skill is a folder with a short `SKILL.md`, for
example "you are an expert programmer, explain step by step". The maestro picks
one of the three built-in skills (`delegate-coding`, `delegate-research`,
`delegate-file`) or one of your imported skills. For imported skills it only sees
the 8 names that fit the request best, so even a small local model can choose
well. The chosen `SKILL.md` becomes the system prompt, and your message is passed
as it is. A skill that is turned off is ignored.

**Why this helps**

- **Cheaper.** The cheap or local maestro does the thinking about the request.
  Expensive models are used only for complex work, and the "free models only"
  switch can block them.
- **Better answers.** The model gets instructions made for the job, and only the
  skill it needs is loaded, so the context stays small.
- **The right tools.** Connectors are attached only when the request needs them.
  Write tools stay hidden until you turn them on, and they still ask you first.
- **Easy to extend.** Add a skill by putting a `SKILL.md` in the skills folder, or
  from the Skills page. No code changes.
- **Hard to break.** If the local maestro is missing, the app uses OpenRouter,
  then a safe default. If a model fails, the next one answers.

### Council mode

Choose a council in the model menu under the chat box. The answer then goes
through one review round:

```text
1. draft    a model answers normally (tools, skills and memory work as usual)
2. critique a second model looks for real mistakes and missing parts, or says LGTM
3. revise   the first model fixes the valid points and gives the final answer
```

There are two ways to use it:

- **🏛️ Model council.** The app picks the writer and the critic, if possible from
  two different companies. It runs only for medium and complex requests that did
  not use tools.
- **🏛️ Council, I pick.** You choose the writer and the critic yourself, from any
  model in the menu. It runs for every request.

The draft shows first, and the final text replaces it when the review is done. If
the critic fails, you keep the draft. Expect about 2 to 3 times the usual time and
tokens. The chip under the answer shows who reviewed it and how many points were
fixed.

### Use your Claude subscription

If you have a Claude plan (Pro, Max, Team or Enterprise), you do not need an API
key. Install [Claude Code](https://docs.claude.com/en/docs/claude-code/overview)
and sign in to it once. The app then shows these models in the menu:

- Claude (your account's default model)
- Claude Sonnet
- Claude Opus
- Claude Haiku

The app runs the official `claude` command for each answer. It never reads or
saves your login. The answers use your plan's limits, not API credit. With these
models the answer arrives in one piece, and connector tools are off. You can also
pick them as the writer or the critic in a council.

### What you need

- Windows 10 or 11, or Ubuntu / Debian (64-bit)
- An API key from at least one provider (an OpenRouter key with free models is
  enough to start), or a Claude plan with Claude Code signed in
- Optional: [Ollama](https://ollama.com) for a local maestro, and Node.js 20 or
  newer if you build it yourself

On Linux, computer control (it uses PowerShell) works on Windows only for now.
Everything else works. The `.deb` is the best choice on Ubuntu. The AppImage runs
with `--no-sandbox` on Ubuntu 24.04.

### Getting started, step by step

The app ships with **no keys, no accounts and no personal settings**. Everyone who
downloads it adds their own. Nothing below needs a developer.

1. **Install.** Download the installer from the
   [latest release](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest)
   and run it. Windows SmartScreen may warn you (the installer is not signed):
   press **More info**, then **Run anyway**.
2. **Add at least one model.** Open **الموديلات (Models)** in the side bar, pick a
   provider on the left (OpenRouter is the easiest, it has free models), paste your
   API key and press **تحقق (Verify)**. The test tells you if the key works. If it
   says the request is blocked by region (403), that is your country or IP, not
   your key: use a VPN or use OpenRouter.
3. **Or use your Claude plan.** Install Claude Code, sign in once, and the Claude
   models appear in the menu (see "Use your Claude subscription").
4. **Optional: a local maestro.** Install [Ollama](https://ollama.com) and pull
   `qwen3:1.7b`. Without it, the app uses OpenRouter free models.
5. **Chat.** Go to **المحادثات (Chats)**, type a request, and pick **Auto**, a
   model, or a council from the menu under the box. Attach files with **+**, drag
   and drop, or paste.
6. **Connect your apps (optional).** **الإعدادات ← الموصلات (Settings ← Connectors)**
   and **الإضافات (Plugins)**. Write access is off for every service until you turn
   it on, and risky actions always ask you first.
7. **Alerts and backup (optional).** **الإعدادات ← عام (Settings ← General)** has
   Telegram alerts and an encrypted settings export/import (`.trlx`, protected by a
   password you choose).
8. **Phone app (optional).** See the next section.

Your keys and settings stay on your own computer, in the app's data folder.

### Phone app (Android)

A small Android app that lets you use your computer's TRL_AI_Agent from your phone:
chat, choose the model or mode, approve risky commands, watch long tasks, and send
files, photos and voice notes to the app. **Everything runs on your computer. The
phone is only a screen.**

**Set it up (about 3 minutes)**

1. Install the desktop app and make sure it works (steps above).
2. Download **`TRL_AI_Agent-5.10.0-android.apk`** from the
   [latest release](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest)
   on your phone and install it (Android asks you to allow installing from this
   source once). It is a debug-signed build, not from the Play Store.
3. On the computer: **Settings ← General ← Phone app**. Turn on **Enable phone
   link**. When Windows Firewall asks, allow **Private networks**.
4. Press **ربط جهاز جديد (Pair a new device)**. A QR code appears.
5. Open the app on the phone. It asks for the camera and scans the QR. A 6-digit
   code shows on both screens. If they are the same, confirm on the computer.
6. Done. Now you can chat from the phone.

**Using it away from home (optional)**

By default the phone reaches your computer over the same Wi-Fi. To use it from
anywhere you need a small relay. It is blind: it only passes encrypted messages and
cannot read them. The free Cloudflare plan is enough:

```bash
cd relay/worker
npx wrangler login      # use YOUR Cloudflare account
npx wrangler deploy     # prints https://trl-relay.<your-name>.workers.dev
```

Then put `wss://trl-relay.<your-name>.workers.dev` in **Settings ← General ← Phone
app ← relay address**, save, and pair the phone again with a new QR (the address is
stored on the phone at pairing time). See [`relay/README.md`](relay/README.md).

**Security**

- Pairing uses a one-time QR that expires after 2 minutes, plus a 6-digit match
  code you confirm on the computer.
- Messages are end to end encrypted (X25519 + XChaCha20-Poly1305, new keys for
  every connection). The relay and the network see only encrypted bytes.
- Command approvals from the phone are signed by the phone and tied to the exact
  command, so they cannot be replayed.
- Confidential projects are never available from the phone. Dangerous commands
  (delete, format) can be approved from the phone only if you turn that on.
- You can remove any paired phone with one click in the same settings page.

**Good to know:** the computer must be on, with the app running. The app is Android
only. Messages you send from the phone run as their own sessions and do not appear
in the desktop chat window yet.

### How to build it

```bash
npm install
npm run dev          # run in development
npm run build:win    # build the Windows installer into release/
npm run build:linux  # build the AppImage and .deb on Ubuntu / Debian
```

### Your data

Everything stays on your computer. Your API keys and connector settings are saved
in the app's data folder. Nothing is sent anywhere except to the providers and
apps you choose.

### Built with

Electron, React, TypeScript, electron-vite, Tailwind CSS, electron-store, the
Vercel AI SDK, the Model Context Protocol (MCP), and electron-builder for the Windows and Linux
installers.

---

### License

TRL_AI_Agent is free for personal, educational, research and non-profit use.
It is **source-available, not open source**. You may not use it commercially,
modify it, or republish it anywhere except this repository. Want to use it in
a business? Write to tareknahas@live.com. Full terms are in [LICENSE](LICENSE),
and the licenses of the libraries it uses are in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

### Contributors

- Tarek Nahhas - author and maintainer
- AI - co-author


## بالعربي

وكيل ذكاء اصطناعي لسطح المكتب، يعمل على ويندوز ولينكس. تكتب طلبًا واحدًا، فيقرؤه
نموذج صغير اسمه "المايسترو"، ويقدّر صعوبته، ويختار النموذج المناسب للمهمة بدءًا
بالأرخص. وإذا فشل نموذج، يأخذ التالي مكانه تلقائيًا. واجهة المحادثة بالعربي أولًا،
من اليمين إلى اليسار.

### الحالة

يعمل، لكنه مشروع شخصي. حمّل المثبّت من
[صفحة الإصدار الأخير](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest)،
أو ابنِه بنفسك. مثبّت ويندوز غير موقّع، لذلك يظهر تحذير SmartScreen في المرة الأولى:
اضغط **More info** ثم **Run anyway**. وفي كل إصدار ملف `SHA256SUMS.txt` لتتأكد من
سلامة الملف الذي حمّلته.

### ماذا يفعل

- يرسل كل طلب إلى أنسب نموذج: المجاني أولًا، ثم الرخيص، ثم الغالي. ويعرض تحت كل
  رد النموذج والسرعة والتوكنات والأدوات المستخدمة
- يعمل مع OpenRouter وGemini وOpenAI وAnthropic، ومع نماذجك المتوافقة مع OpenAI.
  ويمكن لنموذج Ollama محلي أن يكون هو المايسترو
- يستطيع استخدام اشتراكك في Claude بدل مفتاح API (التفاصيل في الأسفل)
- فيه تبويبات ومشاريع ومحادثات محفوظة، وذاكرة طويلة المدى يقرؤها قبل كل مهمة
- فيه زر نسخ والتاريخ والوقت تحت كل رسالة، وتاريخ كل محادثة في السجل
- يسلّم كل طلب إلى مهارة: البرمجة أو البحث أو الملفات. والمهارة ملف `SKILL.md`
  بسيط تستطيع تعديله أو إيقافه
- يربط تطبيقاتك من صفحة موصلات واحدة، ولكل تطبيق أزرار اتصال واختبار وفصل:
  Google (Gmail وDrive وCalendar وDocs وSheets) وGitHub وMicrosoft 365 وCanva وMiro
  وNotion وLinear وCloudflare وDropbox وBox وGoogle Cloud وTerraform وKubernetes
  وBrowser Use وDeepgram ووثائق AssemblyAI وDesktop Commander وFilesystem
- صلاحية الكتابة مغلقة لكل خدمة حتى تفتحها أنت، ويسألك قبل كل عملية حساسة.
  والحذف ممنوع دائمًا
- فيه وضع مجلس: نموذج ثانٍ يراجع الجواب الأول ويصحّحه
- فيه حارس إنفاق مع مفتاح "النماذج المجانية فقط"
- يتجاوز النموذج الذي يكتب استدعاءات أدوات مزيّفة كنص، وينتقل إلى التالي
- يعمل من أيقونة شريط النظام

### كيف يوزّع المايسترو العمل

تمر كل رسالة أولًا على مايسترو صغير وسريع قبل أن يراها أي نموذج كبير. المايسترو
لا يجيبك، بل يقرر فقط كيف يُعالَج الطلب:

```text
رسالتك
   |
   v
 المايسترو (Ollama محلي qwen3:1.7b ثم نماذج OpenRouter المجانية ثم قواعد كلمات احتياطية)
   |  يُرجع: التعقيد (بسيط/متوسط/معقّد)، النوع (محادثة/كود/بحث/ملفات)،
   |         المهارة المناسبة، وهل نحتاج أدوات
   +--> المهارة: برمجة / بحث / ملفات (أو أي مهارة مستوردة) --> يصبح ملف SKILL.md تعليمات النظام
   +--> الأدوات: مطلوبة؟ --> يجهّز أدوات من الموصلات المفعّلة (MCP) وملفات المشروع
   +--> الفئة: بسيط = مجاني ثم رخيص | متوسط = مجاني ورخيص وغالٍ | معقّد = الغالي أولًا
   v
 النموذج المختار يجيب (وإذا فشل يأخذ التالي في الفئة نفسها مكانه)
```

**كيف تُختار المهارة.** المهارة مجلد فيه ملف `SKILL.md` قصير، مثل "أنت مبرمج خبير،
اشرح خطوة بخطوة". يختار المايسترو واحدة من المهارات الثلاث المدمجة
(`delegate-coding` و`delegate-research` و`delegate-file`) أو واحدة من مهاراتك
المستوردة. ومن المهارات المستوردة لا يرى إلا أنسب 8 أسماء للطلب، لذلك يختار حتى
النموذج المحلي الصغير بشكل صحيح. ثم يصبح ملف `SKILL.md` المختار تعليمات النظام،
وتصل رسالتك كما هي. والمهارة الموقوفة يتم تجاهلها.

**لماذا يفيد هذا**

- **أوفر.** المايسترو الرخيص أو المحلي هو من يفكّر في الطلب. والنماذج الغالية لا
  تُستخدم إلا للعمل المعقّد، ومفتاح "النماذج المجانية فقط" يستطيع منعها.
- **أجوبة أدق.** يأخذ النموذج تعليمات مخصّصة للمهمة، ولا تُحمَّل إلا المهارة التي
  يحتاجها، فيبقى السياق صغيرًا.
- **الأدوات المناسبة.** لا تُربط الموصلات إلا عندما يحتاجها الطلب. وأدوات الكتابة
  مخفية حتى تفعّلها، وتطلب موافقتك أيضًا.
- **سهل التوسعة.** أضف مهارة بوضع ملف `SKILL.md` في مجلد المهارات، أو من صفحة
  المهارات. بدون أي تعديل في الكود.
- **صعب الكسر.** إذا لم يكن المايسترو المحلي موجودًا، يستخدم التطبيق OpenRouter ثم
  وضعًا افتراضيًا آمنًا. وإذا فشل نموذج، يجيب التالي.

### وضع المجلس

اختر مجلسًا من قائمة النموذج تحت مربع الكتابة. عندها يمر الجواب بجولة مراجعة
واحدة:

```text
1. مسودة   نموذج يجيب كالمعتاد (الأدوات والمهارات والذاكرة تعمل كالعادة)
2. نقد      نموذج ثانٍ يبحث عن أخطاء حقيقية ونواقص، أو يقول LGTM
3. تصحيح   النموذج الأول يصحّح النقاط الصحيحة ويعطي الجواب النهائي
```

هناك طريقتان لاستخدامه:

- **🏛️ مجلس النماذج.** يختار التطبيق الكاتب والناقد، ومن شركتين مختلفتين إن أمكن.
  ويعمل فقط للطلبات المتوسطة والمعقّدة التي لم تستخدم أدوات.
- **🏛️ مجلس، أنا أختار.** تختار أنت الكاتب والناقد من أي نموذج في القائمة. ويعمل
  لكل طلب.

تظهر المسودة أولًا، ثم يحل النص النهائي مكانها عند انتهاء المراجعة. وإذا فشل الناقد
تبقى المسودة معك. توقّع وقتًا وتوكنات أكثر بمرتين إلى ثلاث مرات من المعتاد. والشارة
تحت الجواب تعرض من راجعه وكم نقطة صُحّحت.

### استخدم اشتراكك في Claude

إذا كان عندك اشتراك Claude (Pro أو Max أو Team أو Enterprise)، فلا تحتاج مفتاح API.
ثبّت [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) وسجّل الدخول
فيه مرة واحدة. بعدها يعرض التطبيق هذه النماذج في القائمة:

- Claude (النموذج الافتراضي لحسابك)
- Claude Sonnet
- Claude Opus
- Claude Haiku

يشغّل التطبيق أمر `claude` الرسمي لكل جواب، ولا يقرأ بيانات دخولك ولا يحفظها. وتُحسب
الأجوبة من حدود اشتراكك، لا من رصيد API. مع هذه النماذج يصل الجواب دفعة واحدة،
وأدوات الموصلات تكون مغلقة. ويمكنك أيضًا اختيارها ككاتب أو ناقد في المجلس.

### ما الذي تحتاجه

- ويندوز 10 أو 11، أو أوبونتو / ديبيان (64 بت)
- مفتاح API من مزوّد واحد على الأقل (يكفي مفتاح OpenRouter مع النماذج المجانية
  للبداية)، أو اشتراك Claude مع تسجيل الدخول في Claude Code
- اختياري: [Ollama](https://ollama.com) لمايسترو محلي، وNode.js 20 أو أحدث إذا بنيت
  التطبيق بنفسك

على لينكس، التحكم بالجهاز (يعتمد على PowerShell) يعمل على ويندوز فقط حاليًا، وباقي
الميزات تعمل. وملف `.deb` هو الخيار الأفضل على أوبونتو. ويعمل الـ AppImage مع
`--no-sandbox` على أوبونتو 24.04.

### كيف تشغّل كل شي، خطوة خطوة

البرنامج بينزل **بدون أي مفاتيح أو حسابات أو إعدادات شخصية**. كل واحد بينزّلو بيحط
إعداداتو ومفاتيحو بإيدو. وما بتحتاج تكون مبرمج.

1. **التثبيت.** نزّل المثبّت من
   [صفحة آخر إصدار](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest)
   وشغّلو. ممكن يطلعلك تحذير SmartScreen لأنو المثبّت مو موقّع: اضغط **More info** وبعدين
   **Run anyway**.
2. **ضيف موديل واحد عالأقل.** افتح **الموديلات** من القائمة الجانبية، اختار مزوّد
   (OpenRouter هو الأسهل وفيه موديلات مجانية)، الصق مفتاح الـ API واضغط **تحقق**.
   إذا قال إنو الطلب محجوب حسب المنطقة (403) فهاد من بلدك أو الـ IP مو من المفتاح:
   شغّل VPN أو استعمل OpenRouter.
3. **أو استعمل اشتراك Claude.** ثبّت Claude Code وسجّل دخول مرة وحدة، وموديلات Claude
   بتطلع بالقائمة (شوف "استخدم اشتراكك في Claude").
4. **اختياري: مايسترو محلي.** ثبّت [Ollama](https://ollama.com) ونزّل `qwen3:1.7b`.
   بدونو البرنامج بيستعمل موديلات OpenRouter المجانية.
5. **احكي معو.** روح على **المحادثات**، اكتب طلبك، واختار **تلقائي** أو موديل أو مجلس
   من القائمة تحت مربع الكتابة. بتقدر ترفق ملفات بزر **+** أو سحب وإفلات أو لصق.
6. **اربط تطبيقاتك (اختياري).** **الإعدادات ← الموصلات** و**الإضافات**. صلاحية الكتابة
   مسكّرة لكل خدمة لحد ما تفتحها إنت، والعمليات الحساسة دايماً بيسألك قبلها.
7. **تنبيهات ونسخة احتياطية (اختياري).** **الإعدادات ← عام** فيها تنبيهات Telegram
   وتصدير/استيراد الإعدادات بملف `.trlx` مشفّر بكلمة سر بتختارها.
8. **تطبيق الموبايل (اختياري).** شوف القسم اللي بعدو.

مفاتيحك وإعداداتك بتضل عجهازك إنت، بمجلد بيانات البرنامج.

### تطبيق الموبايل (أندرويد)

تطبيق أندرويد صغير بيخليك تستعمل TRL_AI_Agent اللي عالكمبيوتر من تلفونك: شات،
اختيار الموديل أو الوضع، موافقة عالأوامر الحساسة، متابعة المهام الطويلة، وإرسال
ملفات وصور ورسائل صوتية. **كل الشغل بيصير عالكمبيوتر، والتلفون بس شاشة.**

**كيف تجهّزو (حوالي 3 دقايق)**

1. ثبّت برنامج الكمبيوتر وتأكد إنو شغّال (الخطوات فوق).
2. نزّل **`TRL_AI_Agent-5.10.0-android.apk`** من
   [آخر إصدار](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest)
   عالتلفون وثبّتو (أندرويد بيطلب منك تسمح بالتثبيت من هالمصدر مرة وحدة). هاد ملف
   تجريبي موقّع debug، مو من متجر Play.
3. عالكمبيوتر: **الإعدادات ← عام ← تطبيق الموبايل**. فعّل **الربط مع الموبايل**. وإذا
   سألك جدار حماية ويندوز، اسمح عالشبكات **الخاصة (Private)**.
4. اضغط **ربط جهاز جديد**. بيطلع QR.
5. افتح التطبيق عالتلفون. بيطلب الكاميرا وبيمسح الـ QR. بيظهر رمز من 6 أرقام عالشاشتين.
   إذا هنّي نفسهم، أكّد عالكمبيوتر.
6. خلص. هلأ بتقدر تحكي معو من التلفون.

**الاستعمال من برا البيت (اختياري)**

بالأساس التلفون بيوصل للكمبيوتر عن طريق نفس الواي فاي. إذا بدك تستعملو من أي مكان
بتحتاج relay صغير. هو "أعمى": بس بيمرّر رسائل مشفّرة وما بيقدر يقراها. الخطة المجانية
من Cloudflare بتكفي:

```bash
cd relay/worker
npx wrangler login      # سجّل بحساب Cloudflare تبعك إنت
npx wrangler deploy     # بيطلعلك https://trl-relay.<اسمك>.workers.dev
```

بعدين حط `wss://trl-relay.<اسمك>.workers.dev` بـ **الإعدادات ← عام ← تطبيق الموبايل ←
عنوان الـ relay**، واحفظ، وربط التلفون من جديد بـ QR جديد (لأنو العنوان بينحفظ
عالتلفون وقت الربط). التفاصيل بـ [`relay/README.md`](relay/README.md).

**الأمان**

- الربط بـ QR مرة وحدة بيخلص بعد دقيقتين، ومعو رمز تطابق من 6 أرقام بتأكدو عالكمبيوتر.
- الرسائل مشفّرة من الطرفين (X25519 + XChaCha20-Poly1305 بمفاتيح جديدة كل اتصال).
  الـ relay والشبكة بيشوفوا بايتات مشفّرة بس.
- الموافقة عالأوامر من التلفون موقّعة بمفتاح التلفون ومربوطة بالأمر نفسو، فما بتنعاد.
- المشاريع السرية ما بتظهر عالتلفون أبداً. والأوامر الخطيرة (حذف/فرمتة) بتنوافق من
  التلفون بس إذا إنت فعّلت هالخيار.
- بتشيل أي تلفون مربوط بضغطة من نفس صفحة الإعدادات.

**حاجات لازم تعرفها:** الكمبيوتر لازم يكون شغّال والبرنامج مفتوح. التطبيق لأندرويد بس.
والرسائل اللي بتبعتها من التلفون بتشتغل كجلسات لحالها وما بتظهر بنافذة الشات اللي
عالكمبيوتر لسا.

### كيف تبنيه

```bash
npm install
npm run dev          # تشغيل للتطوير
npm run build:win    # بناء مثبّت ويندوز داخل release/
npm run build:linux  # بناء AppImage و.deb على أوبونتو / ديبيان
```

### بياناتك

كل شيء يبقى على جهازك. مفاتيح API وإعدادات الموصلات تُحفظ في مجلد بيانات التطبيق.
ولا يُرسل شيء لأي جهة إلا المزوّدين والتطبيقات التي تختارها أنت.

### مبنيّ بـ

Electron وReact وTypeScript وelectron-vite وTailwind CSS وelectron-store وVercel AI SDK، وبروتوكول
Model Context Protocol (MCP)، وelectron-builder لمثبّتات ويندوز ولينكس.

### الترخيص

البرنامج مجاني للاستعمال الشخصي والتعليمي والبحثي وغير الربحي. هو **مصدره مفتوح
للقراءة بس، مو Open Source**. ممنوع تبيعو أو تستعملو تجارياً أو تعدّل عليه أو
تنشرو بأي مكان غير هالريبو. بدك تستعملو بشغل تجاري؟ احكيني على tareknahas@live.com.
التفاصيل الكاملة بملف [LICENSE](LICENSE)، وتراخيص المكتبات يلي بيستعملها بملف
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

### المساهمون

- طارق نحاس - صاحب المشروع والمشرف عليه
- AI - مشارك بالكتابة
