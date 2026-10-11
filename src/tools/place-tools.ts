import { execFile } from 'child_process'
import type OpenAI from 'openai'
import { getPrefs } from '../core/prefs'

// get_location (phone GPS -> Windows location service -> IP) and nearby_places (OpenStreetMap). Both are opt-in and never offered in confidential projects.

export type Fix = { lat: number; lon: number; accuracyM: number | null; source: 'phone-gps' | 'windows-wifi' | 'ip'; note?: string }

let phoneProvider: (() => Promise<{ lat: number; lon: number; accuracyM?: number } | null>) | null = null
// The phone link registers itself here; until then the phone source is simply skipped.
export function setPhoneLocationProvider(fn: typeof phoneProvider): void {
  phoneProvider = fn
}

const UA = 'TRL-AI-Agent/5.9 (personal desktop assistant)'

function windowsFix(): Promise<Fix | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const ps =
    "Add-Type -AssemblyName System.Device; $w=New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High); $null=$w.TryStart($false,[TimeSpan]::FromSeconds(6)); $l=$w.Position.Location; if($l.IsUnknown){'unknown'}else{[string]::Format([Globalization.CultureInfo]::InvariantCulture,'{0},{1},{2}',$l.Latitude,$l.Longitude,$l.HorizontalAccuracy)}"
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 12000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null)
      const m = String(out).trim().match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?|NaN)$/)
      if (!m) return resolve(null)
      const acc = Number(m[3])
      resolve({ lat: Number(m[1]), lon: Number(m[2]), accuracyM: Number.isFinite(acc) ? Math.round(acc) : null, source: 'windows-wifi' })
    })
  })
}

async function ipFix(): Promise<Fix | null> {
  try {
    const r = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } })
    const j = (await r.json()) as { success?: boolean; latitude?: number; longitude?: number; city?: string; country?: string }
    if (!j.success || typeof j.latitude !== 'number' || typeof j.longitude !== 'number') return null
    return { lat: j.latitude, lon: j.longitude, accuracyM: 10000, source: 'ip', note: `IP-based (${[j.city, j.country].filter(Boolean).join(', ')}); city-level only and wrong if a VPN is on` }
  } catch {
    return null
  }
}

export async function getFix(): Promise<Fix | null> {
  if (phoneProvider) {
    try {
      const p = await phoneProvider()
      if (p) return { lat: p.lat, lon: p.lon, accuracyM: p.accuracyM ?? null, source: 'phone-gps' }
    } catch {
      /* fall through */
    }
  }
  return (await windowsFix()) ?? (await ipFix())
}

async function reverse(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ar,en&lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } })
    const j = (await r.json()) as { display_name?: string }
    return j.display_name ?? ''
  } catch {
    return ''
  }
}

// Arabic and English words -> OSM tags.
const CATS: { re: RegExp; tags: string[] }[] = [
  { re: /مطعم|مطاعم|restaurant|food|eat/i, tags: ['amenity=restaurant', 'amenity=fast_food'] },
  { re: /كافيه|مقهى|قهوة|cafe|coffee/i, tags: ['amenity=cafe'] },
  { re: /صيدلية|صيدليات|pharmacy/i, tags: ['amenity=pharmacy'] },
  { re: /مستشفى|مستشفيات|hospital/i, tags: ['amenity=hospital'] },
  { re: /طبيب|عيادة|clinic|doctor/i, tags: ['amenity=clinic', 'amenity=doctors'] },
  { re: /بنك|مصرف|bank/i, tags: ['amenity=bank'] },
  { re: /صراف|atm/i, tags: ['amenity=atm'] },
  { re: /بنزين|وقود|محطة|fuel|gas station|petrol/i, tags: ['amenity=fuel'] },
  { re: /سوبرماركت|سوبر ماركت|بقالة|supermarket|grocery/i, tags: ['shop=supermarket', 'shop=convenience'] },
  { re: /فرن|مخبز|خبز|bakery/i, tags: ['shop=bakery'] },
  { re: /مسجد|جامع|mosque/i, tags: ['amenity=place_of_worship'] },
  { re: /فندق|hotel/i, tags: ['tourism=hotel'] },
  { re: /حلويات|sweets|pastry/i, tags: ['shop=pastry', 'shop=confectionery'] },
  { re: /مدرسة|school/i, tags: ['amenity=school'] },
  { re: /مول|مركز تسوق|mall/i, tags: ['shop=mall'] },
  { re: /حديقة|park/i, tags: ['leisure=park'] }
]

const rad = (d: number): number => (d * Math.PI) / 180
function dist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type Place = { name: string; type: string; meters: number; lat: number; lon: number; hours?: string; phone?: string }

async function overpass(lat: number, lon: number, radius: number, tags: string[]): Promise<Place[]> {
  const parts = tags.map((t) => {
    const [k, v] = t.split('=')
    return `nwr["${k}"="${v}"](around:${radius},${lat},${lon});`
  })
  const q = `[out:json][timeout:20];(${parts.join('')});out center 80;`
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(q),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    signal: AbortSignal.timeout(25000)
  })
  if (!r.ok) throw new Error('Overpass HTTP ' + r.status)
  const j = (await r.json()) as { elements?: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }
  const out: Place[] = []
  for (const e of j.elements ?? []) {
    const p = { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue
    const t = e.tags ?? {}
    const name = t['name:ar'] || t.name || t['name:en']
    if (!name) continue
    out.push({ name, type: t.amenity || t.shop || t.tourism || t.leisure || '', meters: Math.round(dist({ lat, lon }, { lat: p.lat, lon: p.lon })), lat: p.lat, lon: p.lon, hours: t.opening_hours, phone: t.phone || t['contact:phone'] })
  }
  return out.sort((a, b) => a.meters - b.meters)
}

