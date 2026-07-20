// @vitest-environment jsdom
import {OnyxSchemaProvider, type OnyxSchema} from '@shm/ui/onyx/index'
import {TooltipProvider} from '@shm/ui/tooltip'
import {CBOR_VALUE_RULES, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ARTICLE_SCHEMA: OnyxSchema = {
  type: 'hm://hyper.media/map',
  required: ['title', 'status'],
  properties: {
    title: {type: 'hm://hyper.media/string', minLength: 1},
    status: {type: 'hm://hyper.media/string', enum: ['draft', 'published']},
    count: {type: 'hm://hyper.media/integer'},
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

function renderEditor(value: unknown, schema?: OnyxSchema) {
  act(() => {
    root.render(
      <TooltipProvider>
        <ValueEditorProvider openUrl={() => {}}>
          <OnyxSchemaProvider schema={schema} registry={{}} value={value}>
            <ValueEditor value={value} onValue={() => {}} rules={CBOR_VALUE_RULES} />
          </OnyxSchemaProvider>
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
    // An Onyx map with `properties` but no `values` is closed, so an extra key
    // is advisory-only non-conforming (the v1 `additionalProperties: false`).
    // Onyx attributes the "unexpected key" warning to the containing map's path,
    // so nest the closed map under a field to get a rendered row to badge.
    const schema: OnyxSchema = {
      type: 'hm://hyper.media/map',
      values: {},
      properties: {article: ARTICLE_SCHEMA},
    }
    renderEditor({article: {title: 'Hello', status: 'draft', extra: 'kept'}}, schema)
    const inputs = Array.from(container.querySelectorAll('input')).map((el) => el.value)
    expect(inputs).toContain('kept')
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })

  it('an enum containing "" renders safely (labels are JSON-quoted, so Radix never sees value="")', () => {
    const schema: OnyxSchema = {
      type: 'hm://hyper.media/map',
      values: {},
      properties: {status: {type: 'hm://hyper.media/string', enum: ['', 'draft']}},
    }
    renderEditor({status: 'draft'}, schema)
    const combo = container.querySelector('[role="combobox"]')
    expect(combo).not.toBeNull()
    expect(combo!.textContent).toContain('"draft"')
  })

  it('mixed-type literal unions render number members as a dropdown too', () => {
    const schema: OnyxSchema = {
      type: 'hm://hyper.media/map',
      values: {},
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
    const schema: OnyxSchema = {
      type: 'hm://hyper.media/map',
      values: {},
      properties: {status: {type: 'hm://hyper.media/string', enum: ['draft', 'draft']}},
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

  it('adding a suggested enum field creates it as a conforming enum member', () => {
    // A stateful harness so the added field actually lands in the value and
    // re-renders as its inline dropdown.
    let current: Record<string, unknown> = {title: 'Hello'}
    function Harness() {
      const [value, setValue] = React.useState<Record<string, unknown>>({title: 'Hello'})
      current = value
      return (
        <TooltipProvider>
          <ValueEditorProvider openUrl={() => {}}>
            <OnyxSchemaProvider schema={ARTICLE_SCHEMA} registry={{}} value={value}>
              <ValueEditor
                value={value}
                onValue={(v) => setValue(v as Record<string, unknown>)}
                rules={CBOR_VALUE_RULES}
              />
            </OnyxSchemaProvider>
          </ValueEditorProvider>
        </TooltipProvider>
      )
    }
    act(() => root.render(<Harness />))
    // open the add-field dialog (it portals to document.body)
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Add field',
    ) as HTMLButtonElement
    act(() => addButton.click())
    // pick the "status" schema-field suggestion (required fields render "status *")
    const statusChip = Array.from(document.body.querySelectorAll('button')).find((el) => {
      const text = el.textContent?.trim()
      return text === 'status' || text === 'status *'
    }) as HTMLButtonElement
    expect(statusChip).toBeTruthy()
    act(() => statusChip.click())
    // save: the field is created as the enum head ('draft'), conforming
    const commit = Array.from(document.body.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Add',
    ) as HTMLButtonElement
    act(() => commit.click())
    expect(current.status).toBe('draft')
    // it renders inline as a dropdown of the enum, with no warning badge
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
    const combo = Array.from(container.querySelectorAll('[role="combobox"]')).find(
      (el) => el.textContent?.includes('draft'),
    )
    expect(combo).toBeTruthy()
  })
})
