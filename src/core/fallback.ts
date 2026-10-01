import OpenAI from 'openai'
import type { Analysis } from './master'
import type { Toolset } from '../mcp/runtime'
import { emitProgress, emitStream, currentSignal } from './progress'
import { CUSTOM_PREFIX, clientForCustomModel, getCustomModel } from './custom-models'
import { buildCliPrompt, cliModelAlias, isCliModel, runClaudeCli } from './cli-models'


/* eslint-disable @typescript-eslint/no-explicit-any */
// Streams a plain (tool-less) completion, forwarding text chunks to the UI as they arrive.
async function streamCompletion(
  client: OpenAI,
  params: { model: string; messages: OpenAI.Chat.ChatCompletionMessageParam[]; temperature: number; max_tokens: number },
  signal?: AbortSignal
): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; ms: number }> {
  const t0 = Date.now()
  let content = ''
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  let emitted = false
  const run = async (withUsage: boolean): Promise<void> => {
    const stream: any = await client.chat.completions.create(
      { ...params, stream: true, ...(withUsage ? { stream_options: { include_usage: true } } : {}) } as any,
      { signal }
    )
    for await (const chunk of stream) {
      const d = chunk?.choices?.[0]?.delta?.content
      if (typeof d === 'string' && d) {
        content += d
        emitted = true
        emitStream('chunk', d)
      }
      if (chunk?.usage) usage = chunk.usage
    }
  }
  try {
    await run(true)
  } catch (e) {
    const st = (e as { status?: number }).status
    if (!emitted && (st === 400 || st === 422) && !signal?.aborted) {
      content = ''
      await run(false)
    } else {
      if (emitted) emitStream('reset')
      throw e
    }
  }
  return { content, usage, ms: Date.now() - t0 }
}

export type FallbackResult = {
  content: string
  modelUsed: string
  success: boolean
  triedModels: string[]
  toolsUsed?: string[]
  usage?: { promptTokens: number; completionTokens: number; genMs: number; estimated: boolean }
  failures?: { model: string; reason: string }[]
}

