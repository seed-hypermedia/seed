import {grpcClient} from '@/grpc-client'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  Capability,
  Role,
} from '@shm/shared/client/.generated/documents/v3alpha/access_control_pb'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMCapability,
  HMEntityContent,
  HMRole,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId, isPathParentOfOrEqual} from '@shm/shared/utils/entity-id-url'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {toast} from '@shm/ui/toast'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {useMyAccountIds} from './daemon'

export function useAddCapabilities(id: UnpackedHypermediaId) {
  return useMutation({
    mutationFn: async ({
      myCapability,
      collaboratorAccountIds,
      role,
    }: {
      myCapability: HMCapability
      collaboratorAccountIds: string[]
      role: Role
    }) => {
      await Promise.all(
        collaboratorAccountIds.map(
          async (collaboratorAccountId) =>
            await grpcClient.accessControl.createCapability({
              account: id.uid,
              delegate: collaboratorAccountId,
              role,
              path: hmIdPathToEntityQueryPath(id.path),
              signingKeyName: myCapability.accountUid,
              // noRecursive, // ?
            }),
        ),
      )
    },
    onSuccess: (data, {collaboratorAccountIds: count}) => {
      toast.success(`Capabilit${count?.length > 1 ? 'ies' : 'y'} added`),
        invalidateQueries([queryKeys.CAPABILITIES, id.uid, ...(id.path || [])])
    },
  })
}

export function getRoleName(role: HMRole) {
  if (role === 'writer') return 'Writer'
  if (role === 'owner') return 'Owner'
  if (role === 'none') return 'None'
  return 'None'
}

export function getRoleCapabilityType(role: Role): HMRole | null {
  if (role === Role.WRITER) return 'writer'
  return null
}

const CapabilityInheritance: Readonly<HMRole[]> =
  // used to determine when one capability can be used in place of another. all owners are writers, for example
  ['owner', 'writer', 'none']

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

function roleToHMRole(role: Role): HMRole {
  if (role === Role.WRITER) return 'writer'
  if (role === Role.AGENT) return 'agent'
  if (role === Role.ROLE_UNSPECIFIED) return 'none'
  return 'none'
}

function useAccountsCapabilities(accountIds: string[]) {
  const capabilities = useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: [queryKeys.ACCOUNT_CAPABILITIES, accountId],
      queryFn: async () => {
        const result =
          await grpcClient.accessControl.listCapabilitiesForDelegate({
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
            } satisfies HMCapability
          }),
        }
      },
    })),
  })
  return capabilities
}

export type HMWritableDocument = {
  entity: HMEntityContent
  accountsWithWrite: string[]
}

export function useSelectedAccountWritableDocuments(): HMWritableDocument[] {
  const selectedAccountId = useSelectedAccountId()
  const accountsCaps = useAccountsCapabilities(
    selectedAccountId ? [selectedAccountId] : [],
  )
  const writableDocumentIds: UnpackedHypermediaId[] = []
  function addWritableId(id: UnpackedHypermediaId) {
    // if writableDocumentIds already has this id, don't add it
    if (writableDocumentIds.find((doc) => doc.id === id.id)) return
    // add the parent
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

export function useSelectedAccountCapability(
  id?: UnpackedHypermediaId,
  minimumRole: HMRole = 'writer',
): HMCapability | null {
  const selectedAccount = useSelectedAccount()
  const capabilities = useAllDocumentCapabilities(id)
  if (!id) return null
  if (selectedAccount?.id.uid === id.uid) {
    // owner is the highest role so we don't need to check for minimumRole
    return {
      id: '_owner',
      accountUid: id.uid,
      role: 'owner',
      grantId: hmId(id.uid),
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
      return selectedAccount?.id.uid === cap.accountUid
    })
  return myCapability || null
}

export function useMyCapability(
  id?: UnpackedHypermediaId,
  minimumRole: HMRole = 'writer',
): HMCapability | null {
  if (!id) return null
  const myAccounts = useMyAccountIds()
  const capabilities = useAllDocumentCapabilities(id)
  if (myAccounts.data?.indexOf(id.uid) !== -1) {
    // owner is the highest role so we don't need to check for minimumRole
    return {
      id: '_owner',
      accountUid: id.uid,
      role: 'owner',
      grantId: hmId(id.uid),
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
      return !!myAccounts.data?.find(
        (myAccountUid) => myAccountUid === cap.accountUid,
      )
    })
  return myCapability || null
}

export function useSelectedAccountCapabilities(
  id?: UnpackedHypermediaId,
  minimumRole: HMRole = 'writer',
): HMCapability[] {
  if (!id) return []
  const capabilities = useAllDocumentCapabilities(id)
  const selectedAccount = useSelectedAccount()

  const ownerCap: HMCapability[] =
    selectedAccount?.id.uid && selectedAccount.id.uid === id.uid
      ? [
          {
            id: '_owner',
            accountUid: id.uid,
            role: 'owner',
            grantId: hmId(id.uid),
          } satisfies HMCapability,
        ]
      : []
  const myCapabilities: HMCapability[] = [...(capabilities.data || [])]
    ?.sort(
      // sort by capability id for deterministic capability selection
      (a, b) => a.grantId.id.localeCompare(b.grantId.id),
    )
    .filter((cap) => {
      return isGreaterOrEqualRole(minimumRole, cap.role)
    })
    .filter((cap) => {
      return selectedAccount?.id.uid === cap.accountUid
    })
  return [...ownerCap, ...myCapabilities]
}

export function useMyAccountsWithWriteAccess(
  id: UnpackedHypermediaId | undefined | null,
) {
  const myAccounts = useMyAccountIds()
  const capabilities = useAllDocumentCapabilities(id)

  const myAccountIdsWithCapability = myAccounts.data?.filter((accountUid) => {
    return !!capabilities.data?.find((cap) => cap.accountUid === accountUid)
  })
  const accountsWithCapabilities =
    myAccountIdsWithCapability?.map((uid) => hmId(uid)) || []
  return useResources(accountsWithCapabilities)
}

export function useAllDocumentCapabilities(
  id: UnpackedHypermediaId | undefined | null,
) {
  return useQuery({
    queryKey: [queryKeys.CAPABILITIES, id?.uid, ...(id?.path || [])],
    queryFn: async () => {
      if (!id) return []
      const result = await grpcClient.accessControl.listCapabilities({
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
        pageSize: BIG_INT,
      })
      const capabilities = result.capabilities.map(toPlainMessage)
      const alreadyCapKeys = new Set<string>()
      const outputCaps: PlainMessage<Capability>[] = []
      for (const cap of capabilities) {
        const key = `${cap.delegate}-${cap.role}`
        if (alreadyCapKeys.has(key)) continue
        alreadyCapKeys.add(key)
        outputCaps.push(cap)
      }
      const grantedCaps = outputCaps.map((cap) => ({
        id: cap.id,
        accountUid: cap.delegate,
        grantId: hmId(cap.account, {
          path: entityQueryPathToHmIdPath(cap.path),
        }),
        role: roleToHMRole(cap.role),
        label: cap.label,
      })) satisfies HMCapability[]
      return [
        ...grantedCaps,
        {
          id: '_owner',
          accountUid: id.uid,
          grantId: hmId(id.uid),
          role: 'owner',
          label: 'Owner',
        },
      ] satisfies HMCapability[]
    },
  })
}
