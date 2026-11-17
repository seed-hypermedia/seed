/**
 * Reading "what changed" off the daemon's activity feed. The desktop main process and the web
 * server both follow the feed this way; each then tells its own windows or browsers.
 */

import type {PartialMessage} from '@bufbuild/protobuf'
import {
  FeedOrder,
  type Event,
  type ListEventsRequest,
  type ListEventsResponse,
} from './client/.generated/activity/v1alpha/activity_pb'

/** Blob-only event types — excludes mentions (link types like comment/target, doc/embed). */
export const ACTIVITY_BLOB_TYPES = ['Capability', 'Ref', 'Comment', 'DagPB', 'Profile', 'Contact']

/** Page size for fetching activity events. */
export const ACTIVITY_PAGE_SIZE = 30

type ListEvents = (request: PartialMessage<ListEventsRequest>) => Promise<ListEventsResponse>

/** Extracts the resource IRI from a newBlob activity event. */
export function extractResource(event: Event): string | null {
  if (event.data.case === 'newBlob') {
    const resource = event.data.value.resource
    return resource.split('?')[0] || null
  }
  return null
}

/** Extract blobId from a newBlob event. Returns 0 for non-blob events. */
export function getBlobId(event: Event): bigint {
  if (event.data.case === 'newBlob') return event.data.value.blobId
  return BigInt(0)
}

/** When the node received the event, in epoch milliseconds; 0 when the feed did not say. */
function observedAt(event: Event): number {
  const time = event.observeTime
  return time ? Number(time.seconds) * 1000 + Math.floor(time.nanos / 1e6) : 0
}

/**
 * Follows the feed from "now": each `poll` returns the blob events that arrived since the last
 * one, newest first.
 *
 * The first poll only sets the watermark, so the existing feed is not replayed; `replayMs` makes
 * it also return events the node received that recently, for a caller whose readers looked at the
 * data just before it began following. `maxPages` bounds how far one poll walks back; a poll that
 * hits it reports `truncated`, since older events were skipped.
 */
export function createActivityCursor(
  listEvents: ListEvents,
  options: {replayMs?: number; maxPages?: number; now?: () => number} = {},
) {
  const {replayMs = 0, maxPages = Infinity, now = Date.now} = options
  // Null until the first poll sets the watermark.
  let lastBlobId: bigint | null = null

  return {
    async poll(): Promise<{events: Event[]; truncated: boolean}> {
      if (lastBlobId === null) {
        const response = await listEvents({
          pageSize: replayMs > 0 ? ACTIVITY_PAGE_SIZE : 1,
          filterEventType: ACTIVITY_BLOB_TYPES,
          order: FeedOrder.OBSERVED_TIME,
        })
        const firstEvent = response.events[0]
        // An empty feed (fresh database) gets watermark 0 so the first events that arrive are processed.
        lastBlobId = firstEvent ? getBlobId(firstEvent) : BigInt(0)
        if (replayMs <= 0) return {events: [], truncated: false}
        const since = now() - replayMs
        return {events: response.events.filter((event) => observedAt(event) >= since), truncated: false}
      }

      const events: Event[] = []
      let pageToken: string | undefined
      let truncated = false

      for (let page = 0; ; page++) {
        if (page >= maxPages) {
          truncated = true
          break
        }
        const response = await listEvents({
          pageToken,
          pageSize: ACTIVITY_PAGE_SIZE,
          filterEventType: ACTIVITY_BLOB_TYPES,
          order: FeedOrder.OBSERVED_TIME,
        })

        let reachedWatermark = false
        for (const event of response.events) {
          if (getBlobId(event) <= lastBlobId) {
            reachedWatermark = true
            break
          }
          events.push(event)
        }

        if (reachedWatermark) break
        if (!response.nextPageToken) break
        pageToken = response.nextPageToken
      }

      if (events.length > 0) lastBlobId = getBlobId(events[0]!)
      return {events, truncated}
    },
  }
}
