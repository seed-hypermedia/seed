import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useRawResource} from '@shm/shared/models/entity'
import type {DocumentPanelRoute} from '@shm/shared/routes'
import {activityFilterToSlug, hmId} from '@shm/shared/utils/entity-id-url'
import {Feed, type DraftVersionEntry} from './feed'
import {Spinner} from './spinner'

/** Activity event types that represent document version updates. */
export const DOCUMENT_VERSION_EVENT_TYPES = ['Ref'] as const

/** Builds the canonical side-panel route for document versions. */
export function createDocumentVersionsPanelRoute(
  docId: UnpackedHypermediaId,
): Extract<DocumentPanelRoute, {key: 'activity'}> {
  return {
    key: 'activity',
    id: docId,
    filterEventType: [...DOCUMENT_VERSION_EVENT_TYPES],
  }
}

/** Returns true when a document panel route is the canonical versions panel route. */
export function isDocumentVersionsPanelRoute(route: DocumentPanelRoute | null | undefined): boolean {
  return route?.key === 'activity' && activityFilterToSlug(route.filterEventType) === 'versions'
}

/**
 * The address whose version history the panel lists.
 *
 * A republish is a redirect Ref at the site's own address; its content, and so its
 * versions, live at the redirect target. The activity feed filters events by exact
 * address, so filtering by the republish's address lists nothing. Resolve that one hop
 * here. Every other address is used as-is, including a move's old address, whose
 * history the feed already joins server-side.
 */
export function useVersionsFeedId(docId: UnpackedHypermediaId): {
  feedId: UnpackedHypermediaId
  isResolving: boolean
} {
  // The raw lookup is unpinned: a version on the route belongs to the content, not the Ref.
  const raw = useRawResource(hmId(docId.uid, {path: docId.path}))
  const data = raw.data
  const feedId = data?.type === 'redirect' && data.republish ? data.redirectTarget : docId
  return {feedId, isResolving: raw.isLoading}
}

/** Shared Versions panel UI used by both web and desktop apps. */
export function DocumentVersionsPanel({
  docId,
  targetDomain,
  size = 'sm',
  draftVersionEntry,
}: {
  docId: UnpackedHypermediaId
  targetDomain?: string
  size?: 'sm' | 'md'
  draftVersionEntry?: DraftVersionEntry
}) {
  const {feedId, isResolving} = useVersionsFeedId(docId)
  if (isResolving) {
    // An unfiltered Feed lists every event on the node, so wait for the address.
    return (
      <div className="flex items-center justify-center p-3">
        <Spinner />
      </div>
    )
  }
  return (
    <Feed
      size={size}
      filterResource={feedId.id}
      filterEventType={[...DOCUMENT_VERSION_EVENT_TYPES]}
      targetDomain={targetDomain}
      draftVersionEntry={draftVersionEntry}
    />
  )
}
