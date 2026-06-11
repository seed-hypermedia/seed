import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getDraftIdFromDraftPathSegment, isPrivateDraftPathSegment} from './breadcrumbs'

const reservedLazyDraftIds = new Set<string>()
const draftReturnParentIds = new Map<string, UnpackedHypermediaId>()

/** Remember that a draft ID was preallocated for a lazy draft route. */
export function rememberReservedLazyDraftId(draftId: string | null | undefined) {
  if (draftId) reservedLazyDraftIds.add(draftId)
}

/** Return true when the draft ID was preallocated for a lazy draft route. */
export function isReservedLazyDraftId(draftId: string | null | undefined) {
  return !!draftId && reservedLazyDraftIds.has(draftId)
}

/** Remember where a new draft should return if discarded before publish. */
export function rememberDraftReturnParentId(
  draftId: string | null | undefined,
  parentId: UnpackedHypermediaId | null | undefined,
) {
  if (draftId && parentId) draftReturnParentIds.set(draftId, parentId)
}

/** Return the parent route remembered for a new draft, if any. */
export function getDraftReturnParentId(draftId: string | null | undefined) {
  return draftId ? draftReturnParentIds.get(draftId) ?? null : null
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
