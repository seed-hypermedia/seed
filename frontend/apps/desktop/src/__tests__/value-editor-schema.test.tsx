// @vitest-environment jsdom
import type {BlobSchema} from '@shm/ui/blob-schema'
import {BlobSchemaProvider} from '@shm/ui/blob-schema-context'
import {TooltipProvider} from '@shm/ui/tooltip'
import {CBOR_VALUE_RULES, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ARTICLE_SCHEMA: BlobSchema = {
  type: 'object',
  required: ['title', 'status'],
  properties: {
    title: {type: 'string', minLength: 1},
    status: {type: 'string', enum: ['draft', 'published']},
    count: {type: 'integer'},
  },
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderEditor(value: unknown, schema?: BlobSchema) {
  act(() => {
    root.render(
      <TooltipProvider>
        <ValueEditorProvider openUrl={() => {}}>
          <BlobSchemaProvider schema={schema} registry={{}} value={value}>
            <ValueEditor value={value} onValue={() => {}} rules={CBOR_VALUE_RULES} />
          </BlobSchemaProvider>
        </ValueEditorProvider>
      </TooltipProvider>,
    )
  })
}

describe('schema-aware value editor rendering', () => {
  it('renders plain inputs and no schema affordances without a schema', () => {
    renderEditor({title: 'Hello', status: 'draft'})
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0)
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
    expect(container.textContent).not.toContain('(required)')
    // status stays a free-text input, not a select
    const inputs = Array.from(container.querySelectorAll('input')).map((el) => el.value)
    expect(inputs).toContain('draft')
  })

  it('shows a warning badge on a field that violates the schema', () => {
    renderEditor({title: 42, status: 'draft'}, ARTICLE_SCHEMA)
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })

  it('shows no warning badge when the value conforms', () => {
    renderEditor({title: 'Hello', status: 'draft'}, ARTICLE_SCHEMA)
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
  })

  it('renders enum member values as a select and keeps non-members as text', () => {
    renderEditor({title: 'Hello', status: 'draft'}, ARTICLE_SCHEMA)
    const combo = container.querySelector('[role="combobox"]')
    expect(combo).not.toBeNull()
    expect(combo!.textContent).toContain('draft')

    renderEditor({title: 'Hello', status: 'something-else'}, ARTICLE_SCHEMA)
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    const inputs = Array.from(container.querySelectorAll('input')).map((el) => el.value)
    expect(inputs).toContain('something-else')
    // ...and it warns, but the value is kept editable
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })

  it('offers required-but-missing fields as instant-add chips', () => {
    renderEditor({title: 'Hello'}, ARTICLE_SCHEMA)
    expect(container.textContent).toContain('status (required)')
    // optional declared fields are not instant-add chips
    expect(container.textContent).not.toContain('count (required)')
  })

  it('keeps unknown extra fields editable (advisory only)', () => {
    renderEditor({title: 'Hello', status: 'draft', extra: 'kept'}, {...ARTICLE_SCHEMA, additionalProperties: false})
    const inputs = Array.from(container.querySelectorAll('input')).map((el) => el.value)
    expect(inputs).toContain('kept')
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })
})
