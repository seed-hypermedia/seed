import {Code, ConnectError} from '@connectrpc/connect'
import {beforeEach, describe, expect, test, vi} from 'vitest'
import {HMNotFoundError} from '../models/entity'
import {MAX_REDIRECT_HOPS} from '../redirects'
import {createResourceResolver, HMRedirectCycleError} from '../resource-loader'
import {hmId} from '../utils/entity-id-url'

const docA = hmId('uid1', {path: ['doc-a']})
const docB = hmId('uid1', {path: ['doc-b']})
const docC = hmId('uid1', {path: ['doc-c']})

/** The daemon reports a redirect Ref as a FailedPrecondition error naming the target. */
function redirectError(fromIri: string, to: ReturnType<typeof hmId>, options?: {republish?: boolean}) {
  return new ConnectError(
    `document '${fromIri}' has a redirect to ${to.id} (republish = ${options?.republish ? 'true' : 'false'})`,
    Code.FailedPrecondition,
  )
}

function notFoundError(iri: string) {
  return new ConnectError(`document not found: ${iri}`, Code.NotFound)
}

function documentResponse() {
  return {
    kind: {
      case: 'document' as const,
      value: {
        toJson: () => ({
          account: 'uid1',
          path: '/doc-c',
          version: 'v1',
          authors: [],
          content: [],
          metadata: {},
          genesis: 'genesis1',
          createTime: '2026-01-01T00:00:00Z',
          updateTime: '2026-01-01T00:00:00Z',
        }),
      },
    },
  }
}

function createMockGrpcClient(handler: (iri: string) => any) {
  const getResource = vi.fn(async ({iri}: {iri: string}) => handler(iri))
  return {client: {resources: {getResource}} as any, getResource}
}

beforeEach(() => {
  // prepareHMDocument logs schema fallbacks for the minimal fixture document
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createResourceResolver', () => {
  test('follows a redirect chain that ends at a document', async () => {
    const {client, getResource} = createMockGrpcClient((iri) => {
      if (iri === docA.id) throw redirectError(docA.id, docB)
      if (iri === docB.id) throw redirectError(docB.id, docC)
      return documentResponse()
    })

    const result = await createResourceResolver(client)(docA)

    expect(result.type).toBe('document')
    expect(getResource).toHaveBeenCalledTimes(3)
  })

  test('propagates not-found at the end of a redirect chain', async () => {
    const {client, getResource} = createMockGrpcClient((iri) => {
      if (iri === docA.id) throw redirectError(docA.id, docB)
      throw notFoundError(iri)
    })

    await expect(createResourceResolver(client)(docA)).rejects.toBeInstanceOf(HMNotFoundError)
    expect(getResource).toHaveBeenCalledTimes(2)
  })

  test('throws HMRedirectCycleError on a two-document cycle instead of looping forever', async () => {
    const {client, getResource} = createMockGrpcClient((iri) => {
      if (iri === docA.id) throw redirectError(docA.id, docB)
      if (iri === docB.id) throw redirectError(docB.id, docA)
      throw new Error(`unexpected request: ${iri}`)
    })

    const error = await createResourceResolver(client)(docA).then(
      () => null,
      (e) => e,
    )

    expect(error).toBeInstanceOf(HMRedirectCycleError)
    expect(error.message).toContain('Redirect cycle detected')
    expect(error.chain).toEqual([docA.id, docB.id, docA.id])
    // one fetch per distinct address — the cycle is detected before refetching
    expect(getResource).toHaveBeenCalledTimes(2)
  })

  test('throws HMRedirectCycleError on a self-redirect', async () => {
    const {client, getResource} = createMockGrpcClient((iri) => {
      throw redirectError(iri, docA)
    })

    await expect(createResourceResolver(client)(docA)).rejects.toBeInstanceOf(HMRedirectCycleError)
    expect(getResource).toHaveBeenCalledTimes(1)
  })

  test('gives up on an acyclic chain longer than MAX_REDIRECT_HOPS', async () => {
    const ids = Array.from({length: MAX_REDIRECT_HOPS + 3}, (_, i) => hmId('uid1', {path: [`hop-${i}`]}))
    const {client, getResource} = createMockGrpcClient((iri) => {
      const idx = ids.findIndex((id) => id.id === iri)
      if (idx >= 0 && idx < ids.length - 1) throw redirectError(iri, ids[idx + 1]!)
      return documentResponse()
    })

    const error = await createResourceResolver(client)(ids[0]!).then(
      () => null,
      (e) => e,
    )

    expect(error).toBeInstanceOf(HMRedirectCycleError)
    expect(error.message).toContain('Too many redirects')
    expect(getResource).toHaveBeenCalledTimes(MAX_REDIRECT_HOPS + 1)
  })
})
