import {HMDraft, hmId} from '@shm/shared'

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
