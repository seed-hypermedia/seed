import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {deleteAuthState, getAuthState, setAuthState} from '@/local-db'

/** A browser hosting dialog request, retained while Remix changes pages. */
export type WebDomainRequest = {
  id: UnpackedHypermediaId
  requesterUid: string
  view: 'invitation' | 'hosting' | 'settings'
  step?: 'seed-host-custom-domain' | 'seed-host-subdomain'
}

const HOSTING_RETURN_KEY = 'delegation_hosting_return'

/** Keep only the public workflow context across a Vault redirect; logout clears auth state. */
export async function saveWebDomainReturn(request?: WebDomainRequest) {
  if (request) {
    await setAuthState(HOSTING_RETURN_KEY, JSON.stringify(request))
  } else {
    await deleteAuthState(HOSTING_RETURN_KEY)
  }
}

/** Consume once, and resume only for the same delegated space owner. */
export async function takeWebDomainReturn(accountUid: string): Promise<WebDomainRequest | null> {
  const saved = await getAuthState(HOSTING_RETURN_KEY)
  await deleteAuthState(HOSTING_RETURN_KEY)
  if (!saved) return null
  try {
    const request = JSON.parse(saved)
    if (
      request?.requesterUid !== accountUid ||
      request?.id?.uid !== accountUid ||
      !['hosting', 'settings'].includes(request.view) ||
      (request.step !== undefined &&
        request.step !== 'seed-host-custom-domain' &&
        request.step !== 'seed-host-subdomain')
    )
      return null
    return {id: hmId(accountUid), requesterUid: accountUid, view: request.view, step: request.step}
  } catch {
    return null
  }
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
