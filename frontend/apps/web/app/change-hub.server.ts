import {createActivityCursor, extractResource} from '@shm/shared/activity-changes'
import {createChangeHub} from '@shm/shared/change-signal'
import {grpcClient} from './client.server'

/**
 * Most change streams this process holds open. Each is one idle socket and a few map entries, so
 * the limit is about refusing a flood cleanly rather than about memory; browsers past it fall
 * back to slow polling. Override with SEED_CHANGE_STREAM_MAX.
 */
const MAX_CHANGE_STREAMS = Number(process.env.SEED_CHANGE_STREAM_MAX) || 2_000

// One poll walks back at most this many feed pages; a burst larger than that (a big sync) is
// reported as a resync instead of being read page by page while the node is busy.
const MAX_FEED_PAGES = 10

let lastErrorLoggedAt = 0

/**
 * The one follower of the node's activity feed for every browser connected to this process. It
 * polls only while a stream is open, as the server itself and not as any viewer: a signal carries
 * no content, so each browser still reads through its own access.
 */
export const changeHub = createChangeHub({
  maxListeners: MAX_CHANGE_STREAMS,
  follow: () => {
    // A fresh cursor per run: after an idle stretch the feed is followed from now, not caught up.
    const cursor = createActivityCursor((request) => grpcClient.activityFeed.listEvents(request), {
      replayMs: 5_000,
      maxPages: MAX_FEED_PAGES,
    })
    return async () => {
      const {events, truncated} = await cursor.poll()
      const resources: string[] = []
      for (const event of events) {
        const resource = extractResource(event)
        if (resource) resources.push(resource)
      }
      return {resources, truncated}
    }
  },
  onError: (error) => {
    const now = Date.now()
    if (now - lastErrorLoggedAt < 60_000) return
    lastErrorLoggedAt = now
    console.error('Change stream: activity feed poll failed', error)
  },
})
