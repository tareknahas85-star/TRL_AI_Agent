import OpenAI from 'openai'
import type { Analysis } from './master'

export type FallbackResult = {
  content: string
  modelUsed: string
  success: boolean
  triedModels: string[]
}

export async function executeWithFallback(
  models: string[],
  userInput: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _analysis: Analysis,
  systemPrompt?: string
): Promise<FallbackResult> {
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    dangerouslyAllowBrowser: true
  })

  const triedModels: string[] = []

  // Direct provider keys for Tier 2/3. Direct APIs expect the bare model name
  // (no "google/" or "openai/" prefix), so the id sent is returned with the client.
  const getClientForModel = (model: string): { client: OpenAI; modelId: string } => {
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

  for (const model of models) {
    triedModels.push(model)
    try {
      console.log(`[Fallback] Trying model: ${model}`)
      const { client, modelId } = getClientForModel(model)
      const completion = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: userInput }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
      const content = completion.choices[0]?.message?.content || ''
      if (content) {
        console.log(`[Fallback] Success with: ${model}`)
        return { content, modelUsed: model, success: true, triedModels }
      }
      console.warn(`[Fallback] Empty response from ${model}`)
    } catch (error: unknown) {
      console.warn(`[Fallback] Failed ${model}:`, error instanceof Error ? error.message : error)
      // Continue to next model - don't throw
      continue
    }
  }
  return {
    content: 'All models failed. Please check your API keys.',
    modelUsed: 'none',
    success: false,
    triedModels
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
