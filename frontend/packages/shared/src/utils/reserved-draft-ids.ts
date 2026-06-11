import {getDraftIdFromDraftPathSegment, isPrivateDraftPathSegment} from './breadcrumbs'

const reservedLazyDraftIds = new Set<string>()

/** Remember that a draft ID was preallocated for a lazy draft route. */
export function rememberReservedLazyDraftId(draftId: string | null | undefined) {
  if (draftId) reservedLazyDraftIds.add(draftId)
}

/** Return true when the draft ID was preallocated for a lazy draft route. */
export function isReservedLazyDraftId(draftId: string | null | undefined) {
  return !!draftId && reservedLazyDraftIds.has(draftId)
}

/** Return the stable breadcrumb label for a preallocated draft path segment, if known. */
export function getReservedLazyDraftBreadcrumbName(
  segment: string | null | undefined,
  activeReservedDraftId?: string | null,
) {
  const draftId = getDraftIdFromDraftPathSegment(segment)
  if (!draftId || (draftId !== activeReservedDraftId && !isReservedLazyDraftId(draftId))) return null
  return isPrivateDraftPathSegment(segment) ? 'New Private Document' : 'New Document'
}
