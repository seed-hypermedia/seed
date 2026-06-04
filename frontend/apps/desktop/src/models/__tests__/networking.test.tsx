import {grpcClient} from '@/grpc-client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React, {useEffect} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {useDomainsByPeerId} from '../networking'

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    daemon: {
      listDomains: vi.fn(),
    },
  },
}))

vi.mock('../gateway-settings', () => ({
  useGatewayUrl: vi.fn(),
}))

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

function DomainsProbe({onData}: {onData: (domainsByPeerId: Map<string, string[]>) => void}) {
  const query = useDomainsByPeerId({
    retry: false,
  })
  useEffect(() => {
    if (query.data) onData(query.data)
  }, [onData, query.data])
  return null
}

function renderProbe(onData: (domainsByPeerId: Map<string, string[]>) => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DomainsProbe onData={onData} />
      </QueryClientProvider>,
    )
  })
  return {container, root}
}

async function waitForQueryData(onData: ReturnType<typeof vi.fn>) {
  for (let i = 0; i < 10 && !onData.mock.calls.length; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  expect(onData).toHaveBeenCalled()
}

describe('useDomainsByPeerId', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    vi.mocked(grpcClient.daemon.listDomains).mockReset()
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    root = undefined
    container = undefined
  })

  test('groups sorted unique domains by peer id', async () => {
    vi.mocked(grpcClient.daemon.listDomains).mockResolvedValue({
      domains: [
        {domain: 'beta.example', peerId: 'peer-1'},
        {domain: 'alpha.example', peerId: 'peer-1'},
        {domain: 'beta.example', peerId: 'peer-1'},
        {domain: 'peer-two.example', peerId: 'peer-2'},
        {domain: '', peerId: 'peer-3'},
        {domain: 'missing-peer.example', peerId: ''},
      ],
    } as any)

    const onData = vi.fn()
    const rendered = renderProbe(onData)
    container = rendered.container
    root = rendered.root

    await waitForQueryData(onData)
    const domainsByPeerId = onData.mock.calls.at(-1)?.[0] as Map<string, string[]>

    expect(domainsByPeerId.get('peer-1')).toEqual(['alpha.example', 'beta.example'])
    expect(domainsByPeerId.get('peer-2')).toEqual(['peer-two.example'])
    expect(domainsByPeerId.has('peer-3')).toBe(false)
    expect(domainsByPeerId.has('')).toBe(false)
  })
})
