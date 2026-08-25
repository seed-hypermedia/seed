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
  const {onPushPublished} = useUniversalAppContext()
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
      const results = await Promise.allSettled(
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
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      const publishedCount = results.length - failures.length
      if (publishedCount > 0) {
        // Some grants are now in the local daemon. They must reach the
        // document's space as fast as a comment does: push instead of waiting
        // for the space's next sync wave. No-op on platforms that publish
        // through the space. Pushed even when other grants failed, so the ones
        // that did publish don't fall back to the slow path.
        onPushPublished?.(id)
        invalidateQueries([queryKeys.CAPABILITIES, id.uid, ...(id.path || [])])
        invalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, id.uid, ...(id.path || [])])
      }
      if (failures.length) {
        const first = failures[0]!.reason
        if (failures.length === results.length) throw first
        throw new Error(
          `Granted ${publishedCount} of ${results.length} capabilities; ${failures.length} failed: ${
            first instanceof Error ? first.message : String(first)
          }`,
        )
      }
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
 * Whether the current identity can act as the space owner: the space account
 * is the current user, or an AGENT capability on the space account was
 * granted to the current user. Like useIsCurrentUser, both the selected
 * identity (vault/account UID) and the signing identity (web session key
 * UID) are checked, because web sign-in delegates an AGENT capability to
 * the session key itself.
 */
export function useIsSpaceOwner(spaceUid: string | undefined): {isSpaceOwner: boolean; isLoading: boolean} {
  const {selectedIdentity, signingIdentity} = useUniversalAppContext()
  const selectedId = useStream(selectedIdentity) ?? null
  const signingId = useStream(signingIdentity) ?? null
  const capabilities = useCapabilities(spaceUid ? hmId(spaceUid) : undefined)
  const identityUids = [selectedId, signingId].filter((uid): uid is string => !!uid)
  const isDirectOwner = Boolean(spaceUid && identityUids.includes(spaceUid))
  const hasAgentCapability = (capabilities.data ?? []).some(
    (cap) => cap.role === 'agent' && identityUids.includes(cap.accountUid),
  )
  const isSpaceOwner = Boolean(spaceUid) && (isDirectOwner || hasAgentCapability)
  return {isSpaceOwner, isLoading: !isSpaceOwner && Boolean(spaceUid) && capabilities.isLoading}
}

/**
 * Returns true if the currently selected account has writer+ capability
 * on the space's home document, meaning they can view private documents.
 */
export function useCanSeePrivateDocs(docId?: UnpackedHypermediaId): boolean {
  const spaceHomeId = docId ? hmId(docId.uid) : undefined
  const capability = useSelectedAccountCapability(spaceHomeId, 'writer')
  return roleCanWrite(capability?.role)
}
