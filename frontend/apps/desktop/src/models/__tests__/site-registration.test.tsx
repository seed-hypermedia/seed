import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {useSiteRegistration} from '../site'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  register: vi.fn(),
  info: vi.fn(),
  peerInfo: vi.fn(),
  connect: vi.fn(),
  push: vi.fn(),
  publish: vi.fn(),
  toastError: vi.fn(),
  reportError: vi.fn(),
}))
vi.mock('@/trpc', () => ({
  client: {sites: {getConfig: {mutate: mocks.config}, registerSite: {mutate: mocks.register}}},
}))
vi.mock('@/grpc-client', () => ({
  grpcClient: {
    daemon: {getInfo: mocks.info},
    networking: {getPeerInfo: mocks.peerInfo, connect: mocks.connect},
    resources: {pushResourcesToPeer: mocks.push},
  },
}))
vi.mock('@/desktop-universal-client', () => ({desktopUniversalClient: {publishDocument: mocks.publish}}))
vi.mock('@/models/entities', () => ({fetchResource: vi.fn()}))
vi.mock('@/errors', () => ({reportError: mocks.reportError}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: {type: 'document', document: {version: 'published-version'}}}),
}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: vi.fn()}))
vi.mock('@shm/ui/toast', () => ({toast: {error: mocks.toastError}}))

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

describe('site registration peer connections', () => {
  let root: Root
  let container: HTMLDivElement
  let queryClient: QueryClient
  let registration: ReturnType<typeof useSiteRegistration>
  const input = {url: 'http://new.localhost:3000/hm/register?secret=registration-secret'}
  const siteAddrs = ['/ip4/127.0.0.1/tcp/55000/p2p/site-peer']

  function Probe() {
    registration = useSiteRegistration('space-account')
    return null
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.config.mockResolvedValue({peerId: 'site-peer', addrs: siteAddrs})
    mocks.info.mockResolvedValue({peerId: 'desktop-peer'})
    mocks.peerInfo.mockResolvedValue({addrs: ['/ip4/127.0.0.1/tcp/55000']})
    mocks.register.mockResolvedValue({message: 'Success'})
    mocks.connect.mockResolvedValue({})
    mocks.publish.mockResolvedValue({version: 'new-version'})
    mocks.push.mockImplementation(async function* () {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  it('registers and publishes the URL without dialing or pushing to the same daemon', async () => {
    mocks.config.mockResolvedValue({peerId: 'desktop-peer', addrs: siteAddrs})
    await act(async () => {
      expect(await registration.mutateAsync(input)).toBe('http://new.localhost:3000')
    })
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          registrationSecret: 'registration-secret',
          peerId: 'desktop-peer',
          accountUid: 'space-account',
        }),
      }),
    )
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'space-account',
        changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: 'http://new.localhost:3000'}}}],
      }),
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.reportError).not.toHaveBeenCalled()
  })

  it('still connects and pushes to a different daemon on localhost', async () => {
    await act(async () => {
      await registration.mutateAsync(input)
    })
    expect(mocks.connect).toHaveBeenCalledWith({addrs: siteAddrs})
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({addrs: siteAddrs}))
    expect(mocks.publish).toHaveBeenCalledTimes(1)
  })

  it('preserves failures from connecting to another daemon', async () => {
    mocks.connect.mockRejectedValue(new Error('connection refused'))
    await act(async () => {
      await expect(registration.mutateAsync(input)).rejects.toThrow('connection refused')
    })
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('does not assume a site with a missing peer ID is local', async () => {
    mocks.config.mockResolvedValue({addrs: siteAddrs})
    await act(async () => {
      await registration.mutateAsync(input)
    })
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(mocks.push).toHaveBeenCalledTimes(1)
  })

  it('preserves a registration error even when both peers match', async () => {
    mocks.config.mockResolvedValue({peerId: 'desktop-peer', addrs: siteAddrs})
    mocks.register.mockRejectedValue(new Error('Invalid registration secret'))
    await act(async () => {
      await expect(registration.mutateAsync(input)).rejects.toThrow('Invalid registration secret')
    })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
