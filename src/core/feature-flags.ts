// أعلام الميزات. كل علم مغلق افتراضياً، ويُفعَّل فقط عبر متغير بيئة للمطوّر.
//
// محركات الاشتراك (Claude Code / Gemini CLI / Codex CLI) مخفية عن المستخدمين:
// شروط Anthropic و Google تمنع استخدام حسابات الاشتراك الشخصية في أدوات طرف ثالث،
// والمستخدم يضيف مفاتيح API من حسابه بدلاً منها.
export const subscriptionEnginesEnabled = (): boolean => process.env.TRL_DEV_SUBSCRIPTION_ENGINES === '1'