export async function executeWithFallback(
  models: string[],
  userInput: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _analysis: Analysis,
  systemPrompt?: string,
  toolset?: Toolset | null,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<FallbackResult> {
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    dangerouslyAllowBrowser: true,
    timeout: 90000, // don't hang on a stuck free model; move on to the next one
    maxRetries: 0
  })

  const triedModels: string[] = []

  // Direct provider keys for Tier 2/3. Direct APIs expect the bare model name
  // (no "google/" or "openai/" prefix), so the id sent is returned with the client.
  const getClientForModel = (model: string): { client: OpenAI; modelId: string } => {
    if (model.startsWith(CUSTOM_PREFIX)) {
      const m = getCustomModel(model.slice(CUSTOM_PREFIX.length))
      if (!m) throw new Error('custom model removed')
      return clientForCustomModel(m)
    }
    const bare = model.includes('/') ? model.split('/').slice(1).join('/') : model
    if (model.includes('gemini') && process.env.GEMINI_API_KEY && !model.includes(':free')) {
      return {
        client: new OpenAI({
          apiKey: process.env.GEMINI_API_KEY,
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
        }),
        modelId: bare
      }
    }
    if (model.includes('gpt') && process.env.OPENAI_API_KEY && !model.includes(':free')) {
      return { client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), modelId: bare }
    }
    // Claude (and everything else) goes through OpenRouter for now
    return { client: openai, modelId: model }
  }

  const toolsUsed: string[] = []
  const signal = currentSignal()
  const failures: { model: string; reason: string }[] = []

  for (const model of models) {
    triedModels.push(model)
    try {
      console.log(`[Fallback] Trying model: ${model}`)
      emitProgress('يجرّب: ' + model)
      if (isCliModel(model)) {
        // Signed-in account via the official CLI: plain chat answer, no API key and no extra tools.
        const t0 = Date.now()
        const text = await runClaudeCli(buildCliPrompt(systemPrompt, history, userInput), signal, cliModelAlias(model))
        emitStream('chunk', text)
        return {
          content: text,
          modelUsed: model,
          success: true,
          triedModels,
          toolsUsed,
          failures,
          usage: { promptTokens: 0, completionTokens: Math.ceil(text.length / 3.5), genMs: Date.now() - t0, estimated: true }
        }
      }
      let pt = 0
      let ct = 0
      let gen = 0
      let usageSeen = false
      const { client, modelId } = getClientForModel(model)
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: (systemPrompt || 'You are a helpful assistant.') + (toolset?.defs.some((d) => (d as { function?: { name?: string } }).function?.name?.startsWith('pc_')) ? PC_HINT : '') },
        ...history.map((h) => ({ role: h.role, content: h.content }) as OpenAI.Chat.ChatCompletionMessageParam),
        { role: 'user', content: userInput }
      ]
      let useTools = !!toolset?.defs.length
      let content = ''
      const pcMode = !!toolset?.defs.some((d) => (d as { function?: { name?: string } }).function?.name?.startsWith('pc_'))
      for (let round = 0; round < (pcMode ? 16 : 6); round++) {
        if (!useTools) {
          const r = await streamCompletion(client, { model: modelId, messages, temperature: 0.7, max_tokens: 1000 }, signal)
          gen += r.ms
          if (r.usage) {
            usageSeen = true
            pt += r.usage.prompt_tokens ?? 0
            ct += r.usage.completion_tokens ?? 0
          }
          content = r.content
          break
        }
        let completion
        const t0 = Date.now()
        try {
          completion = await client.chat.completions.create({
            model: modelId,
            messages,
            temperature: 0.7,
            max_tokens: 1000,
            ...(useTools && toolset ? { tools: toolset.defs } : {})
          }, { signal })
        } catch (err) {
          const status = (err as { status?: number }).status
          if (useTools && round === 0 && (status === 400 || status === 404 || status === 422)) {
            console.warn(`[Fallback] ${model} rejected tools, retrying without`)
            useTools = false
            round--
            continue
          }
          throw err
        }
        gen += Date.now() - t0
        if (completion.usage) {
          usageSeen = true
          pt += completion.usage.prompt_tokens ?? 0
          ct += completion.usage.completion_tokens ?? 0
        }
        const msg = completion.choices[0]?.message
        const calls = (msg?.tool_calls ?? []).filter((c) => c.type === 'function') as {
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }[]
        if (useTools && toolset && msg && calls.length) {
          messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
          for (const c of calls) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(c.function.arguments || '{}')
            } catch {
              /* keep empty */
            }
            console.log(`[Tools] ${c.function.name}`)
            emitProgress('أداة: ' + c.function.name)
            toolsUsed.push(c.function.name)
            const out = await toolset.call(c.function.name, args)
            messages.push({ role: 'tool', tool_call_id: c.id, content: out })
          }
          continue
        }
        content = msg?.content || ''
        break
      }
      if (content && content.length < 400 && /to prevent abuse|free resource|too many requests|rate.?limit|quota (exceeded|exhausted)|insufficient (balance|quota|credit)|usage limit/i.test(content)) {
        failures.push({ model, reason: ('رد رفض: ' + content).slice(0, 90) })
        emitProgress('رفض ' + model + ' — ينتقل للتالي')
        continue
      }
      // Some models print a tool call as plain text (e.g. <tool_call>Bash …) instead of using function calling. That is not an answer.
      if (content && /<tool_call>|<arg_key>|<function_calls>|<invoke name=/i.test(content)) {
        failures.push({ model, reason: 'كتب استدعاء أداة كنص بدل ما ينفّذه' })
        emitProgress(model + ' كتب أداة كنص — ينتقل للتالي')
        continue
      }
      if (content) {
        console.log(`[Fallback] Success with: ${model}`)
        return {
          content,
          modelUsed: model,
          success: true,
          triedModels,
          toolsUsed,
          failures,
          usage: {
            promptTokens: pt,
            completionTokens: usageSeen ? ct : Math.ceil(content.length / 3.5),
            genMs: gen,
            estimated: !usageSeen
          }
        }
      }
      console.warn(`[Fallback] Empty response from ${model}`)
      failures.push({ model, reason: 'رد فارغ' })
    } catch (error: unknown) {
      if (signal?.aborted) break
      console.warn(`[Fallback] Failed ${model}:`, error instanceof Error ? error.message : error)
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 90)
      failures.push({ model, reason })
      emitProgress('فشل ' + model + ' — ينتقل للتالي')
      continue
    }
  }
  return {
    content: 'All models failed. Please check your API keys.',
    modelUsed: 'none',
    success: false,
    triedModels,
    failures
  }
}

export function calculateSavedCost(modelUsed: string, analysis: Analysis): string {
  void analysis
  // Show user how much he saved
  if (modelUsed.includes(':free')) return 'وفرت 100% - استخدمت موديل مجاني'
  if (modelUsed.includes('flash') || modelUsed.includes('mini'))
    return 'وفرت ~80% - استخدمت موديل رخيص'
  return 'استخدمت موديل قوي للمهام المعقدة'
}

const PC_HINT =
  "\n\nCOMPUTER CONTROL: you can operate the user's Windows PC with the pc_* tools. Work step by step: (1) pc_windows / pc_ui_snapshot to see the screen, (2) act with pc_open / pc_click / pc_type / pc_keys, (3) call pc_ui_snapshot again to verify the result before continuing. Prefer pc_run (PowerShell) or file tools over clicking when they can do the job. Some actions ask the user for approval; if he denies, stop and say so. Never try to bypass a block, UAC, passwords or security prompts. Keep going until the task is done, then summarize briefly in the user's language."
