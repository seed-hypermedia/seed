// @vitest-environment jsdom
import {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {ReactNode} from 'react'
import {TooltipProvider} from '../../tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {
  type HypermediaSchema,
  fieldSchema,
  isHypermediaSchema,
  kindOf,
  requiredFieldNames,
  structFields,
} from '../engine'
import {emptyStructSchema, SchemaEditor} from '../schema-editor'

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
let latest: HypermediaSchema
function Harness({initial}: {initial: HypermediaSchema}) {
  const [schema, setSchema] = useState(initial)
  latest = schema
  return (
    <AppShell>
      <SchemaEditor
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

describe('SchemaEditor (struct form)', () => {
  it('emptyStructSchema is a valid map schema', () => {
    const s = emptyStructSchema()
    expect(kindOf(s.type)).toBe('struct')
    expect(isHypermediaSchema(s)).toBe(true)
  })

  it('adds a field and stays a valid schema', () => {
    act(() => root.render(<Harness initial={emptyStructSchema()} />))
    click(findButton('Add field'))
    expect(Object.keys(latest.properties ?? {})).toHaveLength(1)
    expect(kindOf(latest.type)).toBe('struct')
    expect(isHypermediaSchema(latest)).toBe(true)
    // the field defaults to a text/string property
    const first = structFields(latest)[0]!.schema
    expect(kindOf(first.type)).toBe('string')
  })

  it('required is derived from the per-field checkbox, not authored as an array', () => {
    act(() =>
      root.render(
        <Harness initial={{type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/struct', properties: {}}} />,
      ),
    )
    click(findButton('Add field'))
    // toggle the required checkbox for the new field
    const checkbox = container.querySelector('[role="checkbox"]') as HTMLElement
    expect(checkbox).toBeTruthy()
    click(checkbox)
    const fieldName = Object.keys(latest.properties ?? {})[0]!
    expect(requiredFieldNames(latest)).toContain(fieldName)
    // untoggle → removed from required
    click(container.querySelector('[role="checkbox"]') as HTMLElement)
    expect(requiredFieldNames(latest)).not.toContain(fieldName)
  })

  it('removing a field also clears it from required', () => {
    act(() =>
      root.render(
        <Harness
          initial={{
            type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/struct',
            name: 'T',
            properties: {
              a: {
                value: {type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string'},
                required: true,
              },
            },
          }}
        />,
      ),
    )
    click(container.querySelector('[aria-label="Remove a"]')!)
    expect(Object.keys(latest.properties ?? {})).toHaveLength(0)
    expect(requiredFieldNames(latest)).not.toContain('a')
  })
})

describe('SchemaEditor (nested structs)', () => {
  const STRUCT = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/struct'
  const STRING = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string'
  const initial: HypermediaSchema = {
    type: STRUCT,
    properties: {
      source: {value: {ref: STRING}, required: true},
      sourceBlob: {value: {type: STRUCT, properties: {cid: {value: {ref: STRING}}}}},
    },
  }
  const setInput = (el: HTMLInputElement, value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, value)
      el.dispatchEvent(new Event('input', {bubbles: true}))
    })
  const inner = () => fieldSchema(latest, 'sourceBlob')!

  it('shows and edits the fields of a struct inside a struct', () => {
    act(() => root.render(<Harness initial={initial} />))
    const nested = container.querySelector('[data-testid="schema-nested-struct"]')!
    expect(nested).toBeTruthy()
    expect((nested.querySelector('input[aria-label="Field name in sourceBlob"]') as HTMLInputElement).value).toBe('cid')
    expect(nested.querySelector('input[aria-label="Type of sourceBlob.cid"]')).toBeTruthy()

    // rename, require, describe, add and remove — all land inside the inner struct
    setInput(nested.querySelector('input[aria-label="Field name in sourceBlob"]') as HTMLInputElement, 'hash')
    expect(structFields(inner()).map((f) => f.name)).toEqual(['hash'])
    click(container.querySelector('[aria-label="Required sourceBlob.hash"]')!)
    expect(requiredFieldNames(inner())).toEqual(['hash'])
    setInput(
      container.querySelector('input[aria-label="Description of sourceBlob.hash"]') as HTMLInputElement,
      'the CID',
    )
    expect(structFields(inner())[0]!.description).toBe('the CID')
    click(container.querySelector('[aria-label="Add field to sourceBlob"]')!)
    expect(structFields(inner()).map((f) => f.name)).toEqual(['hash', 'field'])
    click(container.querySelector('[aria-label="Remove sourceBlob.field"]')!)
    expect(structFields(inner()).map((f) => f.name)).toEqual(['hash'])

    // the outer struct is untouched and the whole thing stays a valid schema
    expect(structFields(latest).map((f) => f.name)).toEqual(['source', 'sourceBlob'])
    expect(requiredFieldNames(latest)).toEqual(['source'])
    expect(kindOf(inner().type)).toBe('struct')
    expect(isHypermediaSchema(latest)).toBe(true)
  })

  it('recurses: a struct inside a list inside a struct inside a struct', () => {
    const LIST = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/list'
    const deep: HypermediaSchema = {
      type: STRUCT,
      properties: {
        a: {
          value: {
            type: STRUCT,
            properties: {b: {value: {type: LIST, items: {type: STRUCT, properties: {c: {value: {ref: STRING}}}}}}},
          },
        },
      },
    }
    act(() => root.render(<Harness initial={deep} />))
    expect(container.querySelectorAll('[data-testid="schema-nested-struct"]')).toHaveLength(2)
    const c = container.querySelector('input[aria-label="Field name in a.b item"]') as HTMLInputElement
    expect(c.value).toBe('c')
    setInput(c, 'd')
    const items = fieldSchema(fieldSchema(latest, 'a'), 'b')!.items
    expect(structFields(items).map((f) => f.name)).toEqual(['d'])
    expect(isHypermediaSchema(latest)).toBe(true)
  })
})

describe('SchemaEditor (generics and JSON mode)', () => {
  const MAP = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map'
  const STRUCT = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/struct'
  const BLOCK = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/block'

  it('shows a generic schema’s type parameters and offers them as field kinds', () => {
    act(() => {
      root.render(
        <Harness
          initial={{type: STRUCT, params: {Block: {ref: BLOCK}}, properties: {body: {value: {var: 'Block'}}}}}
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
    const typeInput = container.querySelector('input[aria-label="Type of body"]') as HTMLInputElement
    expect(typeInput.value).toBe('⟨Block⟩')
  })

  it('adding a type parameter makes the schema generic; removing it falls fields back to the default', () => {
    act(() => {
      root.render(<Harness initial={emptyStructSchema()} />)
    })
    click(findButton('Make generic'))
    expect(latest.params).toEqual({T: {ref: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any'}})
    expect(isHypermediaSchema(latest)).toBe(true)
    click(findButton('Add field'))
    // Point the new field at the parameter, then drop the parameter.
    act(() => {
      root.render(<Harness key="remount" initial={{...latest, properties: {field: {value: {var: 'T'}}}}} />)
    })
    const remove = container.querySelector('button[aria-label="Remove type parameter T"]')!
    click(remove)
    expect(latest.params).toBeUndefined()
    expect(fieldSchema(latest, 'field')).toEqual({
      ref: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any',
    })
    expect(isHypermediaSchema(latest)).toBe(true)
  })

  it('a union edits its options in the form: each option a type, add and remove', () => {
    act(() => {
      root.render(<Harness initial={{anyOf: [{ref: BLOCK}, {type: STRUCT, properties: {}}]}} />)
    })
    expect(container.querySelector('[data-testid="schema-json-editor"]')).toBeNull()
    const rootType = container.querySelector('input[aria-label="Root type"]') as HTMLInputElement
    expect(rootType.value).toBe('Union')
    const options = container.querySelector('[data-testid="schema-union-options"]')!
    expect(options.querySelectorAll('input[aria-label^="union option"]')).toHaveLength(2)
    click(findButton('Add option'))
    expect(latest.anyOf).toHaveLength(3)
    click(container.querySelector('button[aria-label="Remove union option 1"]')!)
    expect(latest.anyOf).toHaveLength(2)
    expect(isHypermediaSchema(latest)).toBe(true)
  })

  it('a list root edits its item type', () => {
    act(() => {
      root.render(
        <Harness initial={{type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/list', items: {ref: BLOCK}}} />,
      )
    })
    expect(container.querySelector('[data-testid="schema-list-items"] input')).toBeTruthy()
    expect(container.textContent).not.toContain('Add field')
  })

  it('valid JSON commits; a syntax error does not', () => {
    act(() => {
      root.render(<Harness initial={{anyOf: [{ref: BLOCK}]}} />)
    })
    click([...container.querySelectorAll('button[role="tab"]')].find((b) => b.textContent === 'JSON')!)
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
    const VALUE = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/value'
    act(() => {
      root.render(<Harness initial={{type: STRUCT, properties: {type: {value: {ref: MAP}}}, values: {ref: VALUE}}} />)
    })
    expect(container.querySelector('[data-testid="schema-json-editor"]')).toBeNull()
    const values = container.querySelector('[data-testid="schema-values"]')!
    expect(values.textContent).toContain('other fields allowed')
    click(values.querySelector('button[role="checkbox"]')!)
    expect(latest.values).toBeUndefined()
    expect(fieldSchema(latest, 'type')).toEqual({ref: MAP})
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
