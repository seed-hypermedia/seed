import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {writeableStateStream} from '@shm/shared/utils/stream'

/** Pending invitation in this window, retained across document navigation. */
export const [setDomainPublishingInvitation, domainPublishingInvitation] =
  writeableStateStream<UnpackedHypermediaId | null>(null)

const invitedSpaces = new Set<string>()

/** Invite once per space in this window after its first successful public publication. */
export function inviteToPublishDomain(id: UnpackedHypermediaId) {
  if (invitedSpaces.has(id.uid)) return
  invitedSpaces.add(id.uid)
  setDomainPublishingInvitation(id)
}
