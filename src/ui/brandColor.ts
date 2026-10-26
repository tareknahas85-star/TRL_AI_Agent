import { brandOf } from '../core/brands'

/** Brand colour for a model name in the UI; very dark brand colours (invisible on a dark theme) fall back to the normal text colour. */
export function nameColor(model: string | undefined | null): string | undefined {
  const c = brandOf(model)?.color
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return undefined
  const n = parseInt(c.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum < 0.28 ? undefined : c
}