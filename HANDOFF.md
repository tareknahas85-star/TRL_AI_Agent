# AI Router OS — نقطة الحفظ (2026-09-30)

نسخة التطوير: `C:\Users\tarek\my-ai-router-dev` (مثبّتة عبر `release\my-ai-router-1.0.0-setup.exe`).
ما لُمس: مسار Drive (Nasaq)، GitHub، إصدار v0.1.0.

## المنجز
- الذاكرة (Settings) + استيراد 12 مدخل.
- الماستر المحلي `qwen3:1.7b` (تحليل ~0.5-0.7ث) مع رجوع تلقائي للماستر السحابي.
- شريط معلومات، زر إيقاف، بث، Markdown، إعادة بنموذج آخر، بحث/تصدير المحادثات، نقاط الحالة.
- أدوات MCP داخل المحادثة (مصفّاة بقائمة RISKY).
- سجل المحادثة يُمرَّر للنماذج (12 رسالة / 12000 حرف).
- سكيلز من codeg: أُضيف officecli-academic-paper / financial-model / pitch-deck (المجموع 82).
- التحكم بالجهاز (Computer Control): `src/computer/control.ts` + `ui/ComputerPanel.tsx` (Settings). مطفي افتراضياً.
  أدوات: pc_run, pc_list_dir, pc_read_file, pc_write_file, pc_windows, pc_open, pc_focus,
  pc_ui_snapshot (UI Automation), pc_click, pc_type (لصق بأكواد VK، يدعم العربي), pc_keys, pc_scroll, pc_screenshot.
  الحماية: موافقة (مرة/الجلسة/رفض)، حجب الحذف والإطفاء والتنزيل والريجستري وUAC وملفات المفاتيح.
  مُختبَر مباشرة على الأدوات (Notepad). حلقة النموذج + الأدوات لم تُختبر بعد.

## المعلّق
1. اختبار حلقة التحكم بنموذج حقيقي: `computer.set(true)` ثم chat('شو النوافذ المفتوحة على جهازي؟').
   العائق: OpenRouter free-models-per-day (429) — تنتظر منتصف الليل UTC أو 10$ رصيد.
2. تحسين اختيار السكيلز agentdb-* عند الماستر الصغير.
3. اختياري: علم "حساس" لمدخلات الذاكرة.
4. الإصدار/نسخ Drive/GitHub: فقط بعد موافقة Tarek.

## تنبيهات
- احذف توكن Cloudflare المكشوف (يبدأ بـ `cfat_aL8E`).
- بقايا qwen3-vl (~1.8GB) في `%USERPROFILE%\.ollama\stale-partials` — يحذفها Tarek.

## البناء
`%TEMP%\air-dev-build4.ps1` (السجل `air-dev-build4.log` ينتهي بـ DONE) ثم `release\my-ai-router-1.0.0-setup.exe /S`، تشغيل مع `--remote-debugging-port=9444` للاختبار عبر CDP (`node C:\Users\tarek\air-ev.js <ملف>`).
