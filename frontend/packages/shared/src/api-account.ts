import {HMRequestImplementation, HMRequestParams} from './api-types'
import {accountMetadataFromAccount} from './account-metadata'
import {GRPCClient} from './grpc-client'
import {
  HMAccountNotFound,
  HMAccountPayload,
  HMAccountRequest,
  HMAccountResult,
  HMMetadata,
  HMMetadataPayload,
} from '@seed-hypermedia/client/hm-types'
import {getErrorMessage, HMNotFoundError} from './models/entity'
import {hmId} from './utils'

export const AccountParams: HMRequestParams<HMAccountRequest> = {
  inputToParams: (input: string) => ({id: input}),
  paramsToInput: (params: Record<string, string>) => params.id!,
}

/** A single hop in an alias chain: source aliases to target. */
export type AccountChainHop = {source: string; target: string}

/** The terminal step of an alias chain — either a leaf account or not-found. */
export type AccountChainResult =
  | {
      type: 'account'
      uid: string
      metadata: HMMetadata | null
      version: string | null
    }
  | {type: 'account-not-found'; uid: string}

/**
 * Walks the alias chain starting from `uid` until it finds a non-alias
 * account, runs out of hops at `maxDepth`, or hits a not-found / gRPC error.
 *
 * Pure: does not register aliases or touch any cache. Returns the hops
 * traversed so callers can decide whether to register them.
 *
 * Behavior change vs. legacy recursive `loadAccount`: this caps depth at 10
 * by default, so a malformed cyclic alias configuration returns `not-found`
 * cleanly instead of overflowing the stack.
 */
export async function resolveAccountChain(
  client: GRPCClient,
  uid: string,
  maxDepth = 10,
): Promise<{hops: AccountChainHop[]; result: AccountChainResult}> {
  const hops: AccountChainHop[] = []
  let currentUid = uid
  for (let i = 0; i < maxDepth; i++) {
    let grpcAccount
    try {
      grpcAccount = await client.documents.getAccount({id: currentUid})
    } catch (e) {
      const err = getErrorMessage(e)
      if (!(err instanceof HMNotFoundError)) {
        console.error(`Error loading account ${currentUid}:`, e)
      }
      return {hops, result: {type: 'account-not-found', uid: currentUid}}
    }
    if (grpcAccount.aliasAccount) {
      hops.push({source: currentUid, target: grpcAccount.aliasAccount})
      currentUid = grpcAccount.aliasAccount
      continue
    }
    return {
      hops,
      result: {
        type: 'account',
        uid: currentUid,
        metadata: accountMetadataFromAccount(grpcAccount),
        version: grpcAccount.homeDocumentInfo?.version ?? null,
      },
    }
  }
  return {hops, result: {type: 'account-not-found', uid: currentUid}}
}

/**
 * Load an account, transparently following aliases.
 *
 * For an A→B alias, the returned `result.id.uid` is the resolved target (B),
 * not the requested input (A) — this preserves the legacy recursive
 * behavior that callers like notify depend on for signer-to-effective-account
 * resolution.
 */
export async function loadAccount(client: GRPCClient, uid: string): Promise<HMAccountResult> {
  const {result} = await resolveAccountChain(client, uid)
  if (result.type === 'account-not-found') {
    return {type: 'account-not-found', uid: result.uid} satisfies HMAccountNotFound
  }
  return {
    type: 'account',
    id: hmId(result.uid, {version: result.version ?? undefined}),
    metadata: result.metadata,
  } satisfies HMAccountPayload
}

/** Load multiple accounts individually. */
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
