import {useAccount} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {HMIcon} from '@shm/ui/hm-icon'
import type {SigningIdentity} from './client'

/**
 * Avatar for a signing identity, read from the account's live profile. The agents server keeps a
 * snapshot of the icon on the identity, but the agent (or any other client) can change its avatar
 * without going through UpdateSigningIdentity, so the snapshot is only a fallback.
 */
export function SigningIdentityIcon({
  identity,
  name,
  size,
}: {
  identity: Pick<SigningIdentity, 'accountId' | 'icon'>
  name?: string | null
  size: number
}) {
  const account = useAccount(identity.accountId, {subscribe: true})
  if (!identity.accountId) return null
  const icon = account.data?.metadata?.icon || identity.icon
  return <HMIcon id={hmId(identity.accountId)} name={name} icon={icon} size={size} />
}
