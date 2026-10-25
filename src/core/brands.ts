// Model-brand badges shared by the desktop chat and the phone app.
// The glyphs are our own simple abstract marks in each brand's colour, not the official logos.
export interface Brand {
  id: string
  label: string
  color: string
  /** inner SVG markup for a 24x24 viewBox; strokes/fills are white */
  glyph: string
  test: RegExp
}

const S = 'fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'

// Order matters: first match wins (specific families before generic hosts).
export const BRANDS: Brand[] = [
  { id: 'claude', label: 'Claude', color: '#D97757', test: /claude|sonnet|opus|haiku/i, glyph: `<path ${S} d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>` },
  { id: 'openai', label: 'ChatGPT', color: '#10A37F', test: /gpt|codex|openai|\bo[1-9]\b|chatgpt/i, glyph: `<path ${S} d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path ${S} d="M12 8l3.9 2.25v4.5L12 17l-3.9-2.25v-4.5z"/>` },
  { id: 'gemini', label: 'Gemini', color: '#1A73E8', test: /gemini|gemma|nano-banana|veo|imagen/i, glyph: '<path fill="#fff" d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z"/>' },
  { id: 'deepseek', label: 'DeepSeek', color: '#4D6BFE', test: /deepseek/i, glyph: `<path ${S} d="M3.5 13c3-6 9.5-8 17-3-2.5.5-4 2-4.5 4.5-1.5-2.5-5-3-8 .5z"/><circle cx="16.5" cy="9.5" r=".8" fill="#fff"/>` },
  { id: 'meta', label: 'Meta Llama', color: '#0866FF', test: /llama|meta-/i, glyph: `<path ${S} d="M3.5 12c0-3.2 1.8-5.5 3.8-5.5 4.2 0 5 11 9.4 11 2 0 3.8-2.3 3.8-5.5s-1.800-5.500-3.800-5.500c-4.400 0-5.200 11-9.400 11-2 0-3.800-2.300-3.800-5.500z"/>` },
  { id: 'mistral', label: 'Mistral', color: '#F2630B', test: /mistral|mixtral|codestral|ministral|pixtral/i, glyph: '<g fill="#fff"><rect x="3" y="4" width="4" height="16"/><rect x="10" y="4" width="4" height="8"/><rect x="17" y="4" width="4" height="16"/><rect x="10" y="14" width="4" height="6" opacity=".6"/></g>' },
  { id: 'qwen', label: 'Qwen', color: '#615CED', test: /qwen|qwq/i, glyph: `<circle cx="11" cy="11" r="6.500" ${S}/><path ${S} d="M14.500 14.500L19 19"/>` },
  { id: 'xai', label: 'Grok', color: '#111111', test: /grok|xai/i, glyph: `<circle cx="12" cy="12" r="8" ${S}/><path ${S} d="M7 17L17 7"/>` },
  { id: 'moonshot', label: 'Kimi', color: '#16A4F0', test: /kimi|moonshot/i, glyph: `<path ${S} d="M8 5v14M8 12l8-7M10.500 11l6 8"/>` },
  { id: 'zhipu', label: 'GLM', color: '#3859FF', test: /glm|zhipu|chatglm/i, glyph: `<path ${S} d="M5 6h14L5 18h14"/>` },
  { id: 'nvidia', label: 'NVIDIA', color: '#76B900', test: /nvidia|nemotron/i, glyph: `<path ${S} d="M4 12c3-5 13-5 16 0-3 5-13 5-16 0z"/><circle cx="12" cy="12" r="2.200" fill="#fff"/>` },
  { id: 'microsoft', label: 'Microsoft Phi', color: '#2F2F2F', test: /\bphi[-\d]|microsoft/i, glyph: '<g fill="#fff"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></g>' },
  { id: 'cohere', label: 'Cohere', color: '#39594D', test: /cohere|command-r/i, glyph: `<path ${S} d="M17 7.500A7 7 0 1 0 17 16.500"/>` },
  { id: 'perplexity', label: 'Perplexity', color: '#20808D', test: /perplexity|sonar/i, glyph: `<path ${S} d="M12 3v18M6 7l6 5 6-5M6 17l6-5 6 5"/>` }
]

export const brandOf = (model: string | undefined | null): Brand | null => {
  if (!model) return null
  return BRANDS.find((b) => b.test.test(model)) || null
}

/** Standalone SVG string badge (round, coloured) for the phone UI / plain HTML. */
export const brandBadgeHtml = (b: Brand, size = 22): string =>
  `<span class="brand-badge" title="${b.label}" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${b.color};vertical-align:middle;flex:none"><svg viewBox="0 0 24 24" width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}">${b.glyph}</svg></span>`
