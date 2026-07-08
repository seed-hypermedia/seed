import type {CapabilityRole} from '@seed-hypermedia/client'
import {createCapability as createCapabilityBlob} from '@seed-hypermedia/client'
import type {HMCapability, HMRole, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useMutation} from '@tanstack/react-query'
import {useUniversalAppContext, useUniversalClient} from '../routing'
import {useStream} from '../use-stream'
import {hmId} from '../utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '../utils/path-api'
import {useCapabilities, useSelectedAccountId} from './entity'
import {invalidateQueries} from './query-client'
import {queryKeys} from './query-keys'

const CapabilityInheritance: Readonly<HMRole[]> =
  // used to determine when one capability can be used in place of another. all owners are writers, for example.
  // AGENT is a full delegation of the account (it can act as the account), so it ranks highest.
  ['agent', 'owner', 'writer', 'none']

export function roleCanWrite(role?: HMRole | null | undefined) {
  if (!role) return false
  const writeCapIndex = CapabilityInheritance.indexOf('writer')
  const roleIndex = CapabilityInheritance.indexOf(role)
  return roleIndex <= writeCapIndex
}

function isGreaterOrEqualRole(referenceRole: HMRole, role: HMRole) {
  const referenceRoleIndex = CapabilityInheritance.indexOf(referenceRole)
  const roleIndex = CapabilityInheritance.indexOf(role)
  return roleIndex <= referenceRoleIndex
}

const EMPTY_TIMESTAMP = {
  seconds: 0,
  nanos: 0,
} as const

export function useAddCapabilities(id: UnpackedHypermediaId) {
  const client = useUniversalClient()
  return useMutation({
    mutationFn: async ({
      myCapability,
      collaboratorAccountIds,
      role,
    }: {
      myCapability: HMCapability
      collaboratorAccountIds: string[]
      role: CapabilityRole
    }) => {
      if (!client.getSigner) throw new Error('Signing not available on this platform')
      const signer = client.getSigner(myCapability.accountUid)
      const path = hmIdPathToEntityQueryPath(id.path)
      await Promise.all(
        collaboratorAccountIds.map(async (collaboratorAccountId) => {
          const result = await createCapabilityBlob(
            {
              delegateUid: collaboratorAccountId,
              role,
              path: path || undefined,
            },
            signer,
          )
          await client.publish(result)
        }),
      )
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.CAPABILITIES, id.uid, ...(id.path || [])])
      invalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, id.uid, ...(id.path || [])])
    },
  })
}

export function useSelectedAccountCapability(
  id?: UnpackedHypermediaId,
  minimumRole: HMRole = 'writer',
): HMCapability | null {
  const selectedAccountUid = useSelectedAccountId()
  const capabilities = useCapabilities(id)
  if (!id) return null
  if (selectedAccountUid === id.uid) {
    // owner is the highest role so we don't need to check for minimumRole
    return {
      id: '_owner',
      accountUid: id.uid,
      role: 'owner',
      grantId: hmId(id.uid),
      createTime: EMPTY_TIMESTAMP,
    } satisfies HMCapability
  }
  const myCapability = [...(capabilities.data || [])]
    ?.sort(
      // sort by capability id for deterministic capability selection
      (a, b) => a.grantId.id.localeCompare(b.grantId.id),
    )
    .filter((cap) => {
      return isGreaterOrEqualRole(minimumRole, cap.role)
    })
    .find((cap) => {
      return selectedAccountUid === cap.accountUid
    })
  return myCapability || null
}

/**
 * Whether the current identity can act as the site owner: the site account
 * is the current user, or an AGENT capability on the site account was
 * granted to the current user. Like useIsCurrentUser, both the selected
 * identity (vault/account UID) and the signing identity (web session key
 * UID) are checked, because web sign-in delegates an AGENT capability to
 * the session key itself.
 */
export function useIsSiteOwner(siteUid: string | undefined): {isSiteOwner: boolean; isLoading: boolean} {
  const {selectedIdentity, signingIdentity} = useUniversalAppContext()
  const selectedId = useStream(selectedIdentity) ?? null
  const signingId = useStream(signingIdentity) ?? null
  const capabilities = useCapabilities(siteUid ? hmId(siteUid) : undefined)
  const identityUids = [selectedId, signingId].filter((uid): uid is string => !!uid)
  const isDirectOwner = Boolean(siteUid && identityUids.includes(siteUid))
  const hasAgentCapability = (capabilities.data ?? []).some(
    (cap) => cap.role === 'agent' && identityUids.includes(cap.accountUid),
  )
  const isSiteOwner = Boolean(siteUid) && (isDirectOwner || hasAgentCapability)
  return {isSiteOwner, isLoading: !isSiteOwner && Boolean(siteUid) && capabilities.isLoading}
}

/**
 * Returns true if the currently selected account has writer+ capability
 * on the site's home document, meaning they can view private documents.
 */
export function useCanSeePrivateDocs(docId?: UnpackedHypermediaId): boolean {
  const siteHomeId = docId ? hmId(docId.uid) : undefined
  const capability = useSelectedAccountCapability(siteHomeId, 'writer')
  return roleCanWrite(capability?.role)
}
