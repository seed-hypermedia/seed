import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {useMyAccountIds} from '@/models/daemon'
import {client, trpc} from '@/trpc'
import {Code, ConnectError} from '@connectrpc/connect'
import {
  GRPCClient,
  HMDraft,
  packHmId,
  queryKeys,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useQueries, UseQueryOptions} from '@tanstack/react-query'

export function useAccount_deprecated() {
  throw new Error('useAccount_deprecated is fully broken')
}
export function useAccounts() {
  throw new Error('useAccounts is fully broken')
}
export function useAllAccounts() {
  throw new Error('useAllAccounts is fully broken')
}

/*
 * @deprecated use useMyAccountIds for multi-account support
 */
export function useMyAccount_deprecated() {
  const accountKeys = useMyAccountIds()
  if (!accountKeys.data) return null
  if (!accountKeys.data.length) return null
  // if (accountKeys.data.length > 1)
  //   throw new Error('Not supporting multiple accounts yet.')
  const accountId = accountKeys.data[0]
  if (!accountId) return null
  return accountId
}

export function useSetProfile_deprecated() {
  throw new Error('useSetProfile_deprecated not supported anymore')
}

export function useDraft(id?: UnpackedHypermediaId) {
  const draftId = id ? packHmId({...id, version: null}) : ''
  return trpc.drafts.get.useQuery(draftId, {
    enabled: !!id,
  })
}

export function useWriteDraft(id?: UnpackedHypermediaId) {
  const invalidate = useQueryInvalidator()
  const saveDraft = trpc.drafts.write.useMutation({
    onSuccess: () => {
      invalidate(['trpc.drafts.get'])
    },
  })

  return async (draft: HMDraft) => {
    if (!id) return
    await saveDraft.mutateAsync({id: id.id, draft})
  }
}

export function useDrafts(draftIds: string[]) {
  const grpcClient = useGRPCClient()
  return useQueries({
    queries: draftIds.map((draftId) => queryDraft({grpcClient, draftId})),
  })
}

export function queryDraft({
  draftId,
  grpcClient,
  ...options
}: {
  draftId?: string
  grpcClient: GRPCClient
} & UseQueryOptions<HMDraft | null>): UseQueryOptions<HMDraft | null> {
  return {
    enabled: !!draftId,
    queryKey: [queryKeys.DRAFT, draftId],
    useErrorBoundary: false,
    queryFn: async () => {
      let draft: HMDraft | null = null
      if (!draftId) return null
      try {
        const draftReq = await client.drafts.get.query(draftId)
        draft = draftReq
      } catch (error) {
        const connectErr = ConnectError.from(error)
        if ([Code.Unknown, Code.NotFound].includes(connectErr.code)) {
          // either the entity is unknown (no changes) or 404
        } else {
          console.log('queryProfile draft ERROR', connectErr)
          throw Error(
            `DRAFT get Error: ${connectErr.code} ${JSON.stringify(
              connectErr,
              null,
            )}`,
          )
        }
      }

      return draft
    },
    ...options,
  }
}
