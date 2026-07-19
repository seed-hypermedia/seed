// @vitest-environment jsdom
import {DocumentMetadataView} from '@shm/ui/document-metadata-view'
import {TooltipProvider} from '@shm/ui/tooltip'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Schema-keyed metadata: a field whose KEY is a schema's ipfs:// URL gets
 * advisory schema-aware editing for its value.
 */

const SCHEMA_CID = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
const SCHEMA_KEY = `ipfs://${SCHEMA_CID}`
const LITERAL_CID = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const LITERAL_KEY = `ipfs://${LITERAL_CID}`

const ARTICLE_SCHEMA = {
  title: 'Article',
  type: 'object',
  required: ['headline', 'status'],
  properties: {
    headline: {type: 'string', minLength: 1},
    status: {type: 'string', enum: ['draft', 'published']},
  },
}

// A schema that is a literal union at its root.
const STATUS_SCHEMA = {
  title: 'Status',
  enum: ['todo', 'doing', 'done'],
}

const KNOWN_SCHEMAS: Record<string, unknown> = {
  [SCHEMA_CID]: ARTICLE_SCHEMA,
  [LITERAL_CID]: STATUS_SCHEMA,
}

// The registry fetch hook is network-bound; supply the schemas directly.
vi.mock('@shm/ui/blob-schema-registry', () => ({
  useSchemaRegistries: (seedCids: string[]) => ({
    registry: Object.fromEntries(seedCids.filter((cid) => KNOWN_SCHEMAS[cid]).map((cid) => [cid, KNOWN_SCHEMAS[cid]])),
    isLoading: false,
    isComplete: true,
  }),
}))

let container: HTMLDivElement
let root: Root
let patches: Record<string, unknown>[]

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  patches = []
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(metadata: Record<string, unknown>) {
  act(() => {
    root.render(
      <TooltipProvider>
        <DocumentMetadataView metadata={metadata} canEdit onMetadata={(patch) => patches.push(patch)} />
      </TooltipProvider>,
    )
  })
}

describe('schema-keyed metadata fields', () => {
  it('a conforming schema-keyed value renders enum dropdowns and no warnings', () => {
    render({title: 'Doc', [SCHEMA_KEY]: {headline: 'Hello', status: 'draft'}})
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
    const combo = container.querySelector('[role="combobox"]')
    expect(combo).not.toBeNull()
    expect(combo!.textContent).toContain('draft')
  })

  it('a non-conforming schema-keyed value warns but stays editable', () => {
    render({[SCHEMA_KEY]: {headline: 42, status: 'draft'}})
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })

  it('required-but-missing fields inside the schema-keyed object offer chips', () => {
    render({[SCHEMA_KEY]: {headline: 'Hello'}})
    expect(container.textContent).toContain('status (required)')
  })

  it('plain metadata keys get no schema affordances', () => {
    render({title: 'Doc', nested: {a: 'b'}})
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
    expect(container.textContent).not.toContain('(required)')
  })

  it('the attach bar stages a schema-keyed field with an instantiated value', () => {
    render({})
    const attachToggle = container.querySelector('button[aria-label="Attach schema field"]') as HTMLButtonElement
    expect(attachToggle).toBeTruthy()
    act(() => attachToggle.click())
    const input = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Schema CID'),
    ) as HTMLInputElement
    expect(input).toBeTruthy()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, SCHEMA_KEY)
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const attach = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Attach',
    ) as HTMLButtonElement
    act(() => attach.click())
    expect(patches).toHaveLength(1)
    // instantiated from the schema: required fields seeded, enum head chosen
    expect(patches[0]).toEqual({[SCHEMA_KEY]: {headline: '', status: 'draft'}})
  })

  it('typing a schema URL as the field NAME seeds the enum head under it', () => {
    render({})
    // open the add-field dialog (portals to document.body) and type the schema
    // URL as the field name
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Add field'),
    ) as HTMLButtonElement
    act(() => addButton.click())
    const nameInput = Array.from(document.body.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Field name'),
    ) as HTMLInputElement
    expect(nameInput).toBeTruthy()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, LITERAL_KEY)
      nameInput.dispatchEvent(new Event('input', {bubbles: true}))
    })
    // saving instantiates the schema at that key: the literal-union head 'todo'
    // is seeded as the value under the schema-URL key
    const addCommit = Array.from(document.body.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Add',
    ) as HTMLButtonElement
    act(() => addCommit.click())
    expect(patches).toEqual([{[LITERAL_KEY]: 'todo'}])
  })

  it('a schema-keyed row shows the schema TITLE, not the URL, and a dropdown', () => {
    render({[LITERAL_KEY]: 'doing'})
    expect(container.textContent).toContain('Status')
    expect(container.textContent).not.toContain(LITERAL_CID)
    const combo = container.querySelector('[role="combobox"]')
    expect(combo).not.toBeNull()
    expect(combo!.textContent).toContain('doing')
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
  })

  it('rejects attaching a non-schema key', () => {
    render({})
    act(() => (container.querySelector('button[aria-label="Attach schema field"]') as HTMLButtonElement).click())
    const input = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Schema CID'),
    ) as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'not-a-cid')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const attach = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Attach',
    ) as HTMLButtonElement
    act(() => attach.click())
    expect(patches).toHaveLength(0)
    expect(container.textContent).toContain('Enter a schema CID')
  })
})
