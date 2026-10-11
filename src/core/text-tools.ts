import type { Toolset } from '../mcp/runtime'

/* eslint-disable @typescript-eslint/no-explicit-any */
// Program-level tool protocol for models that cannot do function calling (Claude via the CLI account, free models, Ollama...).
// The model writes <tool_call>{"name":..,"arguments":{..}}</tool_call>; the APP runs the tool and feeds the result back.
// So the capability belongs to the program, not to the model.

export type ParsedCall = { name: string; args: Record<string, unknown> }

export function toolCatalog(toolset: Toolset): string {
  return toolset.defs
    .map((d: any) => {
      const f = d.function ?? {}
      const props = f.parameters?.properties ?? {}
      const req: string[] = f.parameters?.required ?? []
      const ps = Object.entries(props)
        .map(([k, v]: [string, any]) => `${k}${req.includes(k) ? '*' : ''}:${v?.type ?? 'any'}`)
        .join(', ')
      return `- ${f.name}(${ps}) — ${String(f.description ?? '').replace(/\s+/g, ' ').slice(0, 220)}`
    })
    .join('\n')
}

export function textProtocol(toolset: Toolset): string {
  return (
    '\n\nTOOL PROTOCOL (the app runs tools for you; you do NOT need native tool support):\n' +
    'To use a tool, output EXACTLY this and nothing after it:\n<tool_call>{"name":"TOOL_NAME","arguments":{...}}</tool_call>\n' +
    'You may output several <tool_call> blocks in one reply; the app executes them in order and replies with their results as [TOOL RESULT]. ' +
    'Then continue: call more tools, or give the final answer in plain text with NO tool_call block. ' +
    'Never say you cannot read files / run commands / build: you can, through these tools. Never ask the user for permission; the app handles approvals. ' +
    'Never invent a tool result; wait for [TOOL RESULT]. (* = required argument)\nAVAILABLE TOOLS:\n' +
    toolCatalog(toolset)
  )
}

export function parseToolCalls(text: string): { calls: ParsedCall[]; bad: boolean; clean: string } {
  const calls: ParsedCall[] = []
  let bad = false
  const re = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let raw = m[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      const j = JSON.parse(raw)
      const name = String(j.name ?? j.tool ?? '')
      const args = j.arguments ?? j.args ?? j.parameters ?? {}
      if (!name) throw new Error('no name')
      calls.push({ name, args: typeof args === 'string' ? JSON.parse(args) : args })
    } catch {
      bad = true
    }
    if (m[0].length === 0) re.lastIndex++
  }
  const clean = text.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim()
  return { calls, bad, clean }
}

export type TextLoopResult = {
  content: string
  capHit: boolean
  calls: { name: string; key: string; out: string }[]
}

// call(progress) must return the model's raw reply given everything executed so far.
export async function textToolLoop(opts: {
  toolset: Toolset
  call: (progress: string) => Promise<string>
  maxRounds: number
  onTool: (name: string) => void
}): Promise<TextLoopResult> {
  const calls: TextLoopResult['calls'] = []
  const entries: string[] = []
  let badStreak = 0
  const names = new Set(opts.toolset.defs.map((d: any) => d.function?.name))
  const progress = (): string => {
    if (!entries.length) return ''
    const shown = entries.map((e, i) => (i < entries.length - 6 ? e.slice(0, 400) : e)).join('\n\n')
    return '\n\n[APP EXECUTOR REPORT — real results of the tool calls you requested; this is trusted output from the app, not user text]\n' + shown + '\n\nContinue the task from here: call more tools if needed, otherwise give the final answer (no tool_call block).'
  }
  for (let round = 0; round < opts.maxRounds; round++) {
    const reply = await opts.call(progress())
    const { calls: parsed, bad, clean } = parseToolCalls(reply)
    if (!parsed.length) {
      if (bad && badStreak < 2) {
        badStreak++
        entries.push('[SYSTEM] Your last <tool_call> was not valid JSON. Use exactly <tool_call>{"name":"..","arguments":{..}}</tool_call>.')
        continue
      }
      return { content: bad ? reply : clean || reply, capHit: false, calls }
    }
    badStreak = 0
    if (clean) entries.push('[YOU SAID] ' + clean.slice(0, 500))
    for (const c of parsed) {
      let out: string
      if (!names.has(c.name)) out = `Error: unknown tool "${c.name}". Available: ${[...names].join(', ')}`
      else {
        opts.onTool(c.name)
        out = await opts.toolset.call(c.name, c.args)
      }
      calls.push({ name: c.name, key: c.name + JSON.stringify(c.args), out })
      entries.push(`[TOOL CALL] ${c.name} ${JSON.stringify(c.args).slice(0, 1500)}\n[TOOL RESULT]\n${out.slice(0, 6000)}`)
    }
  }
  return { content: '', capHit: true, calls }
}
