// @vitest-environment jsdom
// The schema editor's Root kind: 'signed' → the schema extends the envelope
// (ref hypermedia-blob, no root type) and pins a `type` tag; 'struct' → a plain
// struct again; 'extends' → rooted on any pasted base ref. The pinned `type`
// never shows as an editable field row. Transitions are the pure withRootKind;
// the component renders the matching controls (tag input / base-ref input).
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {MAP_URL, nameToUrl} from '../onyx-engine'
import {emptyStructSchema, isSignedBlobType, OnyxSchemaEditor, withRootKind} from '../onyx-schema-editor'
import {isSignedBlobSchema, signedBlobTypeTag} from '../signed-blob'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('schema root kind', () => {
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

  const render = (schema: any, onSchema: (s: any) => void = () => {}) =>
    act(() =>
      root.render(
        <TooltipProvider>
          <OnyxSchemaEditor schema={schema} onSchema={onSchema} />
        </TooltipProvider>,
      ),
    )

  it('signed extends the envelope and pins a default type tag; struct restores a plain map', () => {
    let schema: any = emptyStructSchema()
    schema = withRootKind(schema, 'signed')
    expect(isSignedBlobType(schema)).toBe(true)
    expect(schema.ref).toBe(nameToUrl('hypermedia-blob'))
    expect(schema.type).toBeUndefined()
    // Schemas carry no name, so the pinned tag starts as the editable default.
    expect(schema.properties.type.enum).toEqual(['Custom'])
    expect(schema.required).toContain('type')
    // The engine sees a real signed-blob schema with the tag.
    expect(isSignedBlobSchema(schema)).toBe(true)
    expect(signedBlobTypeTag(schema)).toBe('Custom')

    render(schema)
    // The pinned type is not offered as an editable field row; the tag input is.
    expect(
      Array.from(container.querySelectorAll('[aria-label="Field name"]')).map((i) => (i as HTMLInputElement).value),
    ).toEqual([])
    expect((container.querySelector('[aria-label="Type tag"]') as HTMLInputElement).value).toBe('Custom')

    schema = withRootKind(schema, 'struct')
    expect(isSignedBlobType(schema)).toBe(false)
    expect(schema.type).toBe(MAP_URL)
    expect(schema.properties.type).toBeUndefined()
    expect(schema.required).not.toContain('type')
  })

  it('extends roots the schema on any base ref, editable in the base-ref input, and fields survive', () => {
    let schema: any = {
      ...emptyStructSchema(),
      properties: {permissions: {type: MAP_URL}},
      required: ['permissions'],
    }
    schema = withRootKind(schema, 'extends')
    expect(schema.type).toBeUndefined()
    expect(schema.ref).toBe('')
    expect(schema.properties.permissions).toBeTruthy()
    expect(schema.required).toContain('permissions')

    let latest: any = schema
    render(schema, (s) => (latest = s))
    const refInput = container.querySelector('[aria-label="Base type ref"]') as HTMLInputElement
    expect(refInput).toBeTruthy()
    // Typing a base ref roots the extension on it.
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(refInput, 'ipfs://bafyBase')
      refInput.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(latest.ref).toBe('ipfs://bafyBase')
    expect(latest.type).toBeUndefined()

    // Leaving signed for extends keeps a non-envelope base; envelope refs never leak into it.
    const signed = withRootKind(emptyStructSchema(), 'signed')
    const extended = withRootKind(signed, 'extends')
    expect(extended.ref).toBe('')
    expect(extended.properties.type).toBeUndefined()
    expect(extended.required).not.toContain('type')
  })
})
