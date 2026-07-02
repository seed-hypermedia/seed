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

  it('an enum containing "" renders safely (labels are JSON-quoted, so Radix never sees value="")', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {status: {type: 'string', enum: ['', 'draft']}},
    }
    renderEditor({status: 'draft'}, schema)
    const combo = container.querySelector('[role="combobox"]')
    expect(combo).not.toBeNull()
    expect(combo!.textContent).toContain('"draft"')
  })

  it('mixed-type literal unions render number members as a dropdown too', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {level: {enum: ['low', 1, 2, true]}},
    }
    renderEditor({level: 1}, schema)
    const combo = container.querySelector('[role="combobox"]')
    expect(combo).not.toBeNull()
    expect(combo!.textContent).toContain('1')
    // a non-member number stays a plain input + warning
    renderEditor({level: 99}, schema)
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })

  it('an enum with duplicate members falls back to free text', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {status: {type: 'string', enum: ['draft', 'draft']}},
    }
    renderEditor({status: 'draft'}, schema)
    expect(container.querySelector('[role="combobox"]')).toBeNull()
  })

  it('row actions are grouped in one floating menu instead of inline buttons', () => {
    renderEditor({title: 'Hello', nested: {inner: 'x'}})
    // one trigger per row, no inline Copy/Remove buttons taking flex width
    const triggers = Array.from(container.querySelectorAll('button[aria-label^="Actions for"]'))
    expect(triggers.length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('button[aria-label="Copy value as JSON"]')).toBeNull()
    // the trigger floats (absolutely positioned wrapper) so it reserves no row width
    expect(triggers.every((el) => el.parentElement?.className.includes('absolute'))).toBe(true)
    // opening it shows the context-menu actions, including the destructive
    // remove (Radix opens on pointerdown)
    act(() => {
      triggers[0]!.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0}))
    })
    const menu = document.body.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('Copy')
    expect(menu!.textContent).toContain('Remove')
  })

  it('adding a suggested enum field offers a dropdown of the options', () => {
    renderEditor({title: 'Hello'}, ARTICLE_SCHEMA)
    // open the add form
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Add field'),
    ) as HTMLButtonElement
    act(() => addButton.click())
    // click the "status" schema-field suggestion in the add form (required
    // fields render as "status *")
    const statusChip = Array.from(container.querySelectorAll('button')).find((el) => {
      const text = el.textContent?.trim()
      return text === 'status' || text === 'status *'
    }) as HTMLButtonElement
    expect(statusChip).toBeTruthy()
    act(() => statusChip.click())
    // the value input is now a select showing the first enum option
    const combos = Array.from(container.querySelectorAll('[role="combobox"]'))
    const valueSelect = combos.find((el) => el.textContent?.includes('draft'))
    expect(valueSelect).toBeTruthy()
    // submitting commits an enum member, which then renders as a dropdown row
    const commit = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Add',
    ) as HTMLButtonElement
    act(() => commit.click())
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
  })
})
