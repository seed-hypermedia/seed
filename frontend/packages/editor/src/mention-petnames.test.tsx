import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, expect, it, vi} from 'vitest'
import {UniversalAppProvider} from '@shm/shared/routing'
import {SelectedAccountContactsProvider} from '@shm/shared/models/contacts'
import {queryAccount, queryContactsOfAccount} from '@shm/shared/models/queries'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMContactRecord} from '@seed-hypermedia/client/hm-types'
import {MentionToken} from './mentions-plugin'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => vi.useRealTimers())

it('renders petnames for the selected account and updates existing mentions without leaking previous contacts', async () => {
  vi.useFakeTimers()
  const contacts = (account: string, name: string): HMContactRecord[] => [
    {id: account + '/contact', account, subject: 'alex', name, signer: account},
  ]
  let resolveContacts!: (value: HMContactRecord[]) => void
  const client = {
    request: vi.fn(
      () =>
        new Promise<HMContactRecord[]>((resolve) => {
          resolveContacts = resolve
        }),
    ),
  } as any
  const cache = new QueryClient({
    defaultOptions: {queries: {staleTime: Infinity, keepPreviousData: true, retry: false}},
  })
  cache.setQueryData(queryAccount(client, 'alex').queryKey, {id: hmId('alex'), metadata: {name: 'Alex Burdiyan'}})
  cache.setQueryData(queryContactsOfAccount(client, 'viewer-a').queryKey, contacts('viewer-a', 'Burdi'))
  const [select, selectedIdentity] = writeableStateStream<string | null>('viewer-a')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <UniversalAppProvider
            universalClient={client}
            selectedIdentity={selectedIdentity}
            openUrl={() => {}}
            openRoute={() => {}}
          >
            <SelectedAccountContactsProvider>
              <MentionToken value="hm://alex/:profile" mentionKind="account" />
            </SelectedAccountContactsProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      )
    })
    expect(container.textContent).toBe('@Burdi')

    await act(async () => {
      select('viewer-b')
    })
    expect(container.textContent).toBe('@Alex Burdiyan')
    expect(client.request).toHaveBeenCalledWith('AccountContacts', 'viewer-b', expect.anything())
    await act(async () => {
      resolveContacts(contacts('viewer-b', 'Alex B'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.textContent).toBe('@Alex B')

    await act(async () => {
      select('viewer-a')
    })
    expect(container.textContent).toBe('@Burdi')
    await act(async () => {
      cache.setQueryData(queryContactsOfAccount(client, 'viewer-a').queryKey, contacts('viewer-a', 'Buddy'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.textContent).toBe('@Buddy')
    await act(async () => {
      cache.setQueryData(queryContactsOfAccount(client, 'viewer-a').queryKey, contacts('viewer-a', ''))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.textContent).toBe('@Alex Burdiyan')
    await act(async () => {
      select(null)
    })
    expect(container.textContent).toBe('@Alex Burdiyan')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    cache.clear()
  }
})
