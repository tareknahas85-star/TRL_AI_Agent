import { hostOf } from './hosts'
import OpenAI from 'openai'
import fs from 'fs'
import { dataFile } from './json-store'
import { bumpFreeCount, modelBlockReason, noteModelFailure } from './model-health'
import { notePinOutcome } from './free-pin'
import type { Analysis } from './master'
import type { Toolset } from '../mcp/runtime'
import { emitProgress, emitStream, currentSignal } from './progress'
import { CUSTOM_PREFIX, clientForCustomModel, getCustomModel } from './custom-models'
import { textProtocol, textToolLoop } from './text-tools'
import { effortExtra, getEffort, type EffortRoute } from './effort'
import { buildCliPrompt, cliModelAlias, isCliModel, runClaudeCliEx } from './cli-models'


/* eslint-disable @typescript-eslint/no-explicit-any */
// Streams a plain (tool-less) completion, forwarding text chunks to the UI as they arrive.
async function streamCompletion(
  client: OpenAI,
  params: { model: string; messages: OpenAI.Chat.ChatCompletionMessageParam[]; temperature: number; max_tokens: number } & Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; ms: number }> {
  const t0 = Date.now()
  let content = ''
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  let emitted = false
  const run = async (withUsage: boolean): Promise<void> => {
    if (/:free$|^openrouter\/free$/.test(String(params.model))) bumpFreeCount()
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

// Every failed attempt is also appended to router.log in the data folder, so problems can be diagnosed after the fact.
function loggedFailures(): { model: string; reason: string }[] {
  const arr: { model: string; reason: string }[] = []
  const push = arr.push.bind(arr)
  arr.push = (...items) => {
    try {
      fs.appendFileSync(dataFile('router.log'), items.map((i) => new Date().toISOString() + ' ' + i.model + ' :: ' + i.reason.replace(/\s+/g, ' ')).join('\n') + '\n')
    } catch {
      /* logging is best-effort */
    }
    return push(...items)
  }
  return arr
}

export type FallbackResult = {
  content: string
  modelUsed: string
  success: boolean
  triedModels: string[]
  toolsUsed?: string[]
  usage?: { promptTokens: number; completionTokens: number; genMs: number; estimated: boolean }
  failures?: { model: string; reason: string }[]
  modelDetail?: string
  effort?: string
}

export async function executeWithFallback(
  models: string[],
  userInput: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _analysis: Analysis,
  systemPrompt?: string,
  toolset?: Toolset | null,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  opts: { requireTools?: boolean; escalate?: boolean } = {}
): Promise<FallbackResult> {
  const openai = new OpenAI({
    baseURL: hostOf('openrouter'),
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
          baseURL: hostOf('gemini')
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
  const failures: { model: string; reason: string }[] = loggedFailures()

  let skipModel = false
  const queue = [...models]
  let handoff = ''
  let modelDetail = ''
  let effortApplied = ''
  const mkHandoff = (model: string, why: string, calls: { key: string; out: string }[]): string =>
    '\n\nHANDOFF: a previous model (' + model + ') worked on this request and did not finish (' + why + '). Actions it ran (some may already have taken effect, check before repeating): ' +
    calls.slice(-8).map((c) => c.key.slice(0, 160) + ' => ' + c.out.slice(0, 160).replace(/\s+/g, ' ')).join(' | ') + '. Continue from the current state and finish the job.'
  let lastFailed: { content: string; model: string; reason: string } | null = null
  let freeLimitNoted = false
  while (queue.length) {
    const model = queue.shift() as string
    const blocked = modelBlockReason(model)
    if (blocked) {
      if (blocked === 'free-daily-limit' && !freeLimitNoted) {
        freeLimitNoted = true
        failures.push({ model: 'OpenRouter (مجاني)', reason: 'حد الطلبات المجانية اليومي خلص، البرنامج بيتخطى الموديلات المجانية لحد نص الليل UTC (بيفتح فوراً إذا ضفت 10$ رصيد على OpenRouter)' })
        emitProgress('الحد المجاني اليومي خلص — بتخطى الموديلات المجانية')
      }
      continue
    }
    triedModels.push(model)
    skipModel = false
    try {
      console.log(`[Fallback] Trying model: ${model}`)
      emitProgress('يجرّب: ' + model)
      if (isCliModel(model)) {
        const t0 = Date.now()
        const alias = cliModelAlias(model)
        const hasPc = !!toolset?.defs.some((d) => (d as { function?: { name?: string } }).function?.name?.startsWith('pc_'))
        const sysBase = (systemPrompt || '') + VERIFY_HINT + (hasPc ? PC_HINT + AGENT_HINT : '') + handoff
        if (toolset?.defs.length) {
          // The account only returns text, so the APP runs the tools for it (text protocol).
          const sys = sysBase + capabilityBlock(model, toolset, false) + textProtocol(toolset)
          const r = await textToolLoop({
            toolset,
            maxRounds: hasPc ? 40 : 8,
            onTool: (n) => {
              emitProgress('أداة: ' + n)
              toolsUsed.push(n)
            },
            call: async (p) => {
              const r1 = await runClaudeCliEx(buildCliPrompt(undefined, history, userInput + p), signal, alias, 180000, getEffort(), sys)
              if (r1.model) modelDetail = r1.model
              return r1.text
            }
          })
          effortApplied = getEffort() === 'auto' ? '' : getEffort()
          let text = r.content
          const why = attemptFailure(r.calls, r.capHit, text, unverifiedClaimWarning(model, userInput, text, toolsUsed, toolset, false, false, history))
          if (why) {
            failures.push({ model, reason: 'ما كمّل المهمة (' + why + ')' })
            lastFailed = { content: text, model, reason: why }
            if (queue.length && opts.escalate !== false) {
              queue.sort((a, b) => Number(/claude/i.test(b)) - Number(/claude/i.test(a)))
              handoff = mkHandoff(model, why, r.calls)
              emitProgress('صعّد من ' + model + ' لموديل تاني: ' + why)
              continue
            }
            text = '⚠️ المهمة ما اكتملت (' + why + '). ما تعتمد على أي "تم" فيها.\n\n' + text
          }
          emitStream('chunk', text)
          return {
            content: text,
            modelUsed: model,
            modelDetail,
            effort: effortApplied,
            success: true,
            triedModels,
            toolsUsed,
            failures,
            usage: { promptTokens: 0, completionTokens: Math.ceil(text.length / 3.5), genMs: Date.now() - t0, estimated: true }
          }
        }
        // Signed-in account via the official CLI: plain chat answer when the request needs no tools.
        const r0 = await runClaudeCliEx(buildCliPrompt(undefined, history, userInput), signal, alias, 180000, getEffort(), sysBase + capabilityBlock(model, null, false, true))
        const text = r0.text
        if (r0.model) modelDetail = r0.model
        effortApplied = getEffort() === 'auto' ? '' : getEffort()
        emitStream('chunk', text)
        const cliWarn = unverifiedClaimWarning(model, userInput, text, toolsUsed, null, false, true, history)
        return {
          content: cliWarn ? cliWarn + '\n\n' + text : text,
          modelUsed: model,
          modelDetail,
          effort: effortApplied,
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
      const route: EffortRoute = model.startsWith(CUSTOM_PREFIX)
        ? 'custom'
        : model.includes('gemini') && process.env.GEMINI_API_KEY && !model.includes(':free')
          ? 'gemini'
          : model.includes('gpt') && process.env.OPENAI_API_KEY && !model.includes(':free')
            ? 'openai'
            : 'openrouter'
      let extra = effortExtra(modelId, route)
      if (!model.startsWith(CUSTOM_PREFIX)) modelDetail = modelId
      effortApplied = Object.keys(extra).length ? getEffort() : ''
      const isEffortErr = (e: unknown): boolean => Object.keys(extra).length > 0 && [400, 422].includes((e as { status?: number })?.status ?? 0)
      const chat = async (params: Record<string, unknown>): Promise<OpenAI.Chat.ChatCompletion> => {
        if (route === 'openrouter' && (model.endsWith(':free') || model === 'openrouter/free')) bumpFreeCount()
        try {
          return (await client.chat.completions.create({ ...params, ...extra } as never, { signal })) as OpenAI.Chat.ChatCompletion
        } catch (e) {
          if (!isEffortErr(e)) throw e
          extra = {}
          effortApplied = ''
          return (await client.chat.completions.create(params as never, { signal })) as OpenAI.Chat.ChatCompletion
        }
      }
      let toolsRejected = noToolModels.has(model) && !!toolset?.defs.length
      let textMode = false
      const baseSystem = (systemPrompt || 'You are a helpful assistant.') + VERIFY_HINT + (toolset?.defs.some((d) => (d as { function?: { name?: string } }).function?.name?.startsWith('pc_')) ? PC_HINT + AGENT_HINT : '') + handoff
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: baseSystem + capabilityBlock(model, toolset, toolsRejected) },
        ...history.map((h) => ({ role: h.role, content: h.content }) as OpenAI.Chat.ChatCompletionMessageParam),
        { role: 'user', content: userInput }
      ]
      let useTools = !!toolset?.defs.length && !toolsRejected
      let content = ''
      let capHit = true
      const calls_: { name: string; key: string; out: string }[] = []
      const pcMode = !!toolset?.defs.some((d) => (d as { function?: { name?: string } }).function?.name?.startsWith('pc_'))
      for (let round = 0; round < (pcMode ? 40 : 8); round++) {
        if (!useTools && toolset?.defs.length) {
          // No native function calling: the APP runs the tools through the text protocol.
          textMode = true
          const sys = baseSystem + capabilityBlock(model, toolset, false) + textProtocol(toolset)
          const r = await textToolLoop({
            toolset,
            maxRounds: pcMode ? 40 : 8,
            onTool: (n) => {
              emitProgress('أداة: ' + n)
              toolsUsed.push(n)
            },
            call: async (p) => {
              const t1 = Date.now()
              const c = await chat({
                model: modelId,
                messages: [
                  { role: 'system', content: sys },
                  ...history.map((h) => ({ role: h.role, content: h.content }) as OpenAI.Chat.ChatCompletionMessageParam),
                  { role: 'user', content: userInput + p }
                ],
                temperature: 0.4,
                max_tokens: 4000
              })
              gen += Date.now() - t1
              if (c.usage) {
                usageSeen = true
                pt += c.usage.prompt_tokens ?? 0
                ct += c.usage.completion_tokens ?? 0
              }
              return c.choices[0]?.message?.content || ''
            }
          })
          content = r.content
          capHit = r.capHit
          calls_.push(...r.calls)
          break
        }
        if (!useTools) {
          let r
          try {
            r = await streamCompletion(client, { model: modelId, messages, temperature: 0.7, max_tokens: 1000, ...extra }, signal)
          } catch (e) {
            if (!isEffortErr(e)) throw e
            extra = {}
            effortApplied = ''
            r = await streamCompletion(client, { model: modelId, messages, temperature: 0.7, max_tokens: 1000 }, signal)
          }
          gen += r.ms
          if (r.usage) {
            usageSeen = true
            pt += r.usage.prompt_tokens ?? 0
            ct += r.usage.completion_tokens ?? 0
          }
          content = r.content
          capHit = false
          break
        }
        let completion
        const t0 = Date.now()
        try {
          completion = await chat({
            model: modelId,
            messages,
            temperature: 0.7,
            max_tokens: 4000,
            ...(useTools && toolset ? { tools: toolset.defs } : {})
          })
        } catch (err) {
          const status = (err as { status?: number }).status
          if (useTools && round === 0 && (status === 400 || status === 404 || status === 422)) {
            console.warn(`[Fallback] ${model} rejected tools, retrying without`)
            useTools = false
            toolsRejected = true
            noToolModels.add(model)
            failures.push({ model, reason: 'ما بيدعم function calling — البرنامج بيشغّل الأدوات عنو' })
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
            calls_.push({ name: c.function.name, key: c.function.name + JSON.stringify(args), out })
            messages.push({ role: 'tool', tool_call_id: c.id, content: out })
          }
          continue
        }
        content = msg?.content || ''
        capHit = false
        break
      }
      // Objective failure signals (not the model's own opinion): ran out of rounds, got stuck repeating itself / failing, or claimed success without proof.
      if (toolset && toolset.defs.length && !skipModel && (!toolsRejected || textMode)) {
        const why = attemptFailure(calls_, capHit, content, unverifiedClaimWarning(model, userInput, content, toolsUsed, toolset, toolsRejected && !textMode, false, history))
        if (why) {
          failures.push({ model, reason: 'ما كمّل المهمة (' + why + ')' })
          lastFailed = { content, model, reason: why }
          if (queue.length && opts.escalate !== false) {
            // Stronger model next (Claude first), and tell it what was already tried so it continues instead of starting over.
            queue.sort((a, b) => Number(/claude/i.test(b)) - Number(/claude/i.test(a)))
            handoff =
              '\n\nHANDOFF: a previous model (' + model + ') worked on this request and did not finish (' + why + '). Actions it ran (some may already have taken effect, check before repeating): ' +
              calls_.slice(-8).map((c) => c.key.slice(0, 160) + ' => ' + c.out.slice(0, 160).replace(/\s+/g, ' ')).join(' | ') + '. Continue from the current state and finish the job.'
            emitProgress('صعّد من ' + model + ' لموديل أقوى: ' + why)
            continue
          }
        }
      }
      if (skipModel) {
        emitProgress(model + ' ما بيدعم الأدوات — ينتقل للتالي')
        continue
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
        notePinOutcome(model, triedModels)
        // Safety net that does not depend on the model being honest: it claimed an action but used no tool.
        const warn = unverifiedClaimWarning(model, userInput, content, toolsUsed, toolset, toolsRejected && !textMode, false, history)
        if (warn) content = warn + '\n\n' + content
        return {
          content,
          modelUsed: model,
          modelDetail,
          effort: effortApplied,
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
      noteModelFailure(model, error instanceof Error ? error.message : String(error))
      failures.push({ model, reason })
      emitProgress('فشل ' + model + ' — ينتقل للتالي')
      continue
    }
  }
  if (lastFailed) {
    return {
      content: '⚠️ المهمة ما اكتملت. آخر محاولة (' + lastFailed.model + ') وقفت لأنو: ' + lastFailed.reason + '. ما تعتمد على أي "تم" فيها.\n\n' + lastFailed.content,
      modelUsed: lastFailed.model,
      success: true,
      triedModels,
      toolsUsed,
      failures
    }
  }
  if (opts.requireTools && failures.length && failures.every((f) => /أدوات|الأدوات|function calling/.test(f.reason))) {
    return {
      content:
        '❌ ما بقدر نفّذ هالطلب: كل الموديلات المتاحة ما بتدعم الأدوات (تنفيذ/حفظ ملفات).\nالحل: اختار موديل بيدعمها (Claude عبر OpenRouter، أو Gemini/GPT بمفتاح) وفعّل "التحكم بالجهاز" وافتح المشروع.',
      modelUsed: 'none',
      success: false,
      triedModels,
      failures
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

export const VERIFY_HINT =
  "\n\nVERIFY BEFORE FINISHING: after creating any file (video, audio, Excel, Word, program), re-check its real properties with a tool (e.g. duration/size via ffprobe or python, row counts, run the tests) and compare them to what the user asked. If anything differs (e.g. video 3s instead of 5s), say so explicitly in the final answer — never claim success for something you did not verify."

const PC_HINT_LINUX =
  "\n\nCOMPUTER CONTROL (Linux): pc_run runs bash commands, pc_read_file / pc_write_file / pc_list_dir handle files, pc_open opens a file or URL with xdg-open, and the office_* tools create Word/Excel/PowerPoint files (only .xlsx can be edited). There is NO screen control on Linux (no click, type, screenshot). Prefer pc_run and file tools. Some actions ask the user for approval; if he denies, stop and say so. Never try to bypass a block or security prompts. Keep going until the task is done, then summarize briefly in the user's language."
const PC_HINT_WIN =
  "\n\nCOMPUTER CONTROL: you can operate the user's Windows PC with the pc_* tools. Work step by step: (1) pc_windows / pc_ui_snapshot to see the screen, (2) act with pc_open / pc_click / pc_type / pc_keys, (3) call pc_ui_snapshot again to verify the result before continuing. Prefer pc_run (PowerShell) or file tools over clicking when they can do the job. Some actions ask the user for approval; if he denies, stop and say so. Never try to bypass a block, UAC, passwords or security prompts. Keep going until the task is done, then summarize briefly in the user's language."
const PC_HINT = process.platform === 'linux' ? PC_HINT_LINUX : PC_HINT_WIN


const TOOL_ERR = /^Error|BUILD FAILED|FAILURE: Build failed|is not recognized as|Cannot find path|\[timeout after|exit code:? [1-9]|denied/im
function attemptFailure(calls: { key: string; out: string }[], capHit: boolean, content: string, claimWarn: string): string {
  if (calls.some((c) => /the user denied|المستخدم رفض/.test(c.out))) return ''
  if (capHit && calls.length) return 'خلّصت الجولات المسموحة بدون نتيجة'
  if (calls.length >= 3) {
    const last3 = calls.slice(-3)
    if (last3.every((c) => TOOL_ERR.test(c.out))) return 'آخر 3 أدوات فشلت متتالية'
    if (last3.every((c) => c.key === last3[0].key)) return 'عم يكرر نفس الأمر'
  }
  if (claimWarn) return 'ادّعى التنفيذ بدون أداة'
  if (!content.trim() && calls.length) return 'ما رجّع جواب نهائي'
  return ''
}
const AGENT_HINT =
  '\n\nAGENT MODE (always on): you are an autonomous engineer on the user\'s own computer, like Claude Desktop. The user wants results, not questions. Rules: (1) Do the work with your tools; never ask for permission or details you can find yourself (list files, read them, check tools/env first). (2) Use the project folder as cwd for commands. (3) For builds/installs/tests pass timeout_seconds (e.g. 1500). "gradlew assembleDebug" works even without a wrapper; JAVA_HOME and ANDROID_HOME are set automatically. (4) If a command fails, read the error, fix the cause (edit the source with pc_write_file or a shell edit), and retry until it works or you hit a real blocker. (5) Before saying it is done, VERIFY with a tool (Test-Path or ls / file size / test output) and report the real path. (6) If a skill from use_skill matches the task, load it first. (7) If something truly cannot be done, say exactly what and why in one short message.'
// ---- Honesty about tools -------------------------------------------------------------------------------------------
// A model can only change anything outside the chat (create/save files, run commands, build) by calling a tool.
// Models that get no tools (or whose provider rejects them) used to answer as if they had done the work.

const toolNames = (toolset: Toolset | null | undefined): string[] =>
  (toolset?.defs ?? []).map((d) => (d as { function?: { name?: string } }).function?.name ?? '').filter(Boolean)

// Why the model has no usable tools this turn, in plain English (goes into the system prompt).
function noToolsReason(toolset: Toolset | null | undefined, rejected: boolean, cli = false): string {
  if (cli) return 'this model runs as a plain text chat through a signed-in account and has no tools at all'
  if (rejected) return 'the provider rejected tool calling for this model, so it cannot call tools (many free models cannot)'
  if (!toolset) return 'no tools were offered for this request (it was not classified as needing tools, and no project file tools applied)'
  return 'no matching tool was available for this request' + (toolset.notes.length ? ': ' + toolset.notes.join('; ') : '')
}

function capabilityBlock(model: string, toolset: Toolset | null | undefined, rejected: boolean, cli = false): string {
  const names = rejected || cli ? [] : toolNames(toolset)
  const head = names.length
    ? `Tools you can call this turn: ${names.join(', ')}.` + (toolset?.notes.length ? ` Not available: ${toolset.notes.join('; ')}.` : '')
    : `You have NO tools this turn (${model}): ${noToolsReason(toolset, rejected, cli)}.`
  return (
    '\n\nCAPABILITIES (authoritative, set by the app for this turn):\n' +
    head +
    '\nHONESTY RULES: You can only change anything outside this chat (create, save or edit files, run commands, build, install, send, open apps) by calling a tool listed above. ' +
    'Never say or imply you did something unless a tool result in this conversation confirms it, and quote the real path/output from that result. ' +
    'Never invent file paths, build output, file sizes or "done" messages. ' +
    'If the request needs something you cannot do now, say so plainly in the user\'s language (Levantine Arabic for Arabic users): what you cannot do, the exact reason (why you have no suitable tool), and what the user can do instead ' +
    '(switch to a model that supports tools, enable write access or PC control in the app, or run the given commands himself). Do not pretend and do not ask for permission you do not need.'
  )
}

// Request that asks for a real-world action / reply that claims one was completed.
export const BUILD_REQ = /ولّد|ولد|بني|ابني|بناء|احفظ|حفظ|انقل|انسخ|شغّل|شغل|نفّذ|نفذ|ثبّت|\.apk|\b(build|compile|save|install|deploy|execute)\b/i
const noToolModels = new Set<string>()
export const ACTION_REQ = /ولّد|ولد|بني|ابني|بناء|انشئ|أنشئ|اعمل|اكتب.{0,12}ملف|احفظ|حفاظ|حفظ|انقل|نقل|انسخ|نزّل|نزل|ارفع|شغّل|شغل|نفّذ|نفذ|ثبّت|ثبت|عدّل|عدل|صلّح|صلح|ابعت|\.apk|\b(build|create|generate|save|write|run|execute|install|edit|fix|deploy|send|download|compile|move|copy)\b/i
const DONE_CLAIM = /تم\b|تمّ|تمت|انحفظ|انبنى|بنيت|ولّدت|ولدت|أنشأت|انشأت|نفّذت|نفذت|حفظت|عدّلت|عدلت|نقلت|قمت ب|موجود|جاهز للاستخدام|✅|🎉|\b(done|created|saved|built|generated|completed|successfully|installed|exists?|moved|copied)\b/i
// A file path or file name with an extension in the reply: a claim about the disk that needs a tool result behind it.
const FILE_REF = /[A-Za-z]:\\[^\s`'"]+|\b[\w.-]+\.(apk|exe|zip|pdf|docx?|xlsx?|pptx?|ps1|kt|ts|py|json)\b/i

// If the model used no tool but claims it did the work, tell the user clearly (independent of the model's honesty).
function unverifiedClaimWarning(
  model: string,
  userInput: string,
  reply: string,
  toolsUsed: string[],
  toolset: Toolset | null | undefined,
  rejected: boolean,
  cli = false,
  history: { role: string; content: string }[] = []
): string {
  if (toolsUsed.length || !DONE_CLAIM.test(reply)) return ''
  // The request may sit in an earlier message ("ok", "the file is not there" are follow-ups), so look at the recent user turns too.
  const recentAsks = [userInput, ...history.filter((h) => h.role === 'user').slice(-4).map((h) => h.content)].join('\n')
  if (!ACTION_REQ.test(recentAsks) && !FILE_REF.test(reply)) return ''
  const offered = rejected || cli ? [] : toolNames(toolset)
  let why: string
  if (cli) why = 'هالموديل شغّال كمحادثة نصية بس عن طريق حساب مسجّل، وما إلو أدوات أصلاً.'
  else if (rejected) why = 'المزوّد رفض الأدوات لهالموديل، يعني ما بيدعم استدعاء الأدوات (function calling)، وهالشي شائع بالموديلات المجانية.'
  else if (!offered.length) {
    why = 'الأدوات ما انعرضت عليه بهالطلب (البرنامج ما صنّفو كطلب بيحتاج أدوات، أو ما في مشروع مفتوح، أو ما في أداة بتطابق).'
    if (toolset?.notes.length) why += ' تفاصيل: ' + toolset.notes.join(' | ') + '.'
  } else why = `الأدوات انعرضت عليه (${offered.slice(0, 6).join('، ')}) بس هو ما ناده ولا وحدة منها.`
  return (
    `⚠️ تنبيه من البرنامج (مو من الموديل): «${model}» ما استعمل ولا أداة بهالرد. يعني أي شي قاله إنو انعمل (ملف، بناء، حفظ، تشغيل) **ما انعمل فعلياً** عالجهاز، ولا تعتمد عليه.\n` +
    `السبب: ${why}\n` +
    'الحل: غيّر الموديل لواحد بيدعم الأدوات، أو فعّل صلاحية الكتابة / التحكم بالكمبيوتر من الإعدادات، وجرّب مرة تانية.'
  )
}
