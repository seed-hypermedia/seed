// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createDocumentPageInput} from '@shm/shared/document-page-input'
import {encodePageInput} from '@seed-hypermedia/client/page-input'
import type {SchemaFetchClient} from '@seed-hypermedia/client/schema-resolve'
import {schemaCid} from '@seed-hypermedia/client/schema-engine'
import {DocumentPageParameters} from '../document-page-parameters'

Object.assign(globalThis, {React, IS_REACT_ACT_ENVIRONMENT: true})
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function button(text: string) {
  const element = [...document.querySelectorAll('button')].find((element) => element.textContent === text)
  expect(element, text).toBeDefined()
  return element!
}
async function click(text: string) {
  await act(async () => button(text).click())
}
async function edit(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  expect(element, label).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
async function setup(
  values = {name: 'Initial'} as Record<string, unknown>,
  schema = 'hm://hyper.media/example/person',
) {
  const navigate = vi.fn()
  const onClose = vi.fn()
  const input = createDocumentPageInput({
    schema,
    client: {} as SchemaFetchClient,
    navigate,
    params: encodePageInput(values),
  })
  await act(async () => root.render(<DocumentPageParameters input={input} onClose={onClose} />))
  return {input, navigate, onClose}
}

describe('page parameter form', () => {
  it('renders typed fields and descriptions, applies one URL history entry, and preserves optional values', async () => {
    const {navigate, onClose} = await setup({name: 'Initial', age: 3, active: false, nicknames: ['One']})
    expect(document.body.textContent).toContain("The person's name.")
    expect(document.querySelector<HTMLInputElement>('input[aria-label="age"]')!.type).toBe('number')
    await edit('name', 'Hello & ? # / 🪴')
    await edit('age', '5')
    await act(async () => (document.querySelector('[role="switch"][aria-label="active"]') as HTMLElement).click())
    expect(navigate).not.toHaveBeenCalled()
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      encodePageInput({name: 'Hello & ? # / 🪴', age: 5, active: true, nicknames: ['One']}),
      'push',
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('edits optional and nested values without submitting the form', async () => {
    const {navigate} = await setup({name: 'Initial', nicknames: ['One']})
    await click('+ item')
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => (document.querySelector('[aria-label="Include home"]') as HTMLElement).click())
    expect(document.querySelector('fieldset[aria-label="home"] input')).not.toBeNull()
    await act(async () => (document.querySelector('[aria-label="Include home"]') as HTMLElement).click())
    await act(async () => (document.querySelector('[aria-label="Include nicknames"]') as HTMLElement).click())
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith({name: '"Initial"'}, 'push')
  })

  it('blocks invalid integer and oversized URL values, then allows correction', async () => {
    const {navigate} = await setup({name: 'Initial', age: 3})
    await edit('age', '1.5')
    expect(button('Apply').disabled).toBe(true)
    expect(document.body.textContent).toContain('integer')
    await edit('age', '')
    expect(button('Apply').disabled).toBe(true)
    await edit('age', '4')
    await edit('name', 'x'.repeat(9000))
    expect(button('Apply').disabled).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    await edit('name', 'Valid')
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith({name: '"Valid"', age: '4'}, 'push')
  })

  it('cancels edits without navigating and reloads current values after Back/Forward', async () => {
    const {input, navigate, onClose} = await setup()
    await edit('name', 'Unapplied')
    await click('Cancel')
    expect(onClose).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => input.update({name: '"Earlier"', age: '2'}))
    expect(document.querySelector<HTMLInputElement>('input[aria-label="name"]')!.value).toBe('Earlier')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="age"]')!.value).toBe('2')
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith({name: '"Earlier"', age: '2'}, 'push')
  })

  it('allows a malformed incoming link to be repaired', async () => {
    const {input, navigate} = await setup()
    await act(async () => input.update({name: 'not JSON'}))
    expect(document.body.textContent).toContain('expected a JSON value')
    expect(button('Apply').disabled).toBe(true)
    await edit('name', 'Repaired')
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith({name: '"Repaired"'}, 'push')
  })

  it('shows an empty state and can clear unexpected parameters from an empty contract', async () => {
    const {navigate} = await setup({extra: true}, 'hm://hyper.media/page-input')
    expect(document.body.textContent).toContain('This page has no parameters to edit.')
    expect(button('Apply').disabled).toBe(true)
    await click('Reset')
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith({}, 'push')
  })

  it('retries unavailable published schemas using the real resolver', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        type: 'document',
        document: {metadata: {schemaDefinition: `ipfs://${schemaCid('example/person')}`}},
      })
    const input = createDocumentPageInput({
      schema: 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/types/parameters',
      client: {request} as SchemaFetchClient,
      navigate: vi.fn(),
      params: {name: '"Loaded"'},
    })
    await act(async () => root.render(<DocumentPageParameters input={input} onClose={vi.fn()} />))
    expect(document.body.textContent).toContain('could not be loaded')
    await click('Try again')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="name"]')!.value).toBe('Loaded')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not apply a pending write after the dialog is closed', async () => {
    const {input, navigate} = await setup()
    await edit('name', 'Cancelled')
    act(() => {
      button('Apply').click()
      root.render(null)
    })
    await act(async () => {})
    expect(navigate).not.toHaveBeenCalled()
    expect((await input.read()).values).toEqual({name: 'Initial'})
  })
})
