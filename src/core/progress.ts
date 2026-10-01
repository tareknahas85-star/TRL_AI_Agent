import { AsyncLocalStorage } from 'async_hooks'

type Sink = (text: string) => void
type StreamSink = (kind: 'chunk' | 'reset', text?: string) => void

// How the user wants this run to pick models: free chain only, free+paid chain, or one explicit model.
export type RunMode = { kind: 'free' } | { kind: 'auto' } | { kind: 'council' } | { kind: 'model'; id: string }

type Ctx = { progress: Sink; stream: StreamSink; ctl: AbortController; mode: RunMode; muted?: boolean }

// Every chat request runs inside its own async context, so several tabs can work in parallel
// without sharing progress/stream sinks, cancel signals or the model mode.
const als = new AsyncLocalStorage<Ctx>()
const runs = new Map<string, AbortController>()

export function runInContext<T>(tabId: string, mode: RunMode, progress: Sink, stream: StreamSink, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  runs.get(tabId)?.abort()
  const ctl = new AbortController()
  runs.set(tabId, ctl)
  return als.run({ progress, stream, ctl, mode }, () => fn(ctl.signal)).finally(() => {
    if (runs.get(tabId) === ctl) runs.delete(tabId)
  })
}

export const emitProgress = (text: string): void => {
  try {
    als.getStore()?.progress(text)
  } catch {
    /* renderer gone */
  }
}
// While muted (council critique/revision steps) model output is not streamed into the chat bubble.
export const setStreamMuted = (on: boolean): void => {
  const c = als.getStore()
  if (c) c.muted = on
}
export const emitStream = (kind: 'chunk' | 'reset', text?: string): void => {
  try {
    const c = als.getStore()
    if (c && !c.muted) c.stream(kind, text)
  } catch {
    /* renderer gone */
  }
}
export const cancelRun = (tabId: string): void => runs.get(tabId)?.abort()
export const currentSignal = (): AbortSignal | undefined => als.getStore()?.ctl.signal
export const currentMode = (): RunMode | undefined => als.getStore()?.mode