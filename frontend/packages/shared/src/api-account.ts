import {HMRequestImplementation, HMRequestParams} from './api-types'
import {accountMetadataFromAccount} from './account-metadata'
import {GRPCClient} from './grpc-client'
import {HMAccountNotFound, HMAccountPayload, HMAccountRequest, HMAccountResult, HMMetadataPayload} from './hm-types'
import {getErrorMessage, HMNotFoundError} from './models/entity'
import {hmId} from './utils'

export const AccountParams: HMRequestParams<HMAccountRequest> = {
  inputToParams: (input: string) => ({id: input}),
  paramsToInput: (params: Record<string, string>) => params.id!,
}

/**
 * Load a single account with alias resolution.
 */
export async function loadAccount(client: GRPCClient, uid: string): Promise<HMAccountResult> {
  try {
    const grpcAccount = await client.documents.getAccount({id: uid})
    if (grpcAccount.aliasAccount) {
      return await loadAccount(client, grpcAccount.aliasAccount)
    }
    return {
      type: 'account',
      id: hmId(uid, {version: grpcAccount.homeDocumentInfo?.version}),
      metadata: accountMetadataFromAccount(grpcAccount),
    } satisfies HMAccountPayload
  } catch (e) {
    const err = getErrorMessage(e)
    if (err instanceof HMNotFoundError) {
      return {
        type: 'account-not-found',
        uid,
      } satisfies HMAccountNotFound
    }
    console.error(`Error loading account ${uid}:`, e)
    return {
      type: 'account-not-found',
      uid,
    } satisfies HMAccountNotFound
  }
}

/**
 * Load multiple accounts individually.
 */
export async function loadAccounts(client: GRPCClient, uids: string[]): Promise<Record<string, HMMetadataPayload>> {
  const results = await Promise.all(uids.map((uid) => loadAccount(client, uid)))
  const accounts: Record<string, HMMetadataPayload> = {}
  results.forEach((result, index) => {
    const uid = uids[index]
    if (result && uid && result.type === 'account') {
      const {type, ...payload} = result
      accounts[uid] = payload
    }
  })
  return accounts
}

export const Account: HMRequestImplementation<HMAccountRequest> = {
  async getData(grpcClient: GRPCClient, input: string): Promise<HMAccountResult> {
    return await loadAccount(grpcClient, input)
  },
}
