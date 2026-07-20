// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {OnyxExplorer, OnyxSchemaPage} from '../onyx-explorer'

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

const renderPage = (slug: string) => {
  act(() => {
    root.render(<OnyxSchemaPage slug={slug} nav={() => {}} />)
  })
}

describe('OnyxSchemaPage renders every schema shape without crashing', () => {
  it('the meta-schema (discriminated union)', () => {
    renderPage('onyx-schema')
    expect(container.textContent).toContain('Onyx schema')
    expect(container.textContent).toContain('meta-schema')
  })

  it('a primitive (self-grounding axiom)', () => {
    renderPage('onyx-string')
    expect(container.textContent).toContain('primitive')
  })

  it('a meta variant', () => {
    renderPage('onyx-map-schema')
    expect(container.textContent?.toLowerCase()).toContain('variant')
  })

  it('a closed struct with a fields table', () => {
    renderPage('example-person')
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.textContent?.toLowerCase()).toContain('required')
  })

  it('an extension (inherited/added origins)', () => {
    renderPage('example-employee')
    expect(container.textContent?.toLowerCase()).toContain('extends')
  })

  it('an instance validates against its $type', () => {
    renderPage('example-bob')
    expect(container.textContent?.toLowerCase()).toContain('instance')
  })

  it('the full explorer mounts with the catalog', () => {
    act(() => {
      root.render(<OnyxExplorer initialSlug="onyx-schema" />)
    })
    expect(container.textContent).toContain('Meta-schema') // catalog section
    expect(container.textContent).toContain('Primitives')
  })
})
