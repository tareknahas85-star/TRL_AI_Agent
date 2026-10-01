# TRL_AI_Agent (وكيل TRL الذكي)

**Windows desktop AI agent that sends each request to the best-fit model, and connects to your apps through MCP.** &nbsp;|&nbsp; **وكيل ذكاء اصطناعي لسطح المكتب يوجّه كل طلب لأنسب نموذج، ويتصل بتطبيقاتك عبر MCP.**

---

## In English

TRL_AI_Agent is a desktop app (Electron + React) with a chat window in Arabic first, right to left. You type one request. A small "maestro" model reads it, decides how hard it is, and picks the right model for the job, cheapest first. If a model fails, it moves to the next one on its own.

### What it does

- Routes every request to the best model (free first, then cheap, then expensive) and shows the speed, tokens, and tools used for each reply
- Works with OpenRouter, Gemini, OpenAI, Anthropic, and your own OpenAI-compatible models; a local Ollama model can act as the maestro
- Has tabs, projects, saved conversations, and a long-term memory it reads before every task
- Delegates to specialist skills: the maestro classifies each request and hands it to a Coding, Research, or File skill (plain `SKILL.md` instructions you can edit or disable, in the skills folder) and turns on the right tools for it
- Lets you connect your apps from one Connectors page, each with a Connect, Test, and Disconnect button: Google (Gmail, Drive, Calendar, Docs, Sheets), GitHub, Microsoft 365, Canva, Miro, Notion, Linear, Cloudflare, Dropbox, Box, Google Cloud, Terraform, Kubernetes, Browser Use, Deepgram, AssemblyAI docs, Desktop Commander, and Filesystem
- Keeps write access off by default for every service. You turn it on per service, and it asks you before each risky action. Deleting is never allowed
- Has a spending guard with a "free models only" switch
- Runs in the system tray

### How the maestro delegates

Every message goes through a small, fast "maestro" before any big model sees it. The maestro does not answer you. It only decides how the request should be handled:

```text
your message
   |
   v
 MAESTRO (local Ollama qwen3:1.7b -> OpenRouter free models -> keyword fallback)
   |  returns: complexity (simple/medium/complex), type (chat/code/research/file),
   |           which skill to delegate to, and whether tools are needed
   +--> skill: Coding / Research / File (or any imported skill) --> its SKILL.md becomes the system prompt
   +--> tools: needed? --> builds a toolset from your enabled connectors (MCP) and project files
   +--> tier : simple = free then cheap | medium = free, cheap, expensive | complex = expensive first
   v
 chosen model answers (if it fails, the next model in the tier takes over)
```

**How a skill gets called.** A skill is a folder with a plain `SKILL.md` (short instructions such as "you are an expert programmer, explain step by step"). The maestro either picks one of the three built-in delegates (`delegate-coding`, `delegate-research`, `delegate-file`) or one of your imported skills. For imported skills it only sees the 8 most relevant names for the request (keyword pre-filter), so even a small local model can choose well. The chosen `SKILL.md` is loaded as the system prompt and your message is passed untouched. Disabled skills are ignored and the default prompt is used.

**Why it helps**

- **Cheaper:** the cheap or local maestro does the thinking about the request. Expensive models are used only for complex work, and the "free models only" switch can block them entirely.
- **Better answers:** the model gets focused instructions for the job (code, research, files) instead of one generic prompt, and only the relevant skill is loaded, so the context stays small.
- **Right tools at the right time:** connectors are attached only when the request needs them (files, web, calendar, GitHub, ...). Write actions stay hidden until you enable them and still ask for approval.
- **Easy to extend:** add a skill by dropping a `SKILL.md` in the skills folder or from the Skills page. No code changes, and you can switch any skill on or off.
- **Resilient:** if the local maestro is missing the app falls back to OpenRouter, then to a safe default. If a model fails, the next one in the tier answers.

### What you need

