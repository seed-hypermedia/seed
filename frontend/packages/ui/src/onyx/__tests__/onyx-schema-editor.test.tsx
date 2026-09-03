// @vitest-environment jsdom
import {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {ReactNode} from 'react'
import {TooltipProvider} from '../../tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {isOnyxSchema, kindOf, type OnyxSchema} from '../onyx-engine'
import {emptyStructSchema, OnyxSchemaEditor} from '../onyx-schema-editor'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // Full DOM renders of the editor are slow when the suite runs in parallel.
  vi.setConfig({testTimeout: 20_000})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

// The type picker searches through the app client; the stub answers nothing.
const testClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
const stubUniversalClient = {request: async () => null} as any
function AppShell({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={testClient}>
      <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={stubUniversalClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}

// Controlled wrapper that exposes the latest schema for assertions.
let latest: OnyxSchema
function Harness({initial}: {initial: OnyxSchema}) {
  const [schema, setSchema] = useState(initial)
  latest = schema
  return (
    <AppShell>
      <OnyxSchemaEditor
        schema={schema}
        onSchema={(s) => {
          latest = s
          setSchema(s)
        }}
      />
    </AppShell>
  )
}
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', {bubbles: true})))
const findButton = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!

describe('OnyxSchemaEditor (struct form)', () => {
  it('emptyStructSchema is a valid Onyx map schema', () => {
    const s = emptyStructSchema()
    expect(kindOf(s.type)).toBe('struct')
    expect(isOnyxSchema(s)).toBe(true)
  })

  it('adds a field and stays a valid schema', () => {
    act(() => root.render(<Harness initial={emptyStructSchema()} />))
    click(findButton('Add field'))
    expect(Object.keys(latest.properties ?? {})).toHaveLength(1)
    expect(kindOf(latest.type)).toBe('struct')
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

describe('OnyxSchemaEditor (generics and JSON mode)', () => {
  const MAP = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map'
  const BLOCK = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block'

  it('shows a generic schema’s type parameters and offers them as field kinds', () => {
    act(() => {
      root.render(
        <Harness
          initial={{type: MAP, params: {Block: {ref: BLOCK}}, properties: {body: {var: 'Block'}}, required: []}}
        />,
      )
    })
    const params = container.querySelector('[data-testid="schema-params"]')!
    expect(params.textContent).toContain('Type parameters')
    const nameInput = params.querySelector('input[aria-label="Type parameter name"]') as HTMLInputElement
    expect(nameInput.value).toBe('Block')
    const defInput = params.querySelector('input[aria-label="Default type for Block"]') as HTMLInputElement
    expect(defInput.value).toBe(BLOCK)
    // The field typed by the parameter reads as ⟨Block⟩, not as text.
    expect(container.textContent).toContain('⟨Block⟩')
  })

  it('adding a type parameter makes the schema generic; removing it falls fields back to the default', () => {
    act(() => {
      root.render(<Harness initial={emptyStructSchema()} />)
    })
    click(findButton('Make generic'))
    expect(latest.params).toEqual({T: {ref: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any'}})
    expect(isOnyxSchema(latest)).toBe(true)
    click(findButton('Add field'))
    // Point the new field at the parameter, then drop the parameter.
    act(() => {
      root.render(<Harness key="remount" initial={{...latest, properties: {field: {var: 'T'}}}} />)
    })
    const remove = container.querySelector('button[aria-label="Remove type parameter T"]')!
    click(remove)
    expect(latest.params).toBeUndefined()
    expect(latest.properties.field).toEqual({ref: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any'})
    expect(isOnyxSchema(latest)).toBe(true)
  })

  it('a union is edited as JSON, with the form unavailable', () => {
    act(() => {
      root.render(<Harness initial={{anyOf: [{ref: BLOCK}, {type: MAP, properties: {}, required: []}]}} />)
    })
    const json = container.querySelector('[data-testid="schema-json-editor"] textarea') as HTMLTextAreaElement
    expect(json).toBeTruthy()
    expect(JSON.parse(json.value).anyOf).toHaveLength(2)
    const formTab = [...container.querySelectorAll('button[role="tab"]')].find((b) => b.textContent === 'Fields')!
    expect((formTab as HTMLButtonElement).disabled).toBe(true)
  })

  it('valid JSON commits; a syntax error does not', () => {
    act(() => {
      root.render(<Harness initial={{anyOf: [{ref: BLOCK}]}} />)
    })
    const json = container.querySelector('[data-testid="schema-json-editor"] textarea') as HTMLTextAreaElement
    const setValue = (v: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        setter.call(json, v)
        json.dispatchEvent(new Event('input', {bubbles: true}))
      })
    setValue('{"anyOf": [')
    expect(latest.anyOf).toHaveLength(1)
    expect(container.textContent).toMatch(/JSON|Unexpected|Expected/i)
    setValue(JSON.stringify({anyOf: [{ref: BLOCK}, {ref: MAP}]}))
    expect(latest.anyOf).toHaveLength(2)
  })

  it('a struct with open extra values edits as fields; unchecking closes it', () => {
    const VALUE = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-value'
    act(() => {
      root.render(<Harness initial={{type: MAP, properties: {type: {ref: MAP}}, values: {ref: VALUE}}} />)
    })
    expect(container.querySelector('[data-testid="schema-json-editor"]')).toBeNull()
    const values = container.querySelector('[data-testid="schema-values"]')!
    expect(values.textContent).toContain('other fields allowed')
    click(values.querySelector('button[role="checkbox"]')!)
    expect(latest.values).toBeUndefined()
    expect(latest.properties.type).toEqual({ref: MAP})
  })

  it('Cmd+Z undoes the last edit and Shift+Cmd+Z redoes it', () => {
    act(() => {
      root.render(<Harness initial={emptyStructSchema()} />)
    })
    click(findButton('Add field'))
    expect(Object.keys(latest.properties)).toEqual(['field'])
    const editor = container.querySelector('[data-testid="schema-editor-root"]')!
    const key = (shift: boolean) =>
      act(() => {
        editor.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', metaKey: true, shiftKey: shift, bubbles: true}))
      })
    key(false)
    expect(Object.keys(latest.properties)).toEqual([])
    key(true)
    expect(Object.keys(latest.properties)).toEqual(['field'])
  })
})
