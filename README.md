# TRL_AI_Agent (وكيل TRL الذكي)

**[⬇️ Download for Windows](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-1.0.0-windows-setup.exe)** &nbsp;|&nbsp; **[⬇️ حمّل نسخة ويندوز](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-1.0.0-windows-setup.exe)**

**[⬇️ Download for Linux (.deb)](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-1.0.0-linux-amd64.deb)** &nbsp;|&nbsp; **[⬇️ حمّل نسخة لينكس (.deb)](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest/download/TRL_AI_Agent-1.0.0-linux-amd64.deb)**

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

## بالعربي

وكيل ذكاء اصطناعي لسطح المكتب، بيشتغل على ويندوز ولينكس. بتكتبلو طلب واحد، فبيقراه
موديل صغير اسمو "المايسترو"، بيقدّر قديش الطلب صعب، وبيختار الموديل المناسب للشغلة
وبيبلش بالأرخص. وإذا موديل فشل، التاني بياخد مكانو لحالو. الواجهة عربي أول شي،
من اليمين لليسار.

### الحالة

شغّال، بس هو مشروع شخصي. نزّل المثبّت من
[صفحة آخر إصدار](https://github.com/tareknahas85-star/TRL_AI_Agent/releases/latest)،
أو ابنيه بإيدك. مثبّت ويندوز مو موقّع، فرح تطلعلك رسالة تحذير SmartScreen أول مرة:
دوس **More info** وبعدين **Run anyway**. وبكل إصدار في ملف `SHA256SUMS.txt` منشان
تتأكد إنو الملف اللي نزّلتو سليم.

### شو بيعمل

- بيبعت كل طلب لأنسب موديل: المجاني أول شي، بعدين الرخيص، بعدين الغالي. وبيعرضلك
  تحت كل رد أي موديل جاوب، وقديش خدت من وقت وتوكنات، وأي أدوات اشتغلت
- بيشتغل مع OpenRouter وGemini وOpenAI وAnthropic، ومع أي موديل متوافق مع OpenAI.
  وممكن موديل Ollama عندك عالجهاز يكون هو المايسترو
- بيقدر يستخدم اشتراكك بـ Claude بدل مفتاح API (التفاصيل تحت)
- فيه تبويبات ومشاريع ومحادثات محفوظة، وذاكرة طويلة بيقراها قبل كل مهمة
- فيه زر نسخ والتاريخ والوقت تحت كل رسالة، وتاريخ كل محادثة بالسجل
- بيسلّم كل طلب لمهارة: برمجة أو بحث أو ملفات. والمهارة ملف `SKILL.md` بسيط،
  بتقدر تعدّلو أو توقفو
- بيربط تطبيقاتك من صفحة موصلات وحدة، ولكل تطبيق أزرار اتصال واختبار وفصل:
  Google (Gmail وDrive وCalendar وDocs وSheets) وGitHub وMicrosoft 365 وCanva وMiro
  وNotion وLinear وCloudflare وDropbox وBox وGoogle Cloud وTerraform وKubernetes
  وBrowser Use وDeepgram ووثائق AssemblyAI وDesktop Commander وFilesystem
- صلاحية الكتابة مسكّرة لكل خدمة لحد ما أنت تفتحها، وبيسألك قبل أي عملية حساسة.
  والحذف ممنوع دايمًا
- فيه وضع مجلس: موديل تاني بيراجع الجواب الأول وبيصلّحو
- فيه حارس مصاريف مع زر "الموديلات المجانية بس"
- إذا موديل كتب استدعاءات أدوات مزيّفة كنص، بيتخطاه وبيروح عالتاني
- بيشتغل من أيقونة شريط النظام

### كيف المايسترو بيوزّع الشغل

كل رسالة بتمرق أول شي على مايسترو صغير وسريع قبل ما يشوفها أي موديل كبير. المايسترو
ما بيجاوبك، بس بيقرر كيف الطلب رح ينعالج:

```text
رسالتك
   |
   v
 المايسترو (Ollama محلي qwen3:1.7b، بعدين موديلات OpenRouter المجانية، بعدين قواعد كلمات احتياطية)
   |  بيرجّع: الصعوبة (بسيط/متوسط/معقّد)، النوع (محادثة/كود/بحث/ملفات)،
   |          المهارة المناسبة، وهل نحتاج أدوات
   +--> المهارة: برمجة / بحث / ملفات (أو أي مهارة مستوردة) --> ملف SKILL.md بيصير تعليمات النظام
   +--> الأدوات: مطلوبة؟ --> بيجهّز أدوات من الموصلات المفعّلة (MCP) وملفات المشروع
   +--> الفئة: بسيط = مجاني وبعدين رخيص | متوسط = مجاني ورخيص وغالي | معقّد = الغالي أول
   v
 الموديل المختار بيجاوب (وإذا فشل، التاني بنفس الفئة بياخد مكانو)
```

**كيف بتنختار المهارة.** المهارة مجلد فيه ملف `SKILL.md` قصير، مثل "إنت مبرمج خبير،
اشرح خطوة خطوة". المايسترو بيختار وحدة من التلات المدمجة
(`delegate-coding` و`delegate-research` و`delegate-file`) أو وحدة من مهاراتك
اللي استوردتها. ومن المستوردة ما بيشوف إلا أنسب 8 أسماء للطلب، فحتى الموديل المحلي
الصغير بيختار صح. بعدين ملف `SKILL.md` المختار بيصير تعليمات النظام، ورسالتك بتوصل
متل ما هي. والمهارة الموقوفة بتنتجاهل.

**ليش هيك أحسن**

- **أوفر.** المايسترو الرخيص أو المحلي هو اللي بيفكّر بالطلب. والموديلات الغالية
  ما بتنستخدم إلا للشغل المعقّد، وزر "الموديلات المجانية بس" بيقدر يمنعها.
- **أجوبة أدق.** الموديل بياخد تعليمات مخصصة للمهمة، وما بينحمّل إلا المهارة اللي
  بيحتاجها، فالسياق بيضل صغير.
- **الأدوات المناسبة.** الموصلات ما بتنربط إلا لما الطلب بيحتاجها. وأدوات الكتابة
  مخبّاية لحد ما تفعّلها، وبتطلب موافقتك كمان.
- **سهل توسّعو.** ضيف مهارة بحط ملف `SKILL.md` بمجلد المهارات، أو من صفحة المهارات.
  بدون ما تغيّر ولا سطر كود.
- **صعب ينكسر.** إذا المايسترو المحلي مو موجود، التطبيق بيستخدم OpenRouter وبعدو
  وضع افتراضي آمن. وإذا موديل فشل، اللي بعدو بيجاوب.

### وضع المجلس

اختار مجلس من قايمة الموديلات تحت خانة الكتابة. وقتها الجواب بيمرق بجولة مراجعة وحدة:

```text
1. مسودة   موديل بيجاوب عادي (الأدوات والمهارات والذاكرة بتشتغل متل العادة)
2. نقد      موديل تاني بيدوّر على أخطاء ونواقص حقيقية، أو بيقول LGTM
3. تصحيح   الموديل الأول بيصلّح النقاط الصح وبيعطي الجواب النهائي
```

في طريقتين لاستخدامو:

- **🏛️ مجلس الموديلات.** التطبيق بيختار الكاتب والناقد، ومن شركتين مختلفتين إذا
  أمكن. وبيشتغل بس للطلبات المتوسطة والمعقدة اللي ما استخدمت أدوات.
- **🏛️ مجلس، أنا بختار.** أنت بتختار الكاتب والناقد من أي موديل بالقايمة. وبيشتغل
  لكل طلب.

المسودة بتظهر أول، وبعدين النص النهائي بيحل مكانها لما تخلص المراجعة. وإذا الناقد
فشل، المسودة بتبقى معك. توقّع وقت وتوكنات أكتر مرتين لتلات مرات من العادي. والشارة
تحت الجواب بتعرض مين راجعو وكم نقطة انصلّحت.

### استخدم اشتراكك بـ Claude

إذا عندك اشتراك Claude (Pro أو Max أو Team أو Enterprise)، ما بتحتاج مفتاح API.
ثبّت [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) وسجّل دخول
فيه مرة وحدة. بعدها التطبيق بيعرض هالموديلات بالقايمة:

- Claude (الموديل الافتراضي لحسابك)
- Claude Sonnet
- Claude Opus
- Claude Haiku

التطبيق بيشغّل أمر `claude` الرسمي لكل جواب، وما بيقرا بيانات دخولك ولا بيحفظها.
والأجوبة بتنحسب من حدود اشتراكك، مو من رصيد API. مع هالموديلات الجواب بيوصل دفعة
وحدة، وأدوات الموصلات بتكون مسكّرة. وكمان بتقدر تختارهن ككاتب أو ناقد بالمجلس.

### شو بتحتاج

- ويندوز 10 أو 11، أو أوبونتو / ديبيان (64 بت)
- مفتاح API من مزوّد واحد عالأقل (مفتاح OpenRouter مع الموديلات المجانية بيكفي
  للبداية)، أو اشتراك Claude مع تسجيل دخول بـ Claude Code
- اختياري: [Ollama](https://ollama.com) لمايسترو محلي، وNode.js 20 أو أحدث إذا
  بنيت التطبيق بإيدك

على لينكس، التحكم بالجهاز (بيعتمد على PowerShell) هلق بيشتغل على ويندوز بس، وباقي
الميزات شغالة. وملف `.deb` هو الأحسن على أوبونتو. والـ AppImage بيشتغل مع
`--no-sandbox` على أوبونتو 24.04.

### كيف بتبنيه

```bash
npm install
npm run dev          # تشغيل للتطوير
npm run build:win    # بناء مثبّت ويندوز جوا release/
npm run build:linux  # بناء AppImage و.deb على أوبونتو / ديبيان
```

### بياناتك

كل شي بيضل على جهازك. مفاتيح API وإعدادات الموصلات بتنحفظ بمجلد بيانات التطبيق.
وما بيتبعت شي لأي جهة إلا للمزوّدين والتطبيقات اللي أنت بتختارها.

### مبنيّ بـ

Electron وReact وTypeScript وelectron-vite وTailwind CSS وelectron-store وVercel AI SDK، وبروتوكول
Model Context Protocol (MCP)، وelectron-builder لمثبّتات ويندوز ولينكس.
