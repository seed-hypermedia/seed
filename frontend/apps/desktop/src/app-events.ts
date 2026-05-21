import {observable} from '@trpc/server/observable'
import {grpcClient} from '@/grpc-client'
import * as log from './logger'
import {t} from './app-trpc'

type ReactiveEvent = {
  topic: string
  hint?: unknown
}

const POLL_INTERVAL_MS = 1500

const emitters = new Set<(e: ReactiveEvent) => void>()
const fingerprintByTopic = new Map<string, string>()

type TopicFetcher = () => Promise<string>

const topicFetchers: Record<string, TopicFetcher> = {
  LIBRARY: async () => {
    const res = await grpcClient.documents.listDocuments({pageSize: 100_000})
    const ids = res.documents
      .map((d) => `${d.account}/${d.path}@${d.version}`)
      .sort()
      .join('|')
    return `${res.documents.length}:${hashString(ids)}`
  },
}

function hashString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

let pollTimer: NodeJS.Timeout | null = null

async function pollAll(): Promise<void> {
  if (emitters.size === 0) return
  for (const [topic, fetcher] of Object.entries(topicFetchers)) {
    try {
      const fp = await fetcher()
      const prev = fingerprintByTopic.get(topic)
      if (prev !== fp) {
        fingerprintByTopic.set(topic, fp)
        if (prev !== undefined) {
          broadcast({topic})
        }
      }
    } catch (error: unknown) {
      const e = error as Error
      log.error(`[ReactiveEvents] poll failed for topic=${topic}: ${e.message}`)
    }
  }
}

function broadcast(event: ReactiveEvent): void {
  emitters.forEach((emit) => emit(event))
}

/**
 * Broadcast a reactive event from anywhere in the main process. Renderers
 * subscribed via `events.watch` receive the event on the renderer-side
 * reactive bus.
 */
export function broadcastReactiveEvent(event: ReactiveEvent): void {
  broadcast(event)
}

function ensurePoller(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    void pollAll()
  }, POLL_INTERVAL_MS)
  void pollAll()
}

function stopPollerIfIdle(): void {
  if (emitters.size === 0 && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export const eventsApi = t.router({
  watch: t.procedure.subscription(() => {
    return observable<ReactiveEvent>((emit) => {
      const handler = (e: ReactiveEvent) => emit.next(e)
      emitters.add(handler)
      ensurePoller()
      return () => {
        emitters.delete(handler)
        stopPollerIfIdle()
      }
    })
  }),
})
