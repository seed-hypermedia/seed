import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, pathMatches} from '@shm/shared'
import {isDraftPathSegment} from '@shm/shared/utils/breadcrumbs'

/** Minimal draft fields needed to resolve the document route that opens a draft. */
export type DraftRouteFields = {
  id: string
  editUid?: string
  editPath?: string[]
  locationUid?: string
  locationPath?: string[]
}

function locationOnlyDraftPath(draft: DraftRouteFields): string[] {
  const locationPath = draft.locationPath ?? []
  if (locationPath.at(-1) === `-${draft.id}`) return locationPath
  return [...locationPath, `-${draft.id}`]
}

/** Return the document route used to open a draft in the unified editor. */
export function draftDocumentRouteId(draft: DraftRouteFields): UnpackedHypermediaId | undefined {
  const uid = draft.editUid || draft.locationUid
  if (!uid) return undefined
  const path = draft.editUid ? draft.editPath : locationOnlyDraftPath(draft)
  return hmId(uid, {path})
}

/** Return true when a document route is the private placeholder for a location-only draft. */
export function isLocationOnlyDraftRoute(id: UnpackedHypermediaId, draft: DraftRouteFields): boolean {
  if (draft.editUid || !draft.locationUid) return false
  if (id.uid !== draft.locationUid) return false
  const path = id.path ?? []
  return pathMatches(path, locationOnlyDraftPath(draft))
}

/** Return true when a document route opens the given draft. */
export function isDraftDocumentRoute(id: UnpackedHypermediaId, draft: DraftRouteFields): boolean {
  if (draft.editUid) {
    return id.uid === draft.editUid && pathMatches(draft.editPath ?? [], id.path)
  }
  return isLocationOnlyDraftRoute(id, draft)
}

/**
 * Return the published document id to fetch for a document route, or null when
 * the route is a local draft placeholder that intentionally has no published
 * document yet.
 */
export function getPublishedResourceIdForDraftRoute(
  id: UnpackedHypermediaId,
  draft: DraftRouteFields | false | null | undefined,
): UnpackedHypermediaId | null {
  if (isDraftPathSegment(id.path?.at(-1))) return null
  if (draft && draft.locationUid && !draft.editUid) return null
  return id
}
