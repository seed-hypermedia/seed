import {HMDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, NavRoute, pathMatches} from '@shm/shared'
import {getDraftIdFromDraftPathSegment, isDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {useDraft} from '@/models/accounts'
import {isLocationOnlyDraftRoute} from '@/utils/draft-route'
import {useEffect, useRef, useState} from 'react'
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
  const placeholderRouteId = id && placeholderDraftId ? id.id : null
  const checkedMissingPlaceholderRef = useRef<string | null>(null)
  const [isCheckingMissingPlaceholder, setIsCheckingMissingPlaceholder] = useState(false)

  const listDraft = drafts.data?.find((d) => {
    if (!id) return false
    if (d.editUid) return id.uid === d.editUid && pathMatches(d.editPath || [], id.path)
    return isLocationOnlyDraftRoute(id, d)
  })
  const directDraft =
    id && placeholderDraft.data && isLocationOnlyDraftRoute(id, placeholderDraft.data) ? placeholderDraft.data : null
  const existingDraft = listDraft || directDraft

  useEffect(() => {
    if (!placeholderRouteId) {
      checkedMissingPlaceholderRef.current = null
      setIsCheckingMissingPlaceholder(false)
      return
    }
    if (!drafts.data || existingDraft || drafts.isFetching || placeholderDraft.isFetching) return
    if (checkedMissingPlaceholderRef.current === placeholderRouteId) return

    let cancelled = false
    setIsCheckingMissingPlaceholder(true)
    drafts.refetch().finally(() => {
      if (cancelled) return
      checkedMissingPlaceholderRef.current = placeholderRouteId
      setIsCheckingMissingPlaceholder(false)
    })
    return () => {
      cancelled = true
    }
  }, [placeholderRouteId, drafts.data, drafts.isFetching, placeholderDraft.isFetching, existingDraft, drafts.refetch])

  if (!id) return false
  // While drafts are loading, return undefined so the machine waits.
  // Once loaded, return the matching draft or false (no draft).
  if (existingDraft) return existingDraft
  if (!drafts.data) return undefined
  if (placeholderRouteId) {
    const needsFreshPlaceholderCheck = checkedMissingPlaceholderRef.current !== placeholderRouteId
    if (
      drafts.isFetching ||
      placeholderDraft.isLoading ||
      placeholderDraft.isFetching ||
      isCheckingMissingPlaceholder ||
      needsFreshPlaceholderCheck
    ) {
      return undefined
    }
  }
  return false
}

function getRouteResourceId(route: NavRoute): UnpackedHypermediaId | null {
  if (route.key === 'document') return route.id
  if (route.key === 'directory') return route.id
  if (route.key === 'comments') return route.id
  if (route.key === 'activity') return route.id
  if (route.key === 'collaborators') return route.id
  return null
}
