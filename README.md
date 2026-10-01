# TRL_AI_Agent (وكيل TRL الذكي)

**Windows desktop AI agent that sends each request to the best-fit model, and connects to your apps through MCP.** &nbsp;|&nbsp; **وكيل ذكاء اصطناعي لسطح المكتب يوجّه كل طلب لأنسب نموذج، ويتصل بتطبيقاتك عبر MCP.**

---

## In English

TRL_AI_Agent is a desktop app (Electron + React) with a chat window in Arabic first, right to left. You type one request. A small "maestro" model reads it, decides how hard it is, and picks the right model for the job, cheapest first. If a model fails, it moves to the next one on its own.

### What it does

- Routes every request to the best model (free first, then cheap, then expensive) and shows the speed, tokens, and tools used for each reply
- Works with OpenRouter, Gemini, OpenAI, Anthropic, and your own OpenAI-compatible models; a local Ollama model can act as the maestro
- Has tabs, projects, saved conversations, and a long-term memory it reads before every task
- Lets you connect your apps from one Connectors page, each with a Connect, Test, and Disconnect button: Google (Gmail, Drive, Calendar, Docs, Sheets), GitHub, Microsoft 365, Canva, Miro, Notion, Linear, Cloudflare, Dropbox, Box, Google Cloud, Terraform, Kubernetes, Browser Use, Deepgram, AssemblyAI docs, Desktop Commander, and Filesystem
- Keeps write access off by default for every service. You turn it on per service, and it asks you before each risky action. Deleting is never allowed
- Has a spending guard with a "free models only" switch
- Runs in the system tray

### What you need

- Windows 10 or 11
- An API key from at least one provider (an OpenRouter key with free models is enough to start)
- Optional: [Ollama](https://ollama.com) for a local maestro, and Node.js 20 or newer if you build it yourself

### How to build it

```bash
npm install
npm run dev        # run in development
npm run build:win  # build the Windows installer into release/
```

### Your data

Everything stays on your computer. Your API keys and connector settings are saved locally in the app's data folder, and nothing is sent anywhere except to the providers and apps you choose.

---

## بالعربي

TRL_AI_Agent تطبيق سطح مكتب (Electron + React) بواجهة محادثة بالعربي من اليمين إلى اليسار. تكتب طلباً واحداً، فيقرؤه "المايسترو" وهو نموذج صغير، ويقدّر صعوبته، ويختار النموذج المناسب بدءاً بالأرخص. وإذا فشل نموذج ينتقل تلقائياً للتالي.

### ماذا يفعل

- يوجّه كل طلب لأنسب نموذج (المجاني أولاً ثم الرخيص ثم الغالي) ويعرض لك سرعة الرد والتوكنات والأدوات المستخدمة
- يعمل مع OpenRouter وGemini وOpenAI وAnthropic ونماذجك المتوافقة مع OpenAI؛ ويمكن لنموذج Ollama محلي أن يكون هو المايسترو
- فيه تبويبات ومشاريع ومحادثات محفوظة وذاكرة طويلة المدى يقرؤها قبل كل مهمة
- صفحة موصلات واحدة لربط تطبيقاتك، لكل تطبيق أزرار اتصال واختبار وفصل: Google (Gmail وDrive وCalendar وDocs وSheets) وGitHub وMicrosoft 365 وCanva وMiro وNotion وLinear وCloudflare وDropbox وBox وGoogle Cloud وTerraform وKubernetes وBrowser Use وDeepgram ووثائق AssemblyAI وDesktop Commander وFilesystem
- صلاحية الكتابة مغلقة افتراضياً لكل خدمة، وتفتحها أنت لكل خدمة على حدة، ويسألك قبل كل عملية حساسة. والحذف ممنوع دائماً
- حارس إنفاق مع مفتاح "النماذج المجانية فقط"
- يعمل من أيقونة شريط النظام

### ما تحتاجه

- ويندوز 10 أو 11
- مفتاح API من مزوّد واحد على الأقل (يكفي مفتاح OpenRouter مع النماذج المجانية للبداية)
- اختياري: [Ollama](https://ollama.com) لمايسترو محلي، وNode.js 20 أو أحدث إذا بنيت التطبيق بنفسك

### طريقة البناء

```bash
npm install
npm run dev        # تشغيل للتطوير
npm run build:win  # بناء مثبّت ويندوز داخل release/
```

### بياناتك

كل شيء يبقى على جهازك. مفاتيح API وإعدادات الموصلات تُحفظ محلياً في مجلد بيانات التطبيق، ولا يُرسل شيء لأي جهة إلا المزوّدين والتطبيقات التي تختارها أنت.

---

Author / المطوّر: [Tarek Nahhas](https://github.com/tareknahas85-star)
