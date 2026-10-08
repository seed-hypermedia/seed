import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {writeableStateStream} from '@shm/shared/utils/stream'

/** A browser hosting dialog request, retained while Remix changes pages. */
export type WebDomainRequest = {
  id: UnpackedHypermediaId
  requesterUid: string
  view: 'invitation' | 'hosting' | 'settings'
}

/** Current hosting dialog for this browser tab; never persisted in server sessions. */
export const [setWebDomainRequest, webDomainRequest] = writeableStateStream<WebDomainRequest | null>(null)

const invited = new Set<string>()

/** Offers a domain once after a space's first successful public publication. */
export function inviteWebDomainPublication(id: UnpackedHypermediaId, requesterUid: string) {
  if (invited.has(id.uid)) return
  invited.add(id.uid)
  setWebDomainRequest({id: hmId(id.uid), requesterUid, view: 'invitation'})
}

/** Opens domain settings independently of the page that launched them. */
export function openWebDomainSettings(id: UnpackedHypermediaId, requesterUid: string) {
  setWebDomainRequest({id: hmId(id.uid), requesterUid, view: 'settings'})
}
