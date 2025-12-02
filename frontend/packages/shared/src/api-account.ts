import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMAccountRequest, HMMetadataPayload} from './hm-types'
import {prepareHMDocumentMetadata} from './models/entity'
import {hmId} from './utils'

export const Account: HMRequestImplementation<HMAccountRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: string,
  ): Promise<HMMetadataPayload> {
    const grpcAccount = await grpcClient.documents.getAccount({
      id: input,
    })

    const serverAccount = toPlainMessage(grpcAccount)
    if (serverAccount.aliasAccount) {
      return await Account.getData(grpcClient, serverAccount.aliasAccount)
    }
    const metadata = prepareHMDocumentMetadata(grpcAccount.metadata)
    return {
      id: hmId(input, {
        version: serverAccount.homeDocumentInfo?.version,
      }),
      metadata,
    } as HMMetadataPayload
  },
}
