// @vitest-environment jsdom
import {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {isOnyxSchema, kindOf, type OnyxSchema} from '../onyx-engine'
import {emptyStructSchema, OnyxSchemaEditor} from '../onyx-schema-editor'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

// Controlled wrapper that exposes the latest schema for assertions.
let latest: OnyxSchema
function Harness({initial}: {initial: OnyxSchema}) {
  const [schema, setSchema] = useState(initial)
  latest = schema
  return (
    <TooltipProvider>
      <OnyxSchemaEditor
        schema={schema}
        onSchema={(s) => {
          latest = s
          setSchema(s)
        }}
      />
    </TooltipProvider>
  )
}
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', {bubbles: true})))
const findButton = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!

describe('OnyxSchemaEditor (struct form)', () => {
  it('emptyStructSchema is a valid Onyx map schema', () => {
    const s = emptyStructSchema()
    expect(kindOf(s.type)).toBe('map')
    expect(isOnyxSchema(s)).toBe(true)
  })

  it('adds a field and stays a valid schema', () => {
    act(() => root.render(<Harness initial={{...emptyStructSchema(), name: 'Person'}} />))
    click(findButton('Add field'))
    expect(Object.keys(latest.properties ?? {})).toHaveLength(1)
    expect(kindOf(latest.type)).toBe('map')
    expect(isOnyxSchema(latest)).toBe(true)
    // the field defaults to a text/string property
    const first = Object.values(latest.properties ?? {})[0] as OnyxSchema
    expect(kindOf(first.type)).toBe('string')
  })

  it('required is derived from the per-field checkbox, not authored as an array', () => {
    act(() =>
      root.render(<Harness initial={{type: 'hm://hyper.media/map', name: 'T', properties: {}, required: []}} />),
    )
    click(findButton('Add field'))
    // toggle the required checkbox for the new field
    const checkbox = container.querySelector('[role="checkbox"]') as HTMLElement
    expect(checkbox).toBeTruthy()
    click(checkbox)
    const fieldName = Object.keys(latest.properties ?? {})[0]!
    expect(latest.required).toContain(fieldName)
    // untoggle → removed from required
    click(container.querySelector('[role="checkbox"]') as HTMLElement)
    expect(latest.required ?? []).not.toContain(fieldName)
  })

  it('removing a field also clears it from required', () => {
    act(() =>
      root.render(
        <Harness
          initial={{
            type: 'hm://hyper.media/map',
            name: 'T',
            properties: {a: {type: 'hm://hyper.media/string'}},
            required: ['a'],
          }}
        />,
      ),
    )
    click(container.querySelector('[aria-label="Remove a"]')!)
    expect(Object.keys(latest.properties ?? {})).toHaveLength(0)
    expect(latest.required ?? []).not.toContain('a')
  })
})
