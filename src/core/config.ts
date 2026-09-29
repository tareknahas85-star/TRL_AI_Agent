export const MODEL_TIERS = {
  TIER_1_FREE: [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "qwen/qwen-2-7b-instruct:free",
    "mistralai/mistral-7b-instruct:free"
  ],
  TIER_2_CHEAP: [
    "google/gemini-1.5-flash",
    "openai/gpt-4o-mini"
  ],
  TIER_3_EXPENSIVE: [
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o"
  ]
}
export const OPENROUTER_MODELS_API = "https://openrouter.ai/api/v1/models"
