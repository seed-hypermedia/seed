import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {toPlainMessage} from '@bufbuild/protobuf'
import {Role, UnpackedHypermediaId} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMyAccountIds} from './daemon'
import {getParentPaths, hmIdPathToEntityQueryPath} from './entities'
import {queryKeys} from './query-keys'

export function useDocumentCollaborators(id: UnpackedHypermediaId) {
  //
  getParentPaths()
}

export function useAddCapabilities(id: UnpackedHypermediaId) {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()
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
    onSuccess: () => {
      invalidate([queryKeys.CAPABILITIES, id.uid, ...(id.path || [])])
    },
  })
}

type CapabilityType = 'admin' | 'owner' | 'writer'

export function getRoleName(role: Role) {
  if (role === Role.WRITER) return 'Writer'
  if (role === Role.ROLE_UNSPECIFIED) return 'None'
  return 'None'
}

type HMCapability = {
  accountUid: string
  role: CapabilityType
}

const CapabilityInheritance: Readonly<CapabilityType[]> =
  // used to determine when one capability can be used in place of another. all owners are writers, for example
  ['owner', 'admin', 'writer']

export function useMyCapability(
  id: UnpackedHypermediaId,
  capability: 'admin' | 'owner' | 'writer',
): HMCapability | null {
  const myAccounts = useMyAccountIds()
  const capabilities = useAllDocumentCapabilities(id)
  // todo!
  if (myAccounts.data?.indexOf(id.uid) !== -1) {
    // owner. no capability needed
    return {accountUid: id.uid, role: 'owner'}
  }
  return null
}

export function useAllDocumentCapabilities(id: UnpackedHypermediaId) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.CAPABILITIES, id.uid, ...(id.path || [])],
    queryFn: async () => {
      const result = await grpcClient.accessControl.listCapabilities({
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
      })
      const capabilities = result.capabilities.map(toPlainMessage)
      return capabilities
    },
  })
}
