import {HMRequestImplementation} from './api-types'
import {accountMetadataFromAccount} from './account-metadata'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListAccountsRequest, HMMetadataPayload} from './hm-types'
import {hmId} from './utils'

export const ListAccounts: HMRequestImplementation<HMListAccountsRequest> = {
  async getData(grpcClient: GRPCClient): Promise<HMListAccountsRequest['output']> {
    const accountList = await grpcClient.documents.listAccounts({
      pageSize: BIG_INT,
    })

    const accounts: HMMetadataPayload[] = accountList.accounts.map((account) => ({
      id: hmId(account.id),
      metadata: accountMetadataFromAccount(account),
    }))

    return {accounts}
  },
}
