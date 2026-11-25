// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {HM_SCHEMAS} from '../engine'
import {SchemaDataEditor, SchemaDataEditorPanel, seedValue} from '../data-editor'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('seedValue', () => {
  it('has no default for none, while null has the default null', () => {
    expect(seedValue(HM_SCHEMAS['none'])).toBeUndefined()
    expect(seedValue(HM_SCHEMAS['null'])).toBeNull()
  })
  it('synthesizes a map default with required keys for example-geo', () => {
    const seed = seedValue(HM_SCHEMAS['example/geo']) as Record<string, unknown>
    expect(seed).toMatchObject({lat: 0, lng: 0})
  })

  it('synthesizes the first literal member for example-status', () => {
    expect(seedValue(HM_SCHEMAS['example/status'])).toBe('draft')
  })
})

describe('SchemaDataEditor', () => {
  it('renders none without attempting to select a nonexistent union arm', () => {
    const schema = HM_SCHEMAS['none']
    act(() => {
      root.render(<SchemaDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    expect(container.textContent).toContain('No value satisfies this schema.')
    expect(container.querySelector('select')).toBeNull()
  })
  it('renders map fields (required + optional) for example-geo without throwing', () => {
    const schema = HM_SCHEMAS['example/geo']
    act(() => {
      root.render(<SchemaDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    expect(container.textContent).toContain('lat')
    expect(container.textContent).toContain('lng')
    expect(container.textContent).toContain('altitude') // optional prop label
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0)
  })

  it('renders a <select> of the literal members for example-status', () => {
    const schema = HM_SCHEMAS['example/status']
    act(() => {
      root.render(<SchemaDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    const options = Array.from(container.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['"draft"', '"published"', '"archived"'])
  })

  it('does not display an unselected enum as a valid first choice', () => {
    act(() =>
      root.render(<SchemaDataEditor schema={HM_SCHEMAS['example/status']} value="unknown" onValue={() => {}} />),
    )
    expect(container.querySelector('select')!.value).toBe('')
    expect(container.querySelector('option:checked')!.textContent).toBe('Choose a value')
  })

  it('renders a union variant picker for example-app-block', () => {
    const schema = HM_SCHEMAS['example/app-block']
    act(() => {
      root.render(<SchemaDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    // anyOf → a <select> with one option per arm
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    expect(select!.querySelectorAll('option').length).toBe(schema.anyOf.length)
  })
})

describe('SchemaDataEditor (property defaults)', () => {
  const task = HM_SCHEMAS['example/task-doc']
  const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', {bubbles: true})))

  it('a new value shows its defaults, and an optional field without one stays out', () => {
    const value = seedValue(task) as Record<string, unknown>
    expect(value).toEqual({status: 'todo', priority: 2, tags: [], checklist: {done: false, steps: []}})
    act(() => root.render(<SchemaDataEditor schema={task} value={value} onValue={() => {}} />))
    expect((container.querySelector('select[aria-label="status"]') as HTMLSelectElement).value).toBe('"todo"')
    expect((container.querySelector('input[aria-label="priority"]') as HTMLInputElement).value).toBe('2')
    expect(container.querySelector('[aria-label="Include priority"]')!.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[aria-label="Include due"]')!.getAttribute('aria-checked')).toBe('false')
  })

  it('an optional field that is switched on starts from its default', () => {
    let latest: unknown
    act(() => root.render(<SchemaDataEditor schema={task} value={{status: 'done'}} onValue={(v) => (latest = v)} />))
    click(container.querySelector('[aria-label="Include priority"]')!)
    expect(latest).toMatchObject({status: 'done', priority: 2})
  })

  it('an existing value is shown as it is: a field it lacks is not filled in', () => {
    let calls = 0
    act(() => root.render(<SchemaDataEditor schema={task} value={{status: 'done'}} onValue={() => calls++} />))
    expect(container.querySelector('[aria-label="Include priority"]')!.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector('input[aria-label="priority"]')).toBeNull()
    expect(calls).toBe(0)
  })
})

describe('SchemaDataEditorPanel', () => {
  it('shows a live dag-json preview and a validation status', () => {
    const schema = HM_SCHEMAS['example/geo']
    act(() => {
      root.render(<SchemaDataEditorPanel schema={schema} />)
    })
    expect(container.querySelector('pre')?.textContent).toContain('"lat"')
    // a seeded geo point is valid
    expect(container.textContent).toContain('valid')
  })
})
