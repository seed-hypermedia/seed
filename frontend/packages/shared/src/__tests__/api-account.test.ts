/**
 * Tests for `resolveAccountChain` (the pure alias-walker) and `loadAccount`
 * (which delegates to it).
 *
 * Behavior under test:
 * - Chain walking returns the right hops and leaf for non-alias, single-hop,
 *   and multi-hop inputs.
 * - Cycles are bounded by `maxDepth` (legacy recursive `loadAccount` would
 *   stack-overflow on a cycle).
 * - gRPC errors and missing accounts return `account-not-found` cleanly.
 * - `loadAccount` preserves the legacy semantics that `id.uid` is the
 *   resolved target uid for an aliased input — notify and other consumers
 *   depend on this.
 */
import {Code, ConnectError} from '@connectrpc/connect'
import {describe, expect, it, vi} from 'vitest'
import {loadAccount, resolveAccountChain} from '../api-account'

type GetAccountResponse = {
  metadata?: unknown
  homeDocumentInfo?: {metadata?: unknown; version?: string} | null
  profile?: {name?: string; icon?: string; description?: string} | null
  aliasAccount?: string
}

/**
 * Build a mock GRPCClient whose `documents.getAccount({id})` returns the
 * response keyed by `id` in `responses`, or throws when the value at that
 * key is an Error instance. Calls without a key produce a not-found error
 * so accidental fetches surface clearly.
 */
function makeGrpcClient(responses: Record<string, GetAccountResponse | Error>) {
  const getAccount = vi.fn(async ({id}: {id: string}) => {
    const value = responses[id]
    if (!value) throw new ConnectError(`unmocked uid ${id}`, Code.NotFound)
    if (value instanceof Error) throw value
    return value
  })
  return {documents: {getAccount}} as any
}

describe('resolveAccountChain', () => {
  it('returns the leaf with no hops for a non-alias account', async () => {
    const grpcClient = makeGrpcClient({
      A: {homeDocumentInfo: {version: 'v-A'}},
    })
    const {hops, result} = await resolveAccountChain(grpcClient, 'A')
    expect(hops).toEqual([])
    expect(result).toMatchObject({type: 'account', uid: 'A', version: 'v-A'})
  })

  it('walks a single A→B alias and returns one hop', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {homeDocumentInfo: {version: 'v-B'}},
    })
    const {hops, result} = await resolveAccountChain(grpcClient, 'A')
    expect(hops).toEqual([{source: 'A', target: 'B'}])
    expect(result).toMatchObject({type: 'account', uid: 'B', version: 'v-B'})
  })

  it('walks multi-hop chain A→B→C and returns each hop', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {aliasAccount: 'C'},
      C: {homeDocumentInfo: {version: 'v-C'}},
    })
    const {hops, result} = await resolveAccountChain(grpcClient, 'A')
    expect(hops).toEqual([
      {source: 'A', target: 'B'},
      {source: 'B', target: 'C'},
    ])
    expect(result).toMatchObject({type: 'account', uid: 'C', version: 'v-C'})
  })

  it('returns account-not-found when the account is missing', async () => {
    const grpcClient = makeGrpcClient({})
    const {hops, result} = await resolveAccountChain(grpcClient, 'missing')
    expect(hops).toEqual([])
    expect(result).toEqual({type: 'account-not-found', uid: 'missing'})
  })

  it('returns account-not-found when a generic gRPC error is thrown', async () => {
    const grpcClient = makeGrpcClient({
      A: new ConnectError('boom', Code.Internal),
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {hops, result} = await resolveAccountChain(grpcClient, 'A')
    expect(hops).toEqual([])
    expect(result).toEqual({type: 'account-not-found', uid: 'A'})
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('caps the chain at maxDepth so a cycle does not loop forever', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {aliasAccount: 'A'},
    })
    const {hops, result} = await resolveAccountChain(grpcClient, 'A', 4)
    expect(hops.length).toBe(4)
    expect(result.type).toBe('account-not-found')
  })

  it('records hops even when the chain exhausts via not-found', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      // B is missing — chain stops at B with not-found
    })
    const {hops, result} = await resolveAccountChain(grpcClient, 'A')
    expect(hops).toEqual([{source: 'A', target: 'B'}])
    expect(result).toEqual({type: 'account-not-found', uid: 'B'})
  })
})

describe('loadAccount', () => {
  it('returns the resolved-target uid in id.uid for a non-alias account', async () => {
    const grpcClient = makeGrpcClient({
      A: {homeDocumentInfo: {version: 'v-A'}},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toMatchObject({type: 'account', id: {uid: 'A', version: 'v-A'}})
  })

  it('populates profileOwner and version with the resolved-leaf uid for a non-alias account', async () => {
    const grpcClient = makeGrpcClient({
      A: {homeDocumentInfo: {version: 'v-A'}},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toMatchObject({type: 'account', profileOwner: 'A', version: 'v-A'})
  })

  it('preserves legacy semantics: id.uid is the resolved target uid for an alias', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {homeDocumentInfo: {version: 'v-B'}},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toMatchObject({type: 'account', id: {uid: 'B', version: 'v-B'}})
  })

  it('populates profileOwner with the alias target so cache scans can find aliased entries', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {homeDocumentInfo: {version: 'v-B'}},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toMatchObject({type: 'account', profileOwner: 'B', version: 'v-B'})
  })

  it('returns account-not-found with the leaf uid when the chain ends in error', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toEqual({type: 'account-not-found', uid: 'B'})
  })
})