- Windows 10 or 11
- An API key from at least one provider (an OpenRouter key with free models is enough to start)
- Optional: [Ollama](https://ollama.com) for a local maestro, and Node.js 20 or newer if you build it yourself

### How to build it

```bash
npm install
npm run dev        # run in development
npm run build:win  # build the Windows installer into release/
npm run build:linux  # build AppImage + deb on Ubuntu/Debian
```

On Linux, computer control (PowerShell-based) is Windows-only for now; everything else works. The AppImage runs with `--no-sandbox` on Ubuntu 24.04.

### Your data

Everything stays on your computer. Your API keys and connector settings are saved locally in the app's data folder, and nothing is sent anywhere except to the providers and apps you choose.

---

## بالعربي

TRL_AI_Agent تطبيق سطح مكتب (Electron + React) بواجهة محادثة بالعربي من اليمين إلى اليسار. تكتب طلباً واحداً، فيقرؤه "المايسترو" وهو نموذج صغير، ويقدّر صعوبته، ويختار النموذج المناسب بدءاً بالأرخص. وإذا فشل نموذج ينتقل تلقائياً للتالي.

### ماذا يفعل

- يوجّه كل طلب لأنسب نموذج (المجاني أولاً ثم الرخيص ثم الغالي) ويعرض لك سرعة الرد والتوكنات والأدوات المستخدمة
- يعمل مع OpenRouter وGemini وOpenAI وAnthropic ونماذجك المتوافقة مع OpenAI؛ ويمكن لنموذج Ollama محلي أن يكون هو المايسترو
- فيه تبويبات ومشاريع ومحادثات محفوظة وذاكرة طويلة المدى يقرؤها قبل كل مهمة
- تفويض لمهارات متخصصة: المايسترو يصنّف كل طلب ويحوّله لمهارة البرمجة أو البحث أو الملفات (تعليمات `SKILL.md` بسيطة تقدر تعدلها أو تعطلها من مجلد المهارات) ويفعّل الأدوات المناسبة له
- صفحة موصلات واحدة لربط تطبيقاتك، لكل تطبيق أزرار اتصال واختبار وفصل: Google (Gmail وDrive وCalendar وDocs وSheets) وGitHub وMicrosoft 365 وCanva وMiro وNotion وLinear وCloudflare وDropbox وBox وGoogle Cloud وTerraform وKubernetes وBrowser Use وDeepgram ووثائق AssemblyAI وDesktop Commander وFilesystem
- صلاحية الكتابة مغلقة افتراضياً لكل خدمة، وتفتحها أنت لكل خدمة على حدة، ويسألك قبل كل عملية حساسة. والحذف ممنوع دائماً
- حارس إنفاق مع مفتاح "النماذج المجانية فقط"
- يعمل من أيقونة شريط النظام

### كيف يفوّض المايسترو

كل رسالة بتمر أولاً على "مايسترو" صغير وسريع قبل ما أي نموذج كبير يشوفها. المايسترو ما بيجاوبك، شغلته بس يقرر كيف يُعالج الطلب:

```text
رسالتك
   |
   v
 المايسترو (Ollama محلي qwen3:1.7b ثم نماذج OpenRouter المجانية ثم قواعد كلمات احتياطية)
   |  بيرجّع: التعقيد (بسيط/متوسط/معقّد)، النوع (محادثة/كود/بحث/ملفات)،
   |          أي مهارة نفوّض لها، وهل نحتاج أدوات
   +--> المهارة: برمجة / بحث / ملفات (أو أي مهارة مستوردة) --> ملف SKILL.md بيصير تعليمات النظام
   +--> الأدوات: مطلوبة؟ --> بيجهّز أدوات من الموصلات المفعّلة (MCP) وملفات المشروع
   +--> الفئة: بسيط = مجاني ثم رخيص | متوسط = مجاني ورخيص وغالي | معقّد = الغالي أولاً
   v
 النموذج المختار بيجاوب (وإذا فشل بياخد الدور اللي بعده بنفس الفئة)
```

**كيف بتنادى المهارة.** المهارة هي مجلد فيه ملف `SKILL.md` بسيط (تعليمات قصيرة مثل "أنت مبرمج خبير، اشرح خطوة خطوة"). المايسترو إما بيختار وحدة من المهارات المدمجة الثلاث (`delegate-coding` و`delegate-research` و`delegate-file`) أو وحدة من مهاراتك المستوردة. بالمستوردة ما بيشوف غير أنسب 8 أسماء للطلب (فلترة بالكلمات)، فحتى نموذج محلي صغير بيختار صح. بعدها بيتحمّل `SKILL.md` كتعليمات للنظام ورسالتك بتوصل متل ما هي. المهارة المعطّلة بتنتجاهل وبيُستعمل الوضع الافتراضي.

**شو الفائدة**

- **أوفر:** المايسترو الرخيص أو المحلي هو اللي بيفكّر بالطلب، والنماذج الغالية بتُستعمل للشغل المعقّد بس، ومفتاح "النماذج المجانية فقط" بيمنعها كلياً.
- **أجوبة أدق:** النموذج بياخد تعليمات مركّزة للمهمة (كود، بحث، ملفات) بدل برومبت عام، وبيتحمّل بس المهارة المناسبة فالسياق بيضل صغير.
- **الأدوات المناسبة بالوقت المناسب:** الموصلات بتنربط بس لما الطلب يحتاجها (ملفات، ويب، تقويم، GitHub...). أدوات الكتابة مخفية لحد ما تفعّلها وبتطلب موافقتك.
- **سهل التوسعة:** ضيف مهارة بوضع ملف `SKILL.md` بمجلد المهارات أو من صفحة السكيلز، بدون أي تعديل كود، وبتقدر تشغّل أو تطفّي أي مهارة.
- **متين:** إذا المايسترو المحلي مو موجود بيرجع لـ OpenRouter ثم لوضع افتراضي آمن. وإذا فشل نموذج بياخد الدور اللي بعده.

### ما تحتاجه

- ويندوز 10 أو 11
- مفتاح API من مزوّد واحد على الأقل (يكفي مفتاح OpenRouter مع النماذج المجانية للبداية)
- اختياري: [Ollama](https://ollama.com) لمايسترو محلي، وNode.js 20 أو أحدث إذا بنيت التطبيق بنفسك

### طريقة البناء

```bash
npm install
npm run dev        # تشغيل للتطوير
npm run build:win  # بناء مثبّت ويندوز داخل release/
npm run build:linux  # بناء AppImage وdeb على أوبونتو/ديبيان
```

على لينكس، التحكم بالجهاز (المبني على PowerShell) خاص بويندوز حالياً، وباقي الميزات تشتغل. الـ AppImage بيشتغل مع `--no-sandbox` على أوبونتو 24.04.

### بياناتك

كل شيء يبقى على جهازك. مفاتيح API وإعدادات الموصلات تُحفظ محلياً في مجلد بيانات التطبيق، ولا يُرسل شيء لأي جهة إلا المزوّدين والتطبيقات التي تختارها أنت.

---

Author / المطوّر: [Tarek Nahhas](https://github.com/tareknahas85-star)
