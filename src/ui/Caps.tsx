import { Brain, Eye, Wrench } from 'lucide-react'

export type Caps = { vision?: boolean; tools?: boolean; reasoning?: boolean; est?: boolean }

// For models we have no real data about (custom servers): a rough guess from the name, shown with a "تقدير" tooltip.
export function guessCaps(id: string): Caps {
  return {
    est: true,
    vision: /vision|(^|[-_/])vl|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|gemma-?[34]|llava|pixtral|llama-?4|minicpm-v/i.test(id),
    tools: /gpt-|gemini|claude|qwen|llama-?3|llama-?4|mistral|nemotron|deepseek|gemma-?4|glm|kimi/i.test(id),
    reasoning: /reason|think|(^|[-_/])r1\b|(^|[-_/])o[134]\b|gpt-5|gemini-(2\.5|3)|claude-(opus|sonnet)|qwen-?3|deepseek-(r1|v4)/i.test(id)
  }
}

export function CapIcons({ caps }: { caps?: Caps }) {
  if (!caps) return null
  const sfx = caps.est ? ' (تقدير من الاسم)' : ''
  const items: [boolean | undefined, typeof Eye, string][] = [
    [caps.vision, Eye, 'بيقبل صور'],
    [caps.tools, Wrench, 'بيدعم الأدوات (tool calling)'],
    [caps.reasoning, Brain, 'بيفكّر قبل ما يجاوب (reasoning)']
  ]
  const on = items.filter((i) => i[0])
  if (!on.length) return null
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      {on.map(([, Icon, label]) => (
        <span key={label} title={label + sfx} aria-label={label + sfx} className="inline-flex"><Icon size={13} /></span>
      ))}
    </span>
  )
}
