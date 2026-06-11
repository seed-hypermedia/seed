/** Utilities for web-only document draft placeholder paths. */

/** Return the local draft id encoded by a placeholder segment like `-abc123`. */
export function getWebDraftPlaceholderIdFromSegment(segment: string | null | undefined): string | null {
  if (!segment?.startsWith('-')) return null
  const privatePrefix = '-private-'
  const draftId = segment.startsWith(privatePrefix) ? segment.slice(privatePrefix.length) : segment.slice(1)
  return draftId.length > 0 ? draftId : null
}

/** Return the local draft id encoded by a placeholder path's final segment. */
export function getWebDraftPlaceholderId(path: string[] | null | undefined): string | null {
  return getWebDraftPlaceholderIdFromSegment(path?.at(-1))
}

/** Return true when the path points at a web local draft placeholder. */
export function isWebDraftPlaceholderPath(path: string[] | null | undefined, draftId?: string | null): boolean {
  const placeholderDraftId = getWebDraftPlaceholderId(path)
  if (!placeholderDraftId) return false
  return draftId ? placeholderDraftId === draftId : true
}

/** Return true when the route points at a private draft placeholder. */
export function isWebPrivateDraftPlaceholderPath(path: string[] | null | undefined): boolean {
  return !!path?.at(-1)?.startsWith('-private-')
}

/** Return true when the route should avoid fetching a placeholder draft from the backend. */
export function shouldBypassServerDocumentFetchForWebDraftPath({
  path,
  isInspect,
  version,
}: {
  path: string[] | null | undefined
  isInspect: boolean
  version: string | null | undefined
}): boolean {
  return !isInspect && !version && isWebDraftPlaceholderPath(path)
}
