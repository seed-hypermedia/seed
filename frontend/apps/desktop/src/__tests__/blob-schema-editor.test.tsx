// @vitest-environment jsdom
import type {BlobSchema} from '@shm/ui/blob-schema'
import {BLOB_META_SCHEMA_CID} from '@shm/ui/blob-schema'
import {BlobSchemaEditor} from '@shm/ui/blob-schema-editor'
import {TooltipProvider} from '@shm/ui/tooltip'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

let container: HTMLDivElement
let root: Root
let latest: unknown

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  latest = undefined
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(value: Record<string, unknown>) {
  act(() => {
    root.render(
      <TooltipProvider>
        <BlobSchemaEditor
          value={value}
          onValue={(next) => {
            latest = next
          }}
        />
      </TooltipProvider>,
    )
  })
}

const schemaLink = {schema: {'/': BLOB_META_SCHEMA_CID}}

describe('BlobSchemaEditor', () => {
  it('shows built-in title/description controls and the type picker', () => {
    render({...schemaLink, type: 'object', title: 'Article'})
    const inputs = Array.from(container.querySelectorAll('input'))
    expect(inputs.some((el) => el.value === 'Article')).toBe(true)
    expect(container.textContent).toContain('Title')
    expect(container.textContent).toContain('Description')
    expect(container.textContent).toContain('Schema of')
  })

  it('shows object-only controls (fields table, extra-fields switch) for object schemas', () => {
    render({...schemaLink, type: 'object', properties: {title: {type: 'string'}}, required: ['title']})
    expect(container.textContent).toContain('Fields')
    expect(container.textContent).toContain('Allow fields beyond the ones declared above')
    expect(container.textContent).toContain('Required')
    expect(container.textContent).toContain('Add field')
  })

  it('hides object-only controls for non-object schemas', () => {
    render({...schemaLink, type: 'string'})
    expect(container.textContent).not.toContain('Allow fields beyond')
    expect(container.textContent).not.toContain('Add field')
    // string options are shown instead
    expect(container.textContent).toContain('Min length')
    expect(container.textContent).toContain('Pattern')
  })

  it('literal unions get their own panel with typed value chips', () => {
    render({...schemaLink, enum: ['draft', 42, true]})
    expect(container.textContent).toContain('Allowed values')
    expect(container.textContent).toContain('"draft"')
    expect(container.textContent).toContain('42')
    expect(container.textContent).toContain('true')
    // not the text panel
    expect(container.textContent).not.toContain('Pattern')
  })

  it('unions get a variants panel', () => {
    render({...schemaLink, oneOf: [{type: 'object'}, {type: 'string'}]})
    expect(container.textContent).toContain('Variant 1')
    expect(container.textContent).toContain('Variant 2')
    expect(container.textContent).toContain('Add variant')
    expect(container.textContent).toContain('tagged union')
  })

  it('shows number bounds for numeric schemas and byte size for bytes', () => {
    render({...schemaLink, type: 'integer'})
    expect(container.textContent).toContain('Minimum')
    expect(container.textContent).toContain('Maximum')
    expect(container.textContent).not.toContain('Pattern')

    render({...schemaLink, kind: 'bytes'})
    expect(container.textContent).toContain('Max size (bytes)')
  })

  it('toggling required updates the schema value', () => {
    render({...schemaLink, type: 'object', properties: {title: {type: 'string'}}})
    const requiredSwitch = Array.from(container.querySelectorAll('button[role="switch"]')).find(
      (el) => el.closest('label')?.textContent?.includes('Required'),
    ) as HTMLButtonElement
    expect(requiredSwitch).toBeTruthy()
    act(() => requiredSwitch.click())
    expect((latest as BlobSchema).required).toEqual(['title'])
  })

  it('turning off extra fields sets additionalProperties: false', () => {
    render({...schemaLink, type: 'object'})
    const extraSwitch = Array.from(container.querySelectorAll('button[role="switch"]')).find(
      (el) => el.closest('label')?.textContent?.includes('Allow fields beyond'),
    ) as HTMLButtonElement
    act(() => extraSwitch.click())
    expect((latest as BlobSchema).additionalProperties).toBe(false)
    // the reserved schema link rides along untouched
    expect((latest as Record<string, unknown>).schema).toEqual(schemaLink.schema)
  })

  it('the add-field form has a Required toggle that stages required membership', () => {
    render({...schemaLink, type: 'object'})
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Add field',
    ) as HTMLButtonElement
    act(() => addButton.click())
    const nameInput = Array.from(container.querySelectorAll('input')).find((el) =>
      el.placeholder.includes('Field name'),
    ) as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, 'headline')
      nameInput.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const requiredSwitch = Array.from(container.querySelectorAll('button[role="switch"]')).find(
      (el) => el.closest('label')?.textContent?.includes('Required'),
    ) as HTMLButtonElement
    act(() => requiredSwitch.click())
    const addCommit = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Add',
    ) as HTMLButtonElement
    act(() => addCommit.click())
    expect(latest as BlobSchema).toMatchObject({
      properties: {headline: {type: 'string'}},
      required: ['headline'],
    })
  })

  it('preserves unknown keywords through form edits', () => {
    render({...schemaLink, type: 'object', 'x-custom': {nested: true}})
    const extraSwitch = Array.from(container.querySelectorAll('button[role="switch"]')).find(
      (el) => el.closest('label')?.textContent?.includes('Allow fields beyond'),
    ) as HTMLButtonElement
    act(() => extraSwitch.click())
    expect((latest as Record<string, unknown>)['x-custom']).toEqual({nested: true})
  })
})
