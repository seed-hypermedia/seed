/**
 * Tests for `resolveAccountChain` (the pure alias-walker) and the
 * `loadAccount` side effect of registering each discovered alias hop.
 *
 * `resolveAccountChain` is treated as the unit-of-test for chain logic:
 * cycles, depth caps, gRPC errors, and not-found handling. `loadAccount`
 * tests focus on the alias-registry side effect plus preserving the legacy
 * `id.uid === resolved-target` return semantics that callers like notify
 * depend on.
 */
import {Code, ConnectError} from '@connectrpc/connect'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadAccount, resolveAccountChain} from '../api-account'
import {clearAliasRegistry, getAliasesOf} from '../models/alias-registry'

type GetAccountResponse = {
  metadata?: unknown
  homeDocumentInfo?: {metadata?: unknown; version?: string} | null
  profile?: {name?: string; icon?: string; description?: string} | null
  aliasAccount?: string
}

/**
 * Build a mock GRPCClient whose `documents.getAccount({id})` returns the
 * response keyed by `id` in `responses`, or throws when the value at that
 * key is an Error instance. Calls without a key produce the implicit
 * not-found error so accidental fetches surface clearly.
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

afterEach(() => {
  clearAliasRegistry()
})

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

  it('records alias hops even when the chain exhausts via not-found', async () => {
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
  it('does not register aliases for a non-alias account', async () => {
    const grpcClient = makeGrpcClient({
      A: {homeDocumentInfo: {version: 'v-A'}},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toMatchObject({type: 'account', id: {uid: 'A'}})
    expect(getAliasesOf('A')).toEqual([])
  })

  it('registers each hop discovered during alias resolution', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {aliasAccount: 'C'},
      C: {homeDocumentInfo: {version: 'v-C'}},
    })
    await loadAccount(grpcClient, 'A')
    expect(getAliasesOf('B')).toEqual(['A'])
    expect(getAliasesOf('C')).toEqual(['B'])
  })

  it('preserves legacy id.uid semantics: returns the resolved target uid', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: {homeDocumentInfo: {version: 'v-B'}},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toMatchObject({type: 'account', id: {uid: 'B', version: 'v-B'}})
  })

  it('returns account-not-found with the leaf uid when the chain ends in error', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
    })
    const result = await loadAccount(grpcClient, 'A')
    expect(result).toEqual({type: 'account-not-found', uid: 'B'})
    // The hop is still registered before the error terminates the chain.
    expect(getAliasesOf('B')).toEqual(['A'])
  })

  it('still registers earlier hops when a later hop fails generically', async () => {
    const grpcClient = makeGrpcClient({
      A: {aliasAccount: 'B'},
      B: new ConnectError('boom', Code.Internal),
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await loadAccount(grpcClient, 'A')
    expect(getAliasesOf('B')).toEqual(['A'])
    errorSpy.mockRestore()
  })
})
