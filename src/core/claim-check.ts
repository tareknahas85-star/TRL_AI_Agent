import { claimedPorts } from './reply-quality'

// تحقق فعلي (بدون موديل): هل في سيرفر شغّال على البورتات يلي الرد ذكرها؟ بيرجّع البورتات المسكّرة.
export async function deadClaimedPorts(text: string): Promise<number[]> {
  const dead: number[] = []
  for (const port of claimedPorts(text)) {
    let alive = false
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 3000)
      try {
        const res = await fetch('http://' + host + ':' + port + '/', { signal: ctl.signal })
        if (res.status < 500) alive = true
      } catch {
        /* try next host */
      } finally {
        clearTimeout(timer)
      }
      if (alive) break
    }
    if (!alive) dead.push(port)
  }
  return dead
}