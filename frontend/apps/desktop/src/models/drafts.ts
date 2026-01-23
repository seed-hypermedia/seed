import {
  HMDraft,
  hmId,
  NavRoute,
  pathMatches,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useAccountDraftList} from './documents'

export function draftLocationId(draft: HMDraft | null | undefined) {
  if (!draft) return undefined
  if (draft.locationUid) {
    return hmId(draft.locationUid, {
      path: draft.locationPath,
    })
  }
  return undefined
}

export function draftEditId(draft: HMDraft | null | undefined) {
  if (!draft) return undefined
  if (draft.editUid) {
    return hmId(draft.editUid, {
      path: draft.editPath,
    })
  }
  return undefined
}

export function useExistingDraft(route: NavRoute) {
  const id = getRouteResourceId(route)
  const drafts = useAccountDraftList(id?.uid)
  if (!id) return false
  const existingDraft = drafts.data?.find((d) => {
    // @ts-expect-error
    const id = d.editId
    if (!id) return false
    return id.uid === id.uid && pathMatches(id.path, id.path)
  })
  return existingDraft
}

function getRouteResourceId(route: NavRoute): UnpackedHypermediaId | null {
  if (route.key === 'document') return route.id
  if (route.key === 'directory') return route.id
  if (route.key === 'discussions') return route.id
  if (route.key === 'activity') return route.id
  if (route.key === 'collaborators') return route.id
  return null
}
