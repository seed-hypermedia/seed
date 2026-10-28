import {createRef} from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SearchInput, type SearchInputHandle} from '../search-input'

vi.mock('@seed-hypermedia/client', async (original) => {
  const client = await original<typeof import('@seed-hypermedia/client')>()
  return {
    ...client,
    resolveHypermediaUrl: vi.fn(async () => ({
      hmId: client.unpackHmId('hm://z6Mks4xPAL6eNAFVijb4jsj1iByk8izhEyHCWHFE3WYxAgPN/bronze-stoat'),
    })),
  }
})

vi.mock('@/app-context', () => ({useAppContext: () => ({externalOpen: vi.fn()})}))
vi.mock('@/errors', () => ({default: vi.fn()}))
vi.mock('@/grpc-client', () => ({domainResolver: vi.fn()}))
vi.mock('@/models/contacts', () => ({useConnectPeer: () => ({mutate: vi.fn()})}))
vi.mock('@/models/experiments', () => ({useExperiments: () => ({data: {}}), readWebBrowserEnabled: vi.fn()}))
vi.mock('@/selected-account', () => ({useSelectedAccountId: () => undefined}))
vi.mock('@/trpc', () => ({client: {webQuery: {mutate: vi.fn()}}}))
vi.mock('@/utils/window-events', () => ({useTriggerWindowEvent: () => vi.fn()}))
vi.mock('@shm/shared/models/recents', () => ({useRecents: () => ({data: []})}))
vi.mock('@shm/shared/models/search', () => ({useSearch: () => ({data: {entities: []}})}))
vi.mock('@shm/shared/utils/use-debounce', () => ({useDebounce: (value: string) => value}))
vi.mock('@shm/shared/utils/navigation', async (original) => ({
  ...(await original<typeof import('@shm/shared/utils/navigation')>()),
  useNavRoute: () => null,
}))

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
})

describe.each([
  'https://hyper.media/hm/z6Mks4xPAL6eNAFVijb4jsj1iByk8izhEyHCWHFE3WYxAgPN',
  'https://agent-site.example',
])('%s', (baseUrl) => {
  it.each([
    'tools',
    'settings',
    'sessions',
    'session/session-1',
    'memory?file=notes.md',
    'triggers/trigger-2?trigger=old',
    'triggers?trigger=trigger-2',
  ])('preserves the pasted mounted agent %s view when selected from desktop search', async (suffix) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    cleanup = () => {
      act(() => root.unmount())
      client.clear()
      container.remove()
    }
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const ref = createRef<SearchInputHandle>()
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <SearchInput ref={ref} hideInput externalSearch={`${baseUrl}/bronze-stoat/:${suffix}`} onSelect={onSelect} />
        </QueryClientProvider>,
      )
    })
    await act(async () => ref.current!.handleEnter())
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          key: 'document',
          id: expect.objectContaining({id: 'hm://z6Mks4xPAL6eNAFVijb4jsj1iByk8izhEyHCWHFE3WYxAgPN/bronze-stoat'}),
          agentView: suffix.split(/[/?]/)[0],
          ...(suffix.startsWith('session/') ? {agentSessionId: 'session-1'} : {}),
          ...(suffix.startsWith('memory?') ? {agentMemoryPath: 'notes.md'} : {}),
          ...(suffix.startsWith('triggers') ? {agentTriggerId: 'trigger-2'} : {}),
        }),
      }),
    )
  })
})
