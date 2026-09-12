import type {HMDocument} from '@seed-hypermedia/client/hm-types'

/** Fail closed in desktop when the selected identity cannot act on a private document. */
export function isPrivateDocumentDenied(visibility: HMDocument['visibility'] | undefined, canEdit: boolean) {
  return visibility === 'PRIVATE' && !canEdit
}
