// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {SchemaDocPage} from '../explorer'

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
    root.render(<SchemaDocPage slug={slug} nav={() => {}} />)
  })
}

describe('SchemaDocPage renders every schema shape without crashing', () => {
  it('the meta-schema (discriminated union)', () => {
    renderPage('schema')
    expect(container.querySelector('[data-testid="schema-union-lead"]')?.textContent).toMatch(/one of \d+ variants/)
  })

  it('a primitive (self-grounding axiom)', () => {
    renderPage('string')
    expect(container.textContent).toContain('Core Type')
  })

  it('a meta variant', () => {
    renderPage('schema/map-schema')
    expect(container.textContent?.toLowerCase()).toContain('variant')
  })

  it('a closed struct with a fields table', () => {
    renderPage('example/person')
    expect(container.querySelector('table')).toBeTruthy()
    // Required is implied; only optional fields are marked.
    expect(container.textContent).toContain('optional')
    expect(container.textContent).not.toContain('required')
  })

  it('an extension (inherited/added origins)', () => {
    renderPage('example/employee')
    expect(container.textContent?.toLowerCase()).toContain('extends')
    // No column headings and no field count; only optional and inheritance are noted.
    expect(container.querySelectorAll('th')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/\d+ fields?|field\(s\)/)
    const text = container.textContent ?? ''
    expect(text).toContain('optional')
    expect(text).toContain('inherited')
    expect(text).not.toContain('added')
    expect(text).not.toContain('req ')
    expect(text).not.toContain('·req')
  })

  it('an extension names the type it refines', () => {
    renderPage('example/employee')
    expect(container.querySelector('[data-testid="schema-extends"]')?.textContent).toMatch(/person/i)
  })
})

describe('nested structs', () => {
  it('a struct field expands its own fields in place (rpc/type/raw-citation.sourceBlob)', () => {
    renderPage('rpc/type/raw-citation')
    const nested = container.querySelector('[data-testid="schema-nested-fields-sourceBlob"]')
    expect(nested).toBeTruthy()
    for (const f of ['cid', 'author', 'createTime']) expect(nested!.textContent).toContain(f)
  })
})
