import React, {createRef} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {routeToUrl} from '@shm/shared/utils/entity-id-url'
import type {NavRoute} from '@shm/shared/routes'
import {SearchInput, type SearchInputHandle} from '../search-input'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app-context', () => ({useAppContext: () => ({externalOpen: vi.fn()})}))
vi.mock('@/errors', () => ({default: vi.fn()}))
vi.mock('@/grpc-client', () => ({domainResolver: async () => 'uid1'}))
vi.mock('@/models/contacts', () => ({useConnectPeer: () => ({mutate: vi.fn()})}))
vi.mock('@/models/experiments', () => ({useExperiments: () => ({data: {}}), readWebBrowserEnabled: async () => false}))
vi.mock('@/selected-account', () => ({useSelectedAccountId: () => 'uid1'}))
vi.mock('@/trpc', () => ({client: {webQuery: {mutate: vi.fn()}}}))
vi.mock('@/utils/window-events', () => ({useTriggerWindowEvent: () => vi.fn()}))
vi.mock('@shm/shared/models/recents', () => ({useRecents: () => ({data: []})}))
vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: []}, isLoading: false, isFetching: false}),
}))
vi.mock('@shm/shared/utils/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/utils/navigation')>()),
  useNavRoute: () => ({key: 'favorites'}),
}))
vi.mock('@shm/shared/utils/use-debounce', () => ({useDebounce: (value: string) => value}))

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('omnibar search-mode pasted URLs', () => {
  for (const base of ['hm://uid1/doc', 'https://gateway.example/hm/uid1/doc', 'https://site.example/doc']) {
    for (const suffix of [
      '?panel=comments/author/root&reply=author%2Freply',
      '/:comments/author/root?reply=author%2Freply',
    ]) {
      it(`keeps the selected reply when pressing Enter on ${base}${suffix}`, async () => {
        const ref = createRef<SearchInputHandle>()
        let selected: NavRoute | undefined
        await act(async () => {
          root.render(
            <QueryClientProvider client={queryClient}>
              <SearchInput
                ref={ref}
                externalSearch={`  ${base}${suffix}  `}
                hideInput
                onSelect={({route}) => {
                  selected = route
                }}
              />
            </QueryClientProvider>,
          )
        })
        await act(async () => ref.current!.handleEnter())
        await vi.waitFor(() => expect(selected).toBeDefined())
        const comments = selected!.key === 'comments' ? selected : 'panel' in selected! ? selected!.panel : null
        expect(comments).toMatchObject({key: 'comments', openComment: 'author/root', replyCommentId: 'author/reply'})
        const url = new URL(routeToUrl(selected!, {hostname: 'https://gateway.example'})!)
        expect(url.searchParams.get('reply')).toBe('author/reply')
      })
    }
  }
})
