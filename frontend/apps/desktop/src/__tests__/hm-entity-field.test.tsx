// @vitest-environment jsdom
import {OnyxSchemaProvider, type OnyxSchema} from '@shm/ui/onyx/index'
import {TooltipProvider} from '@shm/ui/tooltip'
import {CBOR_VALUE_RULES, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
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
vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: searchState.entities}}),
}))

let container: HTMLDivElement
let root: Root
let latest: unknown

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  latest = undefined
  searchState.entities = []
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderField(value: Record<string, unknown>, schema: OnyxSchema) {
  act(() => {
    root.render(
      <TooltipProvider>
        <ValueEditorProvider openUrl={() => {}}>
          <OnyxSchemaProvider schema={schema} registry={{}} value={value}>
            <ValueEditor
              value={value}
              onValue={(next) => {
                latest = next
              }}
              rules={CBOR_VALUE_RULES}
            />
          </OnyxSchemaProvider>
        </ValueEditorProvider>
      </TooltipProvider>,
    )
  })
}

const PROFILE_SCHEMA: OnyxSchema = {
  type: 'hm://hyper.media/map',
  properties: {author: {type: 'hm://hyper.media/string', format: 'hm-profile'}},
}
const DOC_SCHEMA: OnyxSchema = {
  type: 'hm://hyper.media/map',
  properties: {post: {type: 'hm://hyper.media/string', format: 'hm-url'}},
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
    // The Onyx engine doesn't validate `format` (it's advisory UI only), so a
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

  it('picking a search result commits the bare account URL for profiles', () => {
    searchState.entities = [
      {id: {uid: ACCOUNT, id: `hm://${ACCOUNT}`, path: null}, title: 'Alice', type: 'document'},
      {id: {uid: ACCOUNT, id: `hm://${ACCOUNT}/blog`, path: ['blog']}, title: 'Blog', type: 'document'},
    ]
    renderField({author: ''}, PROFILE_SCHEMA)
    const input = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Search accounts'),
    ) as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'ali')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    // profile mode filters out path-bearing results
    const results = container.querySelector('[data-hm-search-results]')
    expect(results).not.toBeNull()
    expect(results!.textContent).toContain('Alice')
    expect(results!.textContent).not.toContain('Blog')
    const choice = Array.from(results!.querySelectorAll('button')).find((el) => el.textContent?.includes('Alice'))!
    act(() => choice.click())
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
