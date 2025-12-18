import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation, HMRequestParams} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMAccountRequest, HMMetadataPayload} from './hm-types'
import {prepareHMDocumentMetadata} from './models/entity'
import {hmId} from './utils'

export const AccountParams: HMRequestParams<HMAccountRequest> = {
  inputToParams: (input: string) => ({id: input}),
  paramsToInput: (params: Record<string, string>) => params.id!,
}

/**
 * Load a single account with alias resolution
 */
export async function loadAccount(
  client: GRPCClient,
  uid: string,
): Promise<HMMetadataPayload | null> {
  try {
    const grpcAccount = await client.documents.getAccount({id: uid})
    const serverAccount = toPlainMessage(grpcAccount)
    if (serverAccount.aliasAccount) {
      return await loadAccount(client, serverAccount.aliasAccount)
    }
    const metadata = prepareHMDocumentMetadata(grpcAccount.metadata)
    return {
      id: hmId(uid, {version: serverAccount.homeDocumentInfo?.version}),
      metadata,
    } as HMMetadataPayload
  } catch (e) {
    console.error(`Error loading account ${uid}:`, e)
    return null
  }
}

/**
 * Load multiple accounts individually
 */
export async function loadAccounts(
  client: GRPCClient,
  uids: string[],
): Promise<Record<string, HMMetadataPayload>> {
  const results = await Promise.all(uids.map((uid) => loadAccount(client, uid)))
  const accounts: Record<string, HMMetadataPayload> = {}
  results.forEach((result, index) => {
    const uid = uids[index]
    if (result && uid) {
      accounts[uid] = result
    }
  })
  return accounts
}

export const Account: HMRequestImplementation<HMAccountRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: string,
  ): Promise<HMMetadataPayload> {
    const result = await loadAccount(grpcClient, input)
    if (!result) {
      throw new Error(`Failed to load account ${input}`)
    }
    return result
  },
}
