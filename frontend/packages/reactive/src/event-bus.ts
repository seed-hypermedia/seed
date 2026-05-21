export type ReactiveEvent = {
  topic: string
  hint?: unknown
}

type Listener = (event: ReactiveEvent) => void

const listenersByTopic = new Map<string, Set<Listener>>()
const wildcardListeners = new Set<Listener>()

function getOrCreate(topic: string): Set<Listener> {
  let set = listenersByTopic.get(topic)
  if (!set) {
    set = new Set()
    listenersByTopic.set(topic, set)
  }
  return set
}

export function dispatch(event: ReactiveEvent): void {
  const exact = listenersByTopic.get(event.topic)
  if (exact) exact.forEach((l) => l(event))
  wildcardListeners.forEach((l) => l(event))
}

export function onEvent(topic: string, listener: Listener): () => void {
  if (topic === '*') {
    wildcardListeners.add(listener)
    return () => {
      wildcardListeners.delete(listener)
    }
  }
  const set = getOrCreate(topic)
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listenersByTopic.delete(topic)
  }
}

export function listSubscribedTopics(): string[] {
  return Array.from(listenersByTopic.keys())
}

export function resetEventBus(): void {
  listenersByTopic.clear()
  wildcardListeners.clear()
}