async function nominatimSearch(q: string, lat: number, lon: number): Promise<Place[]> {
  const d = 0.1
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&accept-language=ar,en&bounded=1&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA } })
  const j = (await r.json()) as { display_name?: string; name?: string; lat: string; lon: string; type?: string }[]
  return j
    .map((x) => ({ name: x.name || (x.display_name ?? '').split(',')[0], type: x.type ?? '', meters: Math.round(dist({ lat, lon }, { lat: Number(x.lat), lon: Number(x.lon) })), lat: Number(x.lat), lon: Number(x.lon) }))
    .sort((a, b) => a.meters - b.meters)
}

// Settings > Location > "test": one fix, described for the user (works even while the tools are switched off).
export async function testLocation(): Promise<{ ok: boolean; message: string; source?: string; accuracyM?: number | null; address?: string; note?: string }> {
  const f = await getFix()
  if (!f) return { ok: false, message: 'ما قدرت أحدد الموقع: خدمات الموقع بويندوز مطفية أو ما في إنترنت.' }
  const src = f.source === 'phone-gps' ? 'GPS الموبايل' : f.source === 'windows-wifi' ? 'خدمة الموقع بويندوز (واي فاي)' : 'الـIP'
  return { ok: true, message: 'تمام', source: src, accuracyM: f.accuracyM, address: (await reverse(f.lat, f.lon)) || undefined, note: f.note }
}

const fmtM = (m: number): string => (m < 1000 ? m + ' m' : (m / 1000).toFixed(1) + ' km')

export function addPlaceTools(defs: OpenAI.Chat.ChatCompletionTool[], handlers: Map<string, (a: Record<string, unknown>) => Promise<string>>): void {
  defs.push({
    type: 'function',
    function: {
      name: 'get_location',
      description: "Get the user's current location (phone GPS if linked, else Windows location service, else IP). Returns coordinates, accuracy, source and the nearest address.",
      parameters: { type: 'object', properties: {} }
    }
  })
  handlers.set('get_location', async () => {
    if (!getPrefs().locationEnabled) return 'Error: location tools are switched off. Tell the user to enable them in Settings > General > Location.'
    const f = await getFix()
    if (!f) return 'Error: could not determine the location (Windows location services are off or unavailable and the IP lookup failed). Ask the user for a city or neighbourhood instead.'
    const addr = await reverse(f.lat, f.lon)
    const src = f.source === 'phone-gps' ? 'phone GPS' : f.source === 'windows-wifi' ? 'Windows location service (Wi-Fi based)' : 'IP address'
    return JSON.stringify({ lat: f.lat, lon: f.lon, accuracy_m: f.accuracyM, source: src, address: addr || undefined, warning: f.note })
  })

  defs.push({
    type: 'function',
    function: {
      name: 'nearby_places',
      description: 'Find places near a point using OpenStreetMap (free). Pass a category or name such as "restaurant", "pharmacy", "مطعم", "صيدلية". Uses the user\'s location when lat/lon are omitted. Returns name, distance, coordinates, and opening hours/phone when OSM has them.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, radius_m: { type: 'number', description: 'default 1500, max 10000' }, lat: { type: 'number' }, lon: { type: 'number' } },
        required: ['query']
      }
    }
  })
  handlers.set('nearby_places', async (a) => {
    if (!getPrefs().locationEnabled) return 'Error: location tools are switched off. Tell the user to enable them in Settings > General > Location.'
    const query = String(a.query ?? '').trim()
    if (!query) return 'Error: query is required'
    let lat = Number(a.lat)
    let lon = Number(a.lon)
    let srcNote = 'coordinates given by the model'
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const f = await getFix()
      if (!f) return 'Error: could not determine the location. Ask the user for the area.'
      lat = f.lat
      lon = f.lon
      srcNote = f.source + (f.accuracyM ? ` (~${f.accuracyM} m)` : '')
    }
    const radius = Math.min(Math.max(Number(a.radius_m) || 1500, 200), 10000)
    try {
      const cat = CATS.find((c) => c.re.test(query))
      let places = cat ? await overpass(lat, lon, radius, cat.tags) : []
      if (!places.length) places = await nominatimSearch(query, lat, lon)
      if (!places.length) return `No places found for "${query}" within ${radius} m of ${lat.toFixed(4)},${lon.toFixed(4)} in OpenStreetMap. Try a bigger radius or a web search.`
      const lines = places.slice(0, 10).map((p, i) => `${i + 1}. ${p.name} — ${fmtM(p.meters)} — ${p.lat.toFixed(5)},${p.lon.toFixed(5)}${p.hours ? ' — hours: ' + p.hours : ''}${p.phone ? ' — ' + p.phone : ''}`)
      return `Source: OpenStreetMap (data may be incomplete; verify opening hours). Search centre from ${srcNote}.\n` + lines.join('\n')
    } catch (e) {
      return 'Error: OpenStreetMap lookup failed: ' + (e instanceof Error ? e.message : String(e))
    }
  })
}
