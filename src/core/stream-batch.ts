// F30: groups streamed tokens into fewer IPC messages (one flush per window, not one per token).
// Order is kept: a 'reset' drops the pending text first, so text from a failed attempt never reaches the UI.

export type StreamSend = (kind: 'chunk' | 'reset', text?: string) => void

export function createStreamBatcher(send: StreamSend, delayMs = 50) {
  let buf = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  // Sends whatever is pending as one chunk. Call it before a run resolves so no text arrives after the final result.
  const flush = (): void => {
    clear()
    if (!buf) return
    const t = buf
    buf = ''
    send('chunk', t)
  }

  return {
    chunk(text: string): void {
      if (!text) return
      buf += text
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    reset(): void {
      clear()
      buf = ''
      send('reset')
    },
    flush
  }
}
