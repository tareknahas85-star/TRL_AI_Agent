export const MODEL_TIERS = {
  TIER_1_FREE: [
    "qwen/qwen3.8-27b:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3.5-lightning:free"
  ],
  TIER_2_CHEAP: [
    "deepseek/deepseek-v4.1-flash",
    "google/gemini-3.5-flash-lite",
    "openai/gpt-4o-mini"
  ],
  TIER_3_EXPENSIVE: [
    "anthropic/claude-sonnet-5",
    "openai/gpt-4o"
  ]
}
// The "maestro": tried in order until one answers. Free models only (the account has no credit); openrouter/free is the last safety net.
export const MASTER_MODELS = [
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "openrouter/free"
]
export const OPENROUTER_MODELS_API = "https://openrouter.ai/api/v1/models"