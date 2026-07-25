// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ONYX_SCHEMAS} from '../onyx-engine'
import {OnyxDataEditor, OnyxDataEditorPanel, seedValue} from '../onyx-data-editor'
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
  it('synthesizes a map default with required keys for example-geo', () => {
    const seed = seedValue(ONYX_SCHEMAS['example-geo']) as Record<string, unknown>
    expect(seed).toMatchObject({lat: 0, lng: 0})
  })

  it('synthesizes the first enum member for example-status', () => {
    expect(seedValue(ONYX_SCHEMAS['example-status'])).toBe('draft')
  })
})

describe('OnyxDataEditor', () => {
  it('renders map fields (required + optional) for example-geo without throwing', () => {
    const schema = ONYX_SCHEMAS['example-geo']
    act(() => {
      root.render(<OnyxDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    expect(container.textContent).toContain('lat')
    expect(container.textContent).toContain('lng')
    expect(container.textContent).toContain('altitude') // optional prop label
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0)
  })

  it('renders an enum <select> for example-status', () => {
    const schema = ONYX_SCHEMAS['example-status']
    act(() => {
      root.render(<OnyxDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    const options = Array.from(container.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['"draft"', '"published"', '"archived"'])
  })

  it('renders a union variant picker for example-app-block', () => {
    const schema = ONYX_SCHEMAS['example-app-block']
    act(() => {
      root.render(<OnyxDataEditor schema={schema} value={seedValue(schema)} onValue={() => {}} />)
    })
    // anyOf → a <select> with one option per arm
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    expect(select!.querySelectorAll('option').length).toBe(schema.anyOf.length)
  })
})

describe('OnyxDataEditorPanel', () => {
  it('shows a live dag-json preview and a validation status', () => {
    const schema = ONYX_SCHEMAS['example-geo']
    act(() => {
      root.render(<OnyxDataEditorPanel schema={schema} />)
    })
    expect(container.querySelector('pre')?.textContent).toContain('"lat"')
    // a seeded geo point is valid
    expect(container.textContent).toContain('valid')
  })
})
