// @vitest-environment jsdom

import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {UniversalAppContext} from '../../routing'
import {hmId} from '../../utils/entity-id-url'
import {queryKeys} from '../query-keys'
import {useResource, useResolvedHmId} from '../entity'

const docA = hmId('uid1', {path: ['old-name']})
const docB = hmId('uid1', {path: ['new-name']})

const documentResponse = (id: ReturnType<typeof hmId>) => ({
  type: 'document' as const,
  id,
  document: {
    version: 'v1',
    account: 'uid1',
    path: '',
    authors: [],
    content: [],
    metadata: {},
    genesis: 'genesis1',
    visibility: 'PUBLIC',
    createTime: '',
    updateTime: '',
  },
})

const redirectResponse = (from: ReturnType<typeof hmId>, to: ReturnType<typeof hmId>) => ({
  type: 'redirect' as const,
  id: from,
  redirectTarget: to,
  republish: false,
})

function createMockClient() {
  return {
    request: vi.fn((_key: string, input: {id: string}) => {
      if (input.id === docA.id) return redirectResponse(docA, docB)
      if (input.id === docB.id) return documentResponse(docB)
      throw new Error(`Unexpected request: ${input.id}`)
    }),
    publish: vi.fn(),
  } as any
}

function renderUseResource(params: {
  id: ReturnType<typeof hmId>
  onRedirectOrDeleted: (opts: {isDeleted: boolean; redirectTarget: ReturnType<typeof hmId> | null}) => void
}) {
  let latestResult: ReturnType<typeof useResource>
  const client = createMockClient()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
    },
  })

  function TestComponent({
    id,
    onRedirectOrDeleted,
  }: {
    id: ReturnType<typeof hmId>
    onRedirectOrDeleted: (opts: {isDeleted: boolean; redirectTarget: ReturnType<typeof hmId> | null}) => void
  }) {
    latestResult = useResource(id, {onRedirectOrDeleted})
    return null
  }

  const render = (id: ReturnType<typeof hmId>, onRedirectOrDeleted: typeof params.onRedirectOrDeleted) => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UniversalAppContext.Provider
            value={{
              openUrl: () => {},
              universalClient: client,
            }}
          >
            <TestComponent id={id} onRedirectOrDeleted={onRedirectOrDeleted} />
          </UniversalAppContext.Provider>
        </QueryClientProvider>,
      )
    })
  }

  render(params.id, params.onRedirectOrDeleted)

  return {
    rerender(id: ReturnType<typeof hmId>, onRedirectOrDeleted: typeof params.onRedirectOrDeleted) {
      render(id, onRedirectOrDeleted)
    },
    result: () => latestResult,
    cleanup() {
      act(() => {
        root.unmount()
      })
      queryClient.clear()
      container.remove()
    },
    client,
    queryClient,
  }
}

async function waitForCondition(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error('Condition not met in time')
}

void React

describe('useResource redirects', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('caches resolved redirected resources under source and target query keys', async () => {
    const onRedirectOrDeleted = vi.fn()
    const rendered = renderUseResource({id: docA, onRedirectOrDeleted})

    await waitForCondition(() => onRedirectOrDeleted.mock.calls.length === 1)

    const oldKey = [queryKeys.ENTITY, docA.id, docA.version || undefined, docA.latest || false]
    const newKey = [queryKeys.ENTITY, docB.id, docB.version || undefined, docB.latest || false]
    expect(rendered.queryClient.getQueryData(oldKey)).toMatchObject({type: 'document', id: docB})
    expect(rendered.queryClient.getQueryData(newKey)).toMatchObject({type: 'document', id: docB})

    rendered.cleanup()
  })

  it('dispatches the same redirect again after navigating away and back', async () => {
    const onRedirectOrDeleted = vi.fn()
    const rendered = renderUseResource({id: docA, onRedirectOrDeleted})

    await waitForCondition(() => onRedirectOrDeleted.mock.calls.length === 1)
    expect(onRedirectOrDeleted).toHaveBeenNthCalledWith(1, {
      isDeleted: false,
      redirectTarget: docB,
    })

    rendered.rerender(docB, onRedirectOrDeleted)
    await waitForCondition(() => rendered.result().data?.id?.id === docB.id)

    rendered.rerender(docA, onRedirectOrDeleted)
    await waitForCondition(() => onRedirectOrDeleted.mock.calls.length === 2)
    expect(onRedirectOrDeleted).toHaveBeenNthCalledWith(2, {
      isDeleted: false,
      redirectTarget: docB,
    })

    rendered.cleanup()
  })
})

describe('domain-based HM embeds', () => {
  it('resolves before resource reads and discovery subscriptions, preserving pinned state', async () => {
    let resolveDomain!: (value: unknown) => void
    const domainResult = new Promise((resolve) => {
      resolveDomain = resolve
    })
    const request = vi.fn(async (key: string, input: any) => {
      if (key === 'GetDomain') return domainResult
      if (key === 'Resource') {
        expect(input.uid).toBe('docs-account')
        return documentResponse(input)
      }
      throw new Error(`Unexpected ${key}`)
    })
    const subscribeEntity = vi.fn(() => () => {})
    let result: ReturnType<typeof useResolvedHmId>
    let resource: ReturnType<typeof useResource>
    function Embed() {
      result = useResolvedHmId('hm://hyper.media/agent/guide?v=pinned#intro[1:3]')
      resource = useResource(result.id, {subscribed: true})
      return null
    }
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <UniversalAppContext.Provider
              value={{openUrl: () => {}, universalClient: {request, publish: vi.fn(), subscribeEntity} as any}}
            >
              <Embed />
            </UniversalAppContext.Provider>
          </QueryClientProvider>,
        ),
      )
      expect(request).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledWith('GetDomain', {domain: 'hyper.media'})
      expect(subscribeEntity).not.toHaveBeenCalled()
      await act(async () => resolveDomain({registeredAccountUid: 'docs-account', isGateway: true}))
      await waitForCondition(() => resource?.data?.type === 'document')
      expect(result!.id).toMatchObject({
        uid: 'docs-account',
        path: ['agent', 'guide'],
        version: 'pinned',
        latest: false,
        blockRef: 'intro',
        blockRange: {start: 1, end: 3},
      })
      expect(subscribeEntity).toHaveBeenCalledWith(
        expect.objectContaining({id: expect.objectContaining({uid: 'docs-account'})}),
      )
    } finally {
      act(() => root.unmount())
      queryClient.clear()
      container.remove()
    }
  })
})
