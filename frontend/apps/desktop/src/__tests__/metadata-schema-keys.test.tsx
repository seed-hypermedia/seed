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

const ARTICLE_SCHEMA = {
  title: 'Article',
  type: 'object',
  required: ['headline', 'status'],
  properties: {
    headline: {type: 'string', minLength: 1},
    status: {type: 'string', enum: ['draft', 'published']},
  },
}

// The registry fetch hook is network-bound; supply the schema directly.
vi.mock('@shm/ui/blob-schema-registry', () => ({
  useSchemaRegistries: (seedCids: string[]) => ({
    registry: seedCids.includes(SCHEMA_CID) ? {[SCHEMA_CID]: ARTICLE_SCHEMA} : {},
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
