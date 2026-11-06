import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {MenuItemType} from '@shm/ui/options-dropdown'
import {UserRound} from 'lucide-react'
import {mountedAgentServerUrl} from './delete-mounted-agent'
import {useAgentDetail, useSigningIdentities} from './models'
import {useNavigate} from './navigation'
import {getAgentsPlatform} from './platform'

/**
 * "Open <name> profile" for a mounted agent document's options menu: the profile of the one
 * account the agent signs as. Null for any other document, until the agent has loaded, and when
 * the identity picture is ambiguous (zero or several signing keys), since a guess would
 * misattribute the agent.
 */
export function useMountedAgentProfileMenuItem(
  docId: UnpackedHypermediaId,
  metadata: HMMetadata | undefined,
): MenuItemType | null {
  const serverUrl = mountedAgentServerUrl(metadata)
  const accountUid = getAgentsPlatform().useAccountUid()
  const agentId = hmId(docId.uid, {path: docId.path}).id
  const agent = useAgentDetail(serverUrl, accountUid, agentId)
  const identities = useSigningIdentities(serverUrl, accountUid, agentId)
  const navigate = useNavigate()
  const definition = agent.data?.agent.definition
  const signingKeys = definition?.signingKeys || (definition?.signingKey ? [definition.signingKey] : [])
  const granted = (identities.data || []).filter((identity) => signingKeys.includes(identity.name))
  const accountId = signingKeys.length === 1 && granted.length === 1 ? granted[0]?.accountId : undefined
  if (!serverUrl || !definition || !accountId) return null
  return {
    key: 'open-agent-profile',
    label: `Open ${definition.name} profile`,
    icon: <UserRound className="size-4" />,
    onClick: () => navigate({key: 'site-profile', id: hmId(accountId), tab: 'profile'}),
  }
}
