type Sink = (text: string) => void
type StreamSink = (kind: 'chunk' | 'reset', text?: string) => void
let sink: Sink | null = null
let streamSink: StreamSink | null = null
let ctl: AbortController | null = null

// Live status line for the UI (set by the chat handler for the duration of one request).
export const setProgressSink = (s: Sink | null): void => {
  sink = s
}
export const emitProgress = (text: string): void => {
  try {
    sink?.(text)
  } catch {
    /* renderer gone */
  }
}
export const setStreamSink = (s: StreamSink | null): void => {
  streamSink = s
}
export const emitStream = (kind: 'chunk' | 'reset', text?: string): void => {
  try {
    streamSink?.(kind, text)
  } catch {
    /* renderer gone */
  }
}

// One cancellable run at a time.
export const beginRun = (): AbortSignal => {
  ctl = new AbortController()
  return ctl.signal
}
export const cancelRun = (): void => ctl?.abort()
export const currentSignal = (): AbortSignal | undefined => ctl?.signal
