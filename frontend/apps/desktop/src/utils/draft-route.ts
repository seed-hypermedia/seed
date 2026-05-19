import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, pathMatches} from '@shm/shared'

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
