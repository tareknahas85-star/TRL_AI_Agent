// Strong-first policy (pure decision, unit-tested). A complex or action request must not drop to a weaker model
// while a strong one is busy (cooling down or failed in this request). fallback.ts applies it.

export const STRONG_WAIT_MAX_SEC = 60 // longest we wait for a strong model's cooldown before asking the user

// Whether this request must stay on strong models. The user can lift it once (allowWeaker) after a refusal.
export function strongRequiredFor(allowWeaker: boolean, complexity: string, requireTools: boolean): boolean {
  return !allowWeaker && (complexity === 'complex' || requireTools)
}

export function refuseDowngrade(
  _model: string,
  strongInList: string[],
  busyStrong: string[],
  isStrongOrTrusted: boolean
): boolean {
  if (isStrongOrTrusted) return false
  return strongInList.length > 0 && busyStrong.length > 0
}
