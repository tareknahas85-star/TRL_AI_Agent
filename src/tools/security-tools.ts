import { createHash } from 'crypto'
import { createReadStream, statSync } from 'fs'
import { resolve } from 'path'
import type OpenAI from 'openai'
import { getPrefs } from '../core/prefs'
import { getApiKey } from '../store/secure-store'

// Security checks (opt-in, never offered in confidential projects):
//  - pwned_password_check: Have I Been Pwned "Pwned Passwords" with k-anonymity. Only the first 5 characters of the SHA-1 leave this machine, never the password.
//  - virustotal_hash_lookup: looks a file up on VirusTotal by hash. The file itself is NEVER uploaded; needs the user's own free VirusTotal API key.

const UA = 'TRL-AI-Agent/5.9 (personal desktop assistant)'
type Handlers = Map<string, (a: Record<string, unknown>) => Promise<string>>

const OFF = 'Error: security tools are switched off. Tell the user to enable them in Settings > General > Security checks.'
const HASH_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/i

export async function pwnedCount(sha1Hex: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const h = sha1Hex.trim().toUpperCase()
  if (!/^[0-9A-F]{40}$/.test(h)) return { ok: false, error: 'sha1 must be 40 hex characters' }
  try {
    const r = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { headers: { 'User-Agent': UA, 'Add-Padding': 'true' }, signal: AbortSignal.timeout(10000) })
    if (!r.ok) return { ok: false, error: `Pwned Passwords answered HTTP ${r.status}` }
    const rest = h.slice(5)
    for (const line of (await r.text()).split(/\r?\n/)) {
      const [suffix, cnt] = line.trim().split(':')
      if (suffix === rest) return { ok: true, count: Number(cnt) || 0 }
    }
    return { ok: true, count: 0 }
  } catch (e) {
    return { ok: false, error: 'could not reach Pwned Passwords: ' + (e instanceof Error ? e.message : String(e)) }
  }
}

function hashFile(path: string, algo: 'sha256'): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash(algo)
    const s = createReadStream(path)
    s.on('error', rej)
    s.on('data', (d) => h.update(d))
    s.on('end', () => res(h.digest('hex')))
  })
}

export async function vtLookup(hash: string, key: string): Promise<string> {
  try {
    const r = await fetch('https://www.virustotal.com/api/v3/files/' + hash.toLowerCase(), { headers: { 'x-apikey': key, 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
    if (r.status === 404) return JSON.stringify({ hash, found: false, note: 'VirusTotal has never seen this file. That is NOT proof it is safe; it only means nobody scanned it yet.' })
    if (r.status === 401 || r.status === 403) return 'Error: VirusTotal rejected the API key. Tell the user to re-check the key in Settings > General > Security checks.'
    if (r.status === 429) return 'Error: VirusTotal rate limit reached (the free key allows 4 lookups a minute and 500 a day). Tell the user to retry shortly.'
    if (!r.ok) return `Error: VirusTotal answered HTTP ${r.status}`
    const j = (await r.json()) as { data?: { attributes?: Record<string, unknown> } }
    const a = j.data?.attributes ?? {}
    const st = (a.last_analysis_stats ?? {}) as Record<string, number>
    const cls = (a.popular_threat_classification ?? {}) as { suggested_threat_label?: string }
    return JSON.stringify({
      hash,
      found: true,
      malicious: st.malicious ?? 0,
      suspicious: st.suspicious ?? 0,
      harmless: st.harmless ?? 0,
      undetected: st.undetected ?? 0,
      name: a.meaningful_name,
      type: a.type_description,
      threat_label: cls.suggested_threat_label,
      last_scan: typeof a.last_analysis_date === 'number' ? new Date(a.last_analysis_date * 1000).toISOString() : undefined,
      report: 'https://www.virustotal.com/gui/file/' + hash.toLowerCase(),
      note: 'Scanners can disagree; a few detections on an old unpopular file are often false positives, and zero detections does not guarantee safety.'
    })
  } catch (e) {
    return 'Error: could not reach VirusTotal: ' + (e instanceof Error ? e.message : String(e))
  }
}

export function addSecurityTools(defs: OpenAI.Chat.ChatCompletionTool[], handlers: Handlers): void {
  defs.push({
    type: 'function',
    function: {
      name: 'pwned_password_check',
      description:
        'Check whether a password appears in known data breaches (Have I Been Pwned, free). Only a 5-character prefix of the SHA-1 hash is sent out, never the password. Pass `sha1` (preferred, the user can compute it locally) or `password`. Never repeat the password in your answer, and tell the user to change any password reported as pwned.',
      parameters: { type: 'object', properties: { password: { type: 'string' }, sha1: { type: 'string', description: '40 hex characters' } } }
    }
  })
  handlers.set('pwned_password_check', async (a) => {
    if (!getPrefs().securityToolsEnabled) return OFF
    const pw = typeof a.password === 'string' ? a.password : ''
    const sha1 = pw ? createHash('sha1').update(pw, 'utf8').digest('hex') : String(a.sha1 ?? '')
    if (!sha1) return 'Error: pass a password or its sha1'
    const r = await pwnedCount(sha1)
    if (!r.ok) return 'Error: ' + r.error
    return JSON.stringify({ pwned: r.count > 0, times_seen_in_breaches: r.count, note: r.count > 0 ? 'This password is known to attackers; never use it and change it anywhere it is used.' : 'Not found in known breaches. That does not make it strong; length and uniqueness matter.' })
  })

  defs.push({
    type: 'function',
    function: {
      name: 'virustotal_hash_lookup',
      description:
        'Look up a file on VirusTotal by hash (SHA-256, SHA-1 or MD5), or by a local file path (hashed on this PC; the file is never uploaded). Returns how many engines flag it. Use before installing a downloaded skill, MCP server or program.',
      parameters: { type: 'object', properties: { hash: { type: 'string' }, file_path: { type: 'string', description: 'absolute path of a local file to hash' } } }
    }
  })
  handlers.set('virustotal_hash_lookup', async (a) => {
    if (!getPrefs().securityToolsEnabled) return OFF
    const key = getApiKey('VIRUSTOTAL_API_KEY')
    if (!key) return 'Error: no VirusTotal API key. Tell the user to add a free key in Settings > General > Security checks.'
    let hash = String(a.hash ?? '').trim()
    const fp = String(a.file_path ?? '').trim()
    if (!hash && fp) {
      try {
        const p = resolve(fp)
        if (!statSync(p).isFile()) return 'Error: file_path is not a file'
        hash = await hashFile(p, 'sha256')
      } catch (e) {
        return 'Error: could not read the file: ' + (e instanceof Error ? e.message : String(e))
      }
    }
    if (!HASH_RE.test(hash)) return 'Error: pass a valid SHA-256/SHA-1/MD5 hash or a file_path'
    return vtLookup(hash, key)
  })
}