import {grpcClient} from '@/grpc-client'
import {useMyAccountIds} from '@/models/daemon'
import {client, trpc} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {GRPCClient} from '@shm/shared/grpc-client'
import {
  HMDocumentMetadataSchema,
  HMDraft,
  hmMetadataJsonCorrection,
} from '@shm/shared/hm-types'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'

export function useAccount_deprecated() {
  throw new Error('useAccount_deprecated is fully broken')
}

export function useAccounts() {
  const q = useQuery({
    queryKey: [queryKeys.LIST_ACCOUNTS],
    queryFn: async () => {
      const res = await grpcClient.documents.listAccounts({})
      const accounts = res.accounts.map((account) => ({
        ...toPlainMessage(account),
        metadata: HMDocumentMetadataSchema.parse(
          hmMetadataJsonCorrection(
            account.metadata?.toJson({
              emitDefaultValues: true,
            }),
          ),
        ),
      }))
      const accountsMetadata = Object.fromEntries(
        accounts.map((account) => [
          account.id,
          {
            metadata: account.metadata,
            id: hmId('d', account.id),
          },
        ]),
      )
      return {
        accounts,
        accountsMetadata,
      }
    },
    refetchInterval: 1000 * 15, // 15 seconds
  })
  return q
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

export function useDraft(id: string) {
  return trpc.drafts.get.useQuery(id, {
    enabled: !!id,
  })
}

export function useDrafts(draftIds: string[]) {
  return useQueries({
    queries: draftIds.map((draftId) => queryDraft({grpcClient, draftId})),
  })
}

export function queryDraft({
  draftId,
  ...options
}: {
  draftId?: string
  grpcClient?: GRPCClient
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
