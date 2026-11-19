// @vitest-environment jsdom
import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {queryClient} from '@shm/shared/models/query-client'
import {UniversalAppProvider} from '@shm/shared/routing'
import type {UniversalClient} from '@shm/shared/universal-client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MentionResults} from '../mention-results'

let container: HTMLDivElement
let root: Root
let client: QueryClient

const doc: HMMentionCandidate = {
  id: hmId('site-uid', {path: ['design-notes', 'sharing-sketches'], version: 'v1'}),
  type: 'document',
  title: 'Sharing Sketches',
  icon: '',
  parentNames: ['site-uid', 'design-notes'],
  searchQuery: '',
  sameSite: true,
  issuedContact: false,
  activityTime: Date.now() - 6 * 3_600_000,
  activityType: 'publication',
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  client = new QueryClient({defaultOptions: {queries: {retry: false}}})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  client.clear()
  queryClient.clear()
})

function render(suggestions: HMMentionCandidate[]) {
  const universalClient = {
    request: async (key: string, id?: {uid: string; path?: string[]}) =>
      key === 'Resource' && id
        ? {
            type: 'document',
            id,
            document: {
              account: id.uid,
              path: `/${(id.path || []).join('/')}`,
              authors: [],
              genesis: 'g1',
              visibility: 'PUBLIC',
              metadata: {name: 'Seed Team Talks'},
            },
          }
        : null,
  } as unknown as UniversalClient
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={universalClient}>
          <MentionResults
            id="mentions"
            mode="document"
            suggestions={suggestions}
            selected={0}
            loading={false}
            error={false}
            onRetry={() => {}}
            onSelect={() => {}}
          />
        </UniversalAppProvider>
      </QueryClientProvider>,
    )
  })
}

describe('document mention rows', () => {
  it('shows the space breadcrumb and relative publish time', async () => {
    render([doc])
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain('Seed Team Talks / Design notes')
    })
    expect(container.textContent).toContain('· 6h ago')
    expect(container.textContent).not.toContain('Published')
  })
})
