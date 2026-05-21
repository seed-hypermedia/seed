import {eventStream, writeableStateStream, StateStream} from '@shm/shared/utils/stream'
import {onEvent, ReactiveEvent} from './event-bus'

export type NodeDef<T> = {
  key: string
  topics: readonly string[]
  fetcher: () => Promise<T>
  equals?: (a: T, b: T) => boolean
}

type NodeState<T> =
  | {status: 'idle'; value?: undefined; error?: undefined}
  | {status: 'loading'; value?: T; error?: undefined}
  | {status: 'success'; value: T; error?: undefined}
  | {status: 'error'; value?: T; error: unknown}

type NodeRecord<T> = {
  def: NodeDef<T>
  state: NodeState<T>
  subscribers: number
  dirty: boolean
  unsubTopics: Array<() => void>
  inflight: Promise<void> | null
  setState: (s: NodeState<T>) => void
  stream: StateStream<NodeState<T>>
}

const registry = new Map<string, NodeRecord<unknown>>()
const dirtyQueue = new Set<NodeRecord<unknown>>()
let tickScheduled = false

const [emitTickFinished, tickFinishedStream] = eventStream<void>()
export const onTickFinished = tickFinishedStream.subscribe

function scheduleTick(): void {
  if (tickScheduled) return
  tickScheduled = true
  queueMicrotask(runTick)
}

async function runTick(): Promise<void> {
  tickScheduled = false
  const batch = Array.from(dirtyQueue)
  dirtyQueue.clear()
  await Promise.all(batch.map((rec) => refreshNode(rec)))
  emitTickFinished()
}

async function refreshNode<T>(rec: NodeRecord<T>): Promise<void> {
  if (rec.inflight) return rec.inflight
  rec.dirty = false
  const prev = rec.state
  rec.setState({status: 'loading', value: prev.status === 'success' ? prev.value : undefined})
  const p = (async () => {
    try {
      const value = await rec.def.fetcher()
      const eq = rec.def.equals
      if (eq && prev.status === 'success' && eq(prev.value, value)) {
        rec.setState(prev)
      } else {
        rec.setState({status: 'success', value})
      }
    } catch (error) {
      rec.setState({status: 'error', value: prev.status === 'success' ? prev.value : undefined, error})
    } finally {
      rec.inflight = null
    }
  })()
  rec.inflight = p
  return p
}

function getOrCreate<T>(def: NodeDef<T>): NodeRecord<T> {
  const existing = registry.get(def.key) as NodeRecord<T> | undefined
  if (existing) return existing
  const [setState, stream] = writeableStateStream<NodeState<T>>({status: 'idle'})
  const rec: NodeRecord<T> = {
    def,
    state: {status: 'idle'},
    subscribers: 0,
    dirty: false,
    unsubTopics: [],
    inflight: null,
    setState: (s) => {
      rec.state = s
      setState(s)
    },
    stream,
  }
  registry.set(def.key, rec as NodeRecord<unknown>)
  return rec
}

export function acquireNode<T>(def: NodeDef<T>): {
  state: StateStream<NodeState<T>>
  release: () => void
  refresh: () => void
} {
  const rec = getOrCreate(def)
  rec.subscribers += 1
  if (rec.subscribers === 1) {
    const handler = (_e: ReactiveEvent) => {
      rec.dirty = true
      dirtyQueue.add(rec as NodeRecord<unknown>)
      scheduleTick()
    }
    for (const topic of def.topics) {
      rec.unsubTopics.push(onEvent(topic, handler))
    }
    if (rec.state.status === 'idle') {
      dirtyQueue.add(rec as NodeRecord<unknown>)
      scheduleTick()
    }
  }
  return {
    state: rec.stream,
    refresh: () => {
      dirtyQueue.add(rec as NodeRecord<unknown>)
      scheduleTick()
    },
    release: () => {
      rec.subscribers -= 1
      if (rec.subscribers <= 0) {
        rec.subscribers = 0
        rec.unsubTopics.forEach((u) => u())
        rec.unsubTopics = []
      }
    },
  }
}

export function resetRegistry(): void {
  registry.forEach((rec: NodeRecord<unknown>) => {
    rec.unsubTopics.forEach((u: () => void) => u())
  })
  registry.clear()
  dirtyQueue.clear()
  tickScheduled = false
}

export type {NodeState}
