import {grpcClient} from '@/grpc-client'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  Capability,
  Role,
} from '@shm/shared/client/.generated/documents/v3alpha/access_control_pb'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMEntityContent,
  HMRole,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntities} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {
  hmId,
  isIdParentOfOrEqual,
  isPathParentOfOrEqual,
} from '@shm/shared/utils/entity-id-url'
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
      toast.success(`Capabilit${count.length > 1 ? 'ies' : 'y'} added`),
        invalidateQueries([queryKeys.CAPABILITIES, id.uid, ...(id.path || [])])
    },
  })
}

export function getRoleName(role: Role) {
  if (role === Role.WRITER) return 'Writer'
  if (role === Role.ROLE_UNSPECIFIED) return 'None'
  return 'None'
}

function getRoleCapabilityType(role: Role): HMRole | null {
  if (role === Role.WRITER) return 'writer'
  return null
}

type HMCapability = {
  accountUid: string
  role: HMRole
  capabilityId?: string
}

const CapabilityInheritance: Readonly<HMRole[]> =
  // used to determine when one capability can be used in place of another. all owners are writers, for example
  ['owner', 'writer', 'none']

export function roleCanWrite(role?: HMRole | undefined) {
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
          capabilities: result.capabilities.map(toPlainMessage),
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

export function useMyWritableDocuments(): HMWritableDocument[] {
  const accountsCaps = useMyAccountsCapabilities()
  const writableDocumentIds: UnpackedHypermediaId[] = []
  function addWritableId(id: UnpackedHypermediaId) {
    // if writableDocumentIds already has this id, don't add it
    if (writableDocumentIds.find((doc) => doc.id === id.id)) return
    // if id is a parent of any of the ids in writableDocumentIds, remove the child
    writableDocumentIds.forEach((doc) => {
      if (isIdParentOfOrEqual(id, doc)) {
        writableDocumentIds.splice(writableDocumentIds.indexOf(doc), 1)
      }
    })
    // add the parent
    writableDocumentIds.push(id)
  }
  accountsCaps?.forEach(({capabilities}) => {
    capabilities?.forEach((cap) => {
      if (roleCanWrite(roleToHMRole(cap.role))) {
        addWritableId(
          hmId('d', cap.account, {path: entityQueryPathToHmIdPath(cap.path)}),
        )
      }
    })
  })
  accountsCaps?.forEach(({accountId}) => {
    addWritableId(hmId('d', accountId))
  })
  const writableDocuments = useEntities(writableDocumentIds)
    .map((doc) => doc.data)
    .filter((doc) => !!doc)
  if (!accountsCaps) return []
  return writableDocuments.map((doc) => ({
    entity: doc,
    accountsWithWrite: accountsCaps
      .filter(({accountId, capabilities}) => {
        if (doc.id.uid === accountId) return true
        return !!capabilities?.find(
          (cap) =>
            roleCanWrite(roleToHMRole(cap.role)) &&
            cap.account === doc.id.uid &&
            isPathParentOfOrEqual(
              entityQueryPathToHmIdPath(cap.path),
              doc.id.path,
            ),
        )
      })
      .map(({accountId}) => accountId),
  }))
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

export function useMyCapability(
  id?: UnpackedHypermediaId,
  minimumRole: HMRole = 'writer',
): HMCapability | null {
  if (!id) return null
  const myAccounts = useMyAccountIds()
  const capabilities = useAllDocumentCapabilities(id)
  if (myAccounts.data?.indexOf(id.uid) !== -1) {
    // owner is the highest role so we don't need to check for minimumRole
    return {accountUid: id.uid, role: 'owner'}
  }
  const myCapability = [...(capabilities.data || [])]
    ?.sort(
      // sort by capability id for deterministic capability selection
      (a, b) => a.id.localeCompare(b.id),
    )
    .filter((cap) => {
      return isGreaterOrEqualRole(minimumRole, roleToHMRole(cap.role))
    })
    .find((cap) => {
      return !!myAccounts.data?.find(
        (myAccountUid) => myAccountUid === cap.delegate,
      )
    })
  if (myCapability) {
    const role = getRoleCapabilityType(myCapability.role)
    if (role)
      return {
        accountUid: myCapability.delegate,
        role: 'writer',
        capabilityId: myCapability.id,
      }
  }
  return null
}

export function useMyCapabilities(
  id?: UnpackedHypermediaId,
  minimumRole: HMRole = 'writer',
): HMCapability[] {
  if (!id) return []
  const myAccounts = useMyAccountIds()
  const capabilities = useAllDocumentCapabilities(id)

  const ownerCap: HMCapability[] =
    myAccounts.data && myAccounts.data.indexOf(id.uid) > -1
      ? [{accountUid: id.uid, role: 'owner'}]
      : []
  const myCapabilities = [...(capabilities.data || [])]
    ?.sort(
      // sort by capability id for deterministic capability selection
      (a, b) => a.id.localeCompare(b.id),
    )
    .filter((cap) => {
      return isGreaterOrEqualRole(minimumRole, roleToHMRole(cap.role))
    })
    .filter((cap) => {
      return !!myAccounts.data?.find(
        (myAccountUid) => myAccountUid === cap.delegate,
      )
    })
    .map((cap) => {
      const role = getRoleCapabilityType(cap.role)
      if (role)
        return {
          accountUid: cap.delegate,
          role,
          capabilityId: cap.id,
        }
      return null
    })
    .filter((cap) => cap !== null)
  return [...ownerCap, ...myCapabilities]
}

export function useMyAccountsWithWriteAccess(
  id: UnpackedHypermediaId | undefined,
) {
  const myAccounts = useMyAccountIds()
  const capabilities = useAllDocumentCapabilities(id)

  const myAccountIdsWithCapability = myAccounts.data?.filter((accountUid) => {
    return !!capabilities.data?.find((cap) => cap.delegate === accountUid)
  })
  let accountsWithCapabilities =
    myAccountIdsWithCapability?.map((k) => hmId('d', k)) || []
  if (id && myAccounts.data?.includes(id.uid)) {
    accountsWithCapabilities = [...accountsWithCapabilities, hmId('d', id.uid)]
  }
  return useEntities(accountsWithCapabilities)
}

export function useAllDocumentCapabilities(
  id: UnpackedHypermediaId | undefined,
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
      return outputCaps.map((cap) => ({
        ...cap,
        isGrantedToParent: cap.path !== hmIdPathToEntityQueryPath(id.path),
      }))
    },
  })
}
