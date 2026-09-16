import type {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

/**
 * The document version a new comment should pin.
 *
 * The route id is not always pinned to a version: a republish keeps its own
 * (unpinned) address while rendering the target document, so the resolved
 * resource is the source of truth and the id's version is only a fallback.
 * Mirrors the desktop comment editor.
 */
export function resolveCommentTargetVersion(
  docId: UnpackedHypermediaId,
  resource: HMResource | null | undefined,
): string | undefined {
  const resolvedVersion = resource?.type === 'document' ? resource.document.version : undefined
  return resolvedVersion || docId.version || undefined
}
