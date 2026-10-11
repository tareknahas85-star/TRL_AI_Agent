// Standing instructions that every request gets, plus the cheap detectors that decide which tools a request needs.

// Reply language: the user's language; for Arabic, spoken Levantine (Shami), not formal Fusha or another dialect.
export const SHAMI_HINT =
  '\n\nREPLY LANGUAGE: answer in the language of the user\'s message. When the user writes Arabic, reply in Levantine (Shami / Syrian) spoken Arabic: natural, warm and direct, not formal Modern Standard Arabic, and never Gulf or Egyptian dialect words (for example use "بدي" and "شو" and "هلأ", not "أبغى" or "إيش"). Switch to Fusha or another dialect only if the user explicitly asks. Keep code, commands, file names and technical terms in English.'

// Things that change over time must come from a tool, never from the model's memory.
export const FRESH_HINT =
  '\n\nFRESHNESS RULE: this request depends on information that can change or that lives outside the chat (current versions, prices, news, weather, places, a link, a file or a service). Do NOT answer it from memory. First call the matching tool (web search, page fetch, location, places or the relevant connector), answer from what it returns, and say in one short line which tool or source you used. If no suitable tool is available this turn, say so plainly instead of guessing.'

export const LOCATION_HINT =
  '\n\nLOCATION: for "near me", "nearby", "closest" or local-weather requests, call get_location first, then nearby_places (or a web search) with those coordinates. Always tell the user where the location came from (phone GPS, Wi-Fi/Windows or IP) and how accurate it is; an IP location can be wrong when a VPN is on. For places from OpenStreetMap say the data may be incomplete and opening hours should be verified.'

// Requests that need live data, a link, or an outside service. Matching is deliberately generous: offering a search tool is cheap, answering from stale memory is not.
const FRESH_RE =
  /اليوم|هلأ|هلق|حالياً|حاليا|الحين|آخر|أحدث|احدث|سعر|أسعار|اسعار|طقس|الجو |أخبار|اخبار|نتيجة|مباراة|نسخة|إصدار|اصدار|مين (هو )?(رئيس|وزير|مدير)|دوّر|دور على|ابحث|على النت|على الانترنت|على الإنترنت|رابط|قريب|أقرب|اقرب|مطعم|صيدلية|\b(latest|current|currently|today|now|price|prices|cost|news|weather|version|release|released|who is|who's|search|look up|google|near me|nearby|closest|url|website)\b|https?:\/\/|www\./i

const LOCATION_RE =
  /قريب مني|قريبة مني|أقرب|اقرب|حولي|حواليي|الطقس عندي|الجو عندي|بمنطقتي|وين أنا|وين انا|موقعي|\b(near me|nearby|closest|around me|my location|where am i)\b/i

export const needsFreshInfo = (input: string): boolean => FRESH_RE.test(input)
export const needsLocation = (input: string): boolean => LOCATION_RE.test(input)
