import {HMDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, NavRoute} from '@shm/shared'
import {getDraftIdFromDraftPathSegment, isDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {useDraft} from '@/models/accounts'
import {isDraftDocumentRoute} from '@/utils/draft-route'
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
  const lastPathSegment = id?.path?.at(-1)
  const placeholderDraftId = getDraftIdFromDraftPathSegment(lastPathSegment) ?? undefined
  const placeholderDraft = useDraft(placeholderDraftId)

  const listDraft = drafts.data?.find((d) => {
    if (!id) return false
    return isDraftDocumentRoute(id, d)
  })
  const directDraft =
    id && placeholderDraft.data && isDraftDocumentRoute(id, placeholderDraft.data) ? placeholderDraft.data : null
  const existingDraft = listDraft || directDraft

  if (!id) return false
  // While drafts are loading, return undefined so the machine waits.
  // Once loaded, return the matching draft or false (no draft).
  if (existingDraft) return existingDraft
  if (!drafts.data) return undefined
  if (placeholderDraftId && (placeholderDraft.isLoading || placeholderDraft.isFetching)) {
    return undefined
  }
  return false
}

function getRouteResourceId(route: NavRoute): UnpackedHypermediaId | null {
  if (route.key === 'document') return route.id
  if (route.key === 'directory') return route.id
  if (route.key === 'comments') return route.id
  if (route.key === 'activity') return route.id
  if (route.key === 'collaborators') return route.id
  if (route.key === 'metadata') return route.id
  return null
}
