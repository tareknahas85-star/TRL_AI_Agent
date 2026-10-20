import { AsyncLocalStorage } from 'async_hooks'
import { EventEmitter } from 'events'

type Sink = (text: string) => void
type StreamSink = (kind: 'chunk' | 'reset', text?: string) => void

// How the user wants this run to pick models: free chain only, free+paid chain, or one explicit model.
export type RunMode = { kind: 'free' } | { kind: 'auto' } | { kind: 'council'; author?: string; critic?: string } | { kind: 'model'; id: string }

type Ctx = { progress: Sink; stream: StreamSink; ctl: AbortController; mode: RunMode; muted?: boolean; unattended?: boolean }

// Every chat request runs inside its own async context, so several tabs can work in parallel
// without sharing progress/stream sinks, cancel signals or the model mode.
const als = new AsyncLocalStorage<Ctx>()
const runs = new Map<string, AbortController>()

// Live view of what is running (for the phone's task monitor): started time + last progress line per tab.
type RunInfo = { tabId: string; started: number; last: string }
const info = new Map<string, RunInfo>()
export const runHub = new EventEmitter()
export const listRuns = (): RunInfo[] => [...info.values()]

export function runInContext<T>(tabId: string, mode: RunMode, progress: Sink, stream: StreamSink, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  runs.get(tabId)?.abort()
  const ctl = new AbortController()
  runs.set(tabId, ctl)
  const ri: RunInfo = { tabId, started: Date.now(), last: '' }
  info.set(tabId, ri)
  runHub.emit('change')
  const tracked: Sink = (t) => {
    ri.last = t.replace(/^\u27e6[^\u27e7]*\u27e7\s*/, '')
    runHub.emit('change')
    progress(t)
  }
  return als.run({ progress: tracked, stream, ctl, mode, unattended: tabId.startsWith('sched-') }, () => fn(ctl.signal)).finally(() => {
    if (runs.get(tabId) === ctl) runs.delete(tabId)
    if (info.get(tabId) === ri) info.delete(tabId)
    runHub.emit('change')
  })
}

/** 5.15.0: نشاط موسوم بنموذج/دور عشان اللوحة الحية تعرض مين عم يعمل شو. الصيغة: ⟦engine|role⟧ text */
export const emitAgent = (engine: string, role: string, text: string): void => emitProgress('\u27e6' + engine + '|' + role + '\u27e7 ' + text)
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
export const isUnattended = (): boolean => !!als.getStore()?.unattended
export const currentMode = (): RunMode | undefined => als.getStore()?.mode