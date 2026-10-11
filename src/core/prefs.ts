import { readJson, writeJson } from './json-store'

// Small user preferences kept in prefs.json (userData). Every key has a default, unknown keys are ignored.
export type Prefs = {
  locationEnabled: boolean // get_location / nearby_places tools (off until the user turns them on)
  learningEnabled: boolean // learn tool choices and interests from use (all local)
  learningPaused: boolean // "private mode": nothing is recorded while true
  onboardingDone: boolean // first-run interests screen answered
  interests: string[] // interest groups the user picked (see connector catalog)
  catalogEnabled: string[] // catalog connectors the user switched on
  askBeforeNewTools: boolean // ask before the first few uses of a tool group (learning period)
  approvedTools: string[] // tool groups the user approved for good
  securityToolsEnabled: boolean // pwned_password_check / virustotal_hash_lookup (off until the user turns them on)
}

const DEFAULTS: Prefs = {
  locationEnabled: false,
  learningEnabled: true,
  learningPaused: false,
  onboardingDone: false,
  interests: [],
  catalogEnabled: [],
  askBeforeNewTools: true,
  approvedTools: [],
  securityToolsEnabled: false
}

export function getPrefs(): Prefs {
  const s = readJson<Partial<Prefs>>('prefs.json', {})
  return {
    locationEnabled: s.locationEnabled === true,
    learningEnabled: s.learningEnabled !== false,
    learningPaused: s.learningPaused === true,
    onboardingDone: s.onboardingDone === true,
    interests: Array.isArray(s.interests) ? s.interests.filter((x) => typeof x === 'string') : [],
    catalogEnabled: Array.isArray(s.catalogEnabled) ? s.catalogEnabled.filter((x) => typeof x === 'string') : [],
    askBeforeNewTools: s.askBeforeNewTools !== false,
    approvedTools: Array.isArray(s.approvedTools) ? s.approvedTools.filter((x) => typeof x === 'string') : [],
    securityToolsEnabled: s.securityToolsEnabled === true
  }
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const cur = getPrefs()
  const next: Prefs = { ...cur }
  for (const k of Object.keys(DEFAULTS) as (keyof Prefs)[]) {
    if (!(k in patch)) continue
    const v = patch[k]
    if (typeof DEFAULTS[k] === 'boolean' && typeof v === 'boolean') (next as Record<string, unknown>)[k] = v
    else if (Array.isArray(DEFAULTS[k]) && Array.isArray(v)) (next as Record<string, unknown>)[k] = v.filter((x) => typeof x === 'string').slice(0, 200)
  }
  writeJson('prefs.json', next)
  return next
}
