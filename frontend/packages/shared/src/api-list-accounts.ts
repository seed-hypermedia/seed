import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {
  HMDocumentMetadataSchema,
  HMListAccountsRequest,
  HMMetadataPayload,
} from './hm-types'
import {hmId} from './utils'

export const ListAccounts: HMRequestImplementation<HMListAccountsRequest> = {
  async getData(
    grpcClient: GRPCClient,
  ): Promise<HMListAccountsRequest['output']> {
    const rootDocs = await grpcClient.documents.listRootDocuments({
      pageSize: BIG_INT,
    })

    const accounts: HMMetadataPayload[] = []

    rootDocs.documents.forEach((doc) => {
      const id = hmId(doc.account)
      const rawMetadata = doc.metadata?.toJson({
        emitDefaultValues: true,
        enumAsInteger: false,
      })
      const metadataParsed = HMDocumentMetadataSchema.safeParse(rawMetadata)

      if (metadataParsed.success) {
        accounts.push({
          id,
          metadata: metadataParsed.data,
        })
      }
    })

    return {accounts}
  },
}
