import {grpcClient} from '@/grpc-client'
import {useSelectedAccountId} from '@/selected-account'
import {HMCapability, HMResourceFetchResult, HMRole, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {Role} from '@shm/shared/client/.generated/documents/v3alpha/access_control_pb'
import {BIG_INT} from '@shm/shared/constants'
import {roleCanWrite} from '@shm/shared/models/capabilities'
import {useCapabilities, useResources} from '@shm/shared/models/entity'
import {hmId, isPathParentOfOrEqual} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {useQueries} from '@tanstack/react-query'
import {useMyAccountIds} from './daemon'

// Re-export shared capabilities hooks for backward compatibility
export {roleCanWrite, useAddCapabilities, useSelectedAccountCapability} from '@shm/shared/models/capabilities'

export function getRoleCapabilityType(role: Role): HMRole | null {
  if (role === Role.WRITER) return 'writer'
  return null
}

const CapabilityInheritance: Readonly<HMRole[]> = ['owner', 'writer', 'none']

function isGreaterOrEqualRole(referenceRole: HMRole, role: HMRole) {
  const referenceRoleIndex = CapabilityInheritance.indexOf(referenceRole)
  const roleIndex = CapabilityInheritance.indexOf(role)
  return roleIndex <= referenceRoleIndex
}

function roleToHMRole(role: Role): HMRole {
  if (role === Role.WRITER) return 'writer'
  if (role === Role.AGENT) return 'agent'
  if (role === Role.ROLE_UNSPECIFIED) return 'none'
  return 'none'
}

function useAccountsCapabilities(accountIds: string[]) {
  const capabilities = useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: ['ACCOUNT_CAPABILITIES', accountId],
      queryFn: async () => {
        const result = await grpcClient.accessControl.listCapabilitiesForDelegate({
          delegate: accountId,
          pageSize: BIG_INT,
        })

        return {
          accountId,
          capabilities: result.capabilities.map((serverCap) => {
            return {
              id: serverCap.id,
              accountUid: serverCap.account,
              role: roleToHMRole(serverCap.role),
              grantId: hmId(serverCap.account, {
                path: entityQueryPathToHmIdPath(serverCap.path),
              }),
              createTime: serverCap.createTime!,
            } satisfies HMCapability
          }),
        }
      },
    })),
  })
  return capabilities
}

const EMPTY_TIMESTAMP = {
  seconds: 0,
  nanos: 0,
} as const

export type HMWritableDocument = {
  entity: HMResourceFetchResult
  accountsWithWrite: string[]
}

export function useSelectedAccountWritableDocuments(): HMWritableDocument[] {
  const selectedAccountId = useSelectedAccountId()
  const accountsCaps = useAccountsCapabilities(selectedAccountId ? [selectedAccountId] : [])
  const writableDocumentIds: UnpackedHypermediaId[] = []
  function addWritableId(id: UnpackedHypermediaId) {
    if (writableDocumentIds.find((doc) => doc.id === id.id)) return
    writableDocumentIds.push(id)
  }
  accountsCaps?.forEach((q) => {
    const capabilities = q.data?.capabilities
    capabilities?.forEach((cap) => {
      if (roleCanWrite(cap.role)) {
        addWritableId(cap.grantId)
      }
    })
  })
  if (selectedAccountId) {
    addWritableId(hmId(selectedAccountId))
  }

  const writableDocuments = useResources(writableDocumentIds)
    .map((doc) => doc.data)
    .filter((doc) => !!doc)
  if (!accountsCaps) return []
  const allWritableDocuments = writableDocuments.map((doc) => ({
    entity: doc,
    accountsWithWrite: accountsCaps
      .filter((q) => {
        const accountId = q.data?.accountId
        const capabilities = q.data?.capabilities
        if (doc.id.uid === accountId) return true
        return !!capabilities?.find(
          (cap) =>
            roleCanWrite(cap.role) &&
            cap.grantId.uid === doc.id.uid &&
            isPathParentOfOrEqual(cap.grantId.path, doc.id.path),
        )
      })
      .map((q) => q.data?.accountId)
      .filter((accountId) => !!accountId) as string[],
  }))
  return allWritableDocuments
}

export function useMyAccountsCapabilities() {
  const myAccounts = useMyAccountIds()
  const capabilities = useAccountsCapabilities(myAccounts.data || [])
  return myAccounts.data?.map((accountId) => {
    const caps = capabilities?.find((cap) => cap.data?.accountId === accountId)
    return {
      accountId,
      capabilities: caps?.data?.capabilities,
    }
  })
}

export function useMyCapability(id?: UnpackedHypermediaId, minimumRole: HMRole = 'writer'): HMCapability | null {
  if (!id) return null
  const myAccounts = useMyAccountIds()
  const capabilities = useCapabilities(id)
  if (myAccounts.data?.indexOf(id.uid) !== -1) {
    return {
      id: '_owner',
      accountUid: id.uid,
      role: 'owner',
      grantId: hmId(id.uid),
      createTime: EMPTY_TIMESTAMP,
    } satisfies HMCapability
  }
  const myCapability = [...(capabilities.data || [])]
    ?.sort((a, b) => a.grantId.id.localeCompare(b.grantId.id))
    .filter((cap) => isGreaterOrEqualRole(minimumRole, cap.role))
    .find((cap) => !!myAccounts.data?.find((myAccountUid) => myAccountUid === cap.accountUid))
  return myCapability || null
}

export function useMyAccountsWithWriteAccess(id: UnpackedHypermediaId | undefined | null) {
  const myAccounts = useMyAccountIds()
  const capabilities = useCapabilities(id)

  const myAccountIdsWithCapability = myAccounts.data?.filter((accountUid) => {
    return !!capabilities.data?.find((cap) => cap.accountUid === accountUid)
  })
  const accountsWithCapabilities = myAccountIdsWithCapability?.map((uid) => hmId(uid)) || []
  return useResources(accountsWithCapabilities)
}
