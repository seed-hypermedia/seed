// @vitest-environment jsdom
import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {queryClient as sharedQueryClient} from '@shm/shared/models/query-client'
import {UniversalAppProvider} from '@shm/shared/routing'
import type {UniversalClient} from '@shm/shared/universal-client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SchemaRegistryProvider, type HypermediaSchema} from '@shm/ui/schema/index'
import {TooltipProvider} from '@shm/ui/tooltip'
import {CBOR_VALUE_RULES, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const ACCOUNT = 'z6Mkv5nGGGwSRRp5t9Q9Wf2xgV1n9y8mYw1a5cW1w6nUqV4d'

vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: {uid: string; path?: string[] | null} | null) => ({
    isLoading: false,
    data:
      id?.uid === ACCOUNT
        ? {type: 'document', document: {metadata: {name: id.path?.length ? 'My Post' : 'Alice'}}}
        : null,
  }),
}))

const searchState = vi.hoisted(() => ({
  entities: [] as unknown[],
}))
vi.mock('@shm/shared/models/schema-documents', () => ({
  useSchemaDocumentSearch: () => ({data: [], isLoading: false}),
}))
vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: searchState.entities}}),
}))

let container: HTMLDivElement
let root: Root
let latest: unknown
let queryClient: QueryClient
// Profile fields take their suggestions from the mention candidates, served
// through the universal client rather than the search models mocked above.
let mentionCandidates: HMMentionCandidate[] = []
const universalClient = {
  request: async (key: string) => (key === 'MentionCandidates' ? mentionCandidates : null),
  fetchRecents: async () => [],
} as unknown as UniversalClient

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  latest = undefined
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  searchState.entities = []
  mentionCandidates = []
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  queryClient.clear()
  sharedQueryClient.clear()
})

function renderField(value: Record<string, unknown>, schema: HypermediaSchema) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={universalClient}>
          <TooltipProvider>
            <ValueEditorProvider openUrl={() => {}}>
              <SchemaRegistryProvider schema={schema} registry={{}} value={value}>
                <ValueEditor
                  value={value}
                  onValue={(next) => {
                    latest = next
                  }}
                  rules={CBOR_VALUE_RULES}
                />
              </SchemaRegistryProvider>
            </ValueEditorProvider>
          </TooltipProvider>
        </UniversalAppProvider>
      </QueryClientProvider>,
    )
  })
}

const PROFILE_SCHEMA: HypermediaSchema = {
  type: 'hm://hyper.media/struct',
  properties: {
    author: {value: {type: 'hm://hyper.media/string', format: 'hm-profile'}},
  },
}
const DOC_SCHEMA: HypermediaSchema = {
  type: 'hm://hyper.media/struct',
  properties: {
    post: {value: {type: 'hm://hyper.media/string', format: 'hm-url'}},
  },
}

describe('HM entity fields', () => {
  it('shows the resolved TITLE for a conforming profile value, not the URL', () => {
    renderField({author: `hm://${ACCOUNT}`}, PROFILE_SCHEMA)
    expect(container.textContent).toContain('Alice')
    // the raw URL is not shown as the field content
    const inputs = Array.from(container.querySelectorAll('input')).map((el) => el.value)
    expect(inputs).not.toContain(`hm://${ACCOUNT}`)
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
  })

  it('shows the document title for hm-url fields', () => {
    renderField({post: `hm://${ACCOUNT}/blog/hello`}, DOC_SCHEMA)
    expect(container.textContent).toContain('My Post')
  })

  it('a profile URL with a path is non-conforming and renders the search input instead', () => {
    // The schema engine doesn't validate `format` (it's advisory UI only), so a
    // path-bearing profile URL produces no warning badge — unlike v1. The
    // preserved behavior: it's non-conforming, so HMEntityField swaps the resolved
    // display for the editable search input seeded with the raw value.
    renderField({author: `hm://${ACCOUNT}/blog`}, PROFILE_SCHEMA)
    const input = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Search accounts'),
    )
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe(`hm://${ACCOUNT}/blog`)
  })

  it('picking a mention suggestion commits the bare account URL for profiles', async () => {
    mentionCandidates = [
      {
        id: hmId(ACCOUNT, {path: [':profile'], version: 'version'}),
        type: 'account',
        title: 'Alice',
        icon: '',
        parentNames: [],
        searchQuery: '',
        sameSite: false,
        issuedContact: false,
      },
    ]
    renderField({author: ''}, PROFILE_SCHEMA)
    const input = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Search accounts'),
    ) as HTMLInputElement
    // Suggestions open on focus, like the mention menu in the editor.
    act(() => input.focus())
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'ali')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelectorAll('[role="option"]:not(:disabled)')).toHaveLength(1)
    })
    const results = container.querySelector('[data-hm-search-results]')
    expect(results!.textContent).toContain('Alice')
    act(() => (results!.querySelector('[role="option"]') as HTMLButtonElement).click())
    // The profile path and version of the candidate never reach the value.
    expect(latest).toEqual({author: `hm://${ACCOUNT}`})
  })

  it('committing arbitrary text is never blocked (advisory only)', () => {
    renderField({author: 'not-a-url'}, PROFILE_SCHEMA)
    const input = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Search accounts'),
    ) as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'still not a url')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    act(() => {
      // React implements onBlur via the bubbling focusout event.
      input.dispatchEvent(new FocusEvent('focusout', {bubbles: true}))
    })
    expect(latest).toEqual({author: 'still not a url'})
  })
})
