import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {DocumentPanelRoute} from '@shm/shared/routes'
import {activityFilterToSlug} from '@shm/shared/utils/entity-id-url'
import {Feed, type DraftVersionEntry} from './feed'

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
  return (
    <Feed
      size={size}
      filterResource={docId.id}
      filterEventType={[...DOCUMENT_VERSION_EVENT_TYPES]}
      targetDomain={targetDomain}
      draftVersionEntry={draftVersionEntry}
    />
  )
}
