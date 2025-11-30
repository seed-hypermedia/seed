import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation} from './api-types'
import {Status} from './client/.generated/google/rpc/status_pb'
import {GRPCClient} from './grpc-client'
import {
  HMBatchAccountsRequest,
  HMDocumentMetadataSchema,
  HMMetadataPayload,
} from './hm-types'
import {documentMetadataParseAdjustments} from './models/entity'
import {hmId} from './utils'

export const BatchAccounts: HMRequestImplementation<HMBatchAccountsRequest> = {
  async getData(
    grpcClient: GRPCClient,
    accountUids: string[],
  ): Promise<Record<string, HMMetadataPayload>> {
    if (accountUids.length === 0) return {}

    const _accounts = await grpcClient.documents.batchGetAccounts({
      ids: accountUids,
    })

    Object.entries(_accounts.errors).forEach(([id, error]) => {
      try {
        const status = Status.fromBinary(error)
        console.error(`Error loading account ${id}: `, toPlainMessage(status))
      } catch (e) {
        console.error(
          `Error loading account ${id}: (error parse failure) `,
          Buffer.from(error).toString('hex'),
        )
      }
    })

    if (!_accounts?.accounts) {
      return {}
    }

    const resolvedAccounts: Record<string, HMMetadataPayload> = {}
    const aliasesToResolve: string[] = []
    const aliasMapping: Record<string, string[]> = {}

    Object.entries(_accounts.accounts).forEach(([id, account]) => {
      const serverAccount = toPlainMessage(account)

      if (serverAccount.aliasAccount) {
        const aliasAccount = serverAccount.aliasAccount
        if (!aliasMapping[aliasAccount]) {
          aliasMapping[aliasAccount] = []
        }
        aliasMapping[aliasAccount].push(id)

        if (!aliasesToResolve.includes(aliasAccount)) {
          aliasesToResolve.push(aliasAccount)
        }
      } else {
        const serverMetadata = account.metadata?.toJson() || {}
        documentMetadataParseAdjustments(serverMetadata)
        const metadata = HMDocumentMetadataSchema.safeParse(serverMetadata)
        if (!metadata.success) {
          console.error(
            `Error parsing metadata for account ${id}: `,
            metadata.error,
          )
          return
        }
        resolvedAccounts[id] = {
          id: hmId(id),
          metadata: metadata.data,
        } as HMMetadataPayload
      }
    })

    if (aliasesToResolve.length > 0) {
      const resolvedAliases = await BatchAccounts.getData(
        grpcClient,
        aliasesToResolve,
      )

      Object.entries(resolvedAliases).forEach(
        ([resolvedId, resolvedAccount]) => {
          resolvedAccounts[resolvedId] = resolvedAccount

          if (aliasMapping[resolvedId]) {
            aliasMapping[resolvedId].forEach((originalId) => {
              resolvedAccounts[originalId] = resolvedAccount
            })
          }
        },
      )
    }

    return resolvedAccounts
  },
}
