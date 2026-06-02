import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {LoadedEventWithNotifMeta} from './models/activity-service'
import {getCommentTargetId} from './utils/entity-id-url'

/** Comment feed event enriched with notification metadata. */
export type LoadedCommentFeedEvent = Extract<LoadedEventWithNotifMeta, {type: 'comment'}>

/** Grouped discussion derived from comment-only activity feed events. */
export interface GroupedCommentFeedDiscussion {
  /** Stable discussion key: true thread root comment ID, or the comment itself for top-level comments. */
  threadRootId: string
  /** Version of the thread root comment when known from the feed event payload. */
  threadRootVersion?: string
  /** Target document for the discussion thread. */
  targetId: UnpackedHypermediaId
  /** Newest activity timestamp seen anywhere in the thread. */
  latestEventAtMs: number
  /** Number of feed comment events collapsed into this discussion. */
  eventCount: number
  /** Feed event for the true root comment when it is present in fetched pages. */
  rootCommentEvent: LoadedCommentFeedEvent | null
  /** Newest comment event in the thread, including replies. */
  latestCommentEvent: LoadedCommentFeedEvent
  /** Newest reply event in the thread, excluding the root comment itself. */
  latestReplyEvent: LoadedCommentFeedEvent | null
}

/**
 * Collapses comment-only activity feed events into discussion threads.
 *
 * Non-comment events, comment events without a resolvable target document, and
 * malformed comment payloads are ignored.
 */
export function groupCommentFeedEvents(events: LoadedEventWithNotifMeta[]): GroupedCommentFeedDiscussion[] {
  const groups = new Map<string, GroupedCommentFeedDiscussion>()

  events.forEach((event) => {
    if (event.type !== 'comment' || !event.comment) return

    const targetId = event.target?.id || getCommentTargetId(event.comment)
    if (!targetId) return

    const threadRootId = event.comment.threadRoot || event.comment.id
    const threadRootVersion =
      event.comment.threadRootVersion || (threadRootId === event.comment.id ? event.comment.version : undefined)
    const existing = groups.get(threadRootId)

    if (!existing) {
      groups.set(threadRootId, {
        threadRootId,
        threadRootVersion,
        targetId,
        latestEventAtMs: event.eventAtMs,
        eventCount: 1,
        rootCommentEvent: event.comment.id === threadRootId ? event : null,
        latestCommentEvent: event,
        latestReplyEvent: event.comment.id === threadRootId ? null : event,
      })
      return
    }

    existing.eventCount += 1
    if (!existing.threadRootVersion && threadRootVersion) {
      existing.threadRootVersion = threadRootVersion
    }
    if (!existing.rootCommentEvent && event.comment.id === threadRootId) {
      existing.rootCommentEvent = event
    }
    if (event.eventAtMs > existing.latestEventAtMs) {
      existing.latestEventAtMs = event.eventAtMs
      existing.latestCommentEvent = event
    }
    if (event.comment.id !== threadRootId) {
      if (!existing.latestReplyEvent || event.eventAtMs > existing.latestReplyEvent.eventAtMs) {
        existing.latestReplyEvent = event
      }
    }
  })

  return Array.from(groups.values()).sort((a, b) => b.latestEventAtMs - a.latestEventAtMs)
}
