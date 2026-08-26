// @vitest-environment jsdom
// The schema editor's "Signed blob type" toggle: on → the schema extends the
// envelope (ref hypermedia-blob, no root type) and pins a `type` tag; off → a
// plain struct again. The pinned `type` never shows as an editable field row.
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {MAP_URL, nameToUrl} from '../onyx-engine'
import {emptyStructSchema, isSignedBlobType, OnyxSchemaEditor} from '../onyx-schema-editor'
import {isSignedBlobSchema, signedBlobTypeTag} from '../signed-blob'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('schema editor — signed blob type', () => {
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

  it('toggling on extends the envelope and pins a type tag from the name; off restores a struct', () => {
    let schema: any = {...emptyStructSchema(), name: 'Vote'}
    const render = () =>
      act(() =>
        root.render(
          <TooltipProvider>
            <OnyxSchemaEditor schema={schema} onSchema={(s) => (schema = s)} />
          </TooltipProvider>,
        ),
      )
    render()
    const toggle = container.querySelector('[aria-label="Signed blob type"]') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    act(() => toggle.click())
    expect(isSignedBlobType(schema)).toBe(true)
    expect(schema.ref).toBe(nameToUrl('hypermedia-blob'))
    expect(schema.type).toBeUndefined()
    expect(schema.properties.type.enum).toEqual(['Vote'])
    expect(schema.required).toContain('type')
    // The engine sees a real signed-blob schema with the tag.
    expect(isSignedBlobSchema(schema)).toBe(true)
    expect(signedBlobTypeTag(schema)).toBe('Vote')

    render()
    // The pinned type is not offered as an editable field row; the tag input is.
    expect(
      Array.from(container.querySelectorAll('[aria-label="Field name"]')).map((i) => (i as HTMLInputElement).value),
    ).toEqual([])
    expect((container.querySelector('[aria-label="Type tag"]') as HTMLInputElement).value).toBe('Vote')

    act(() => (container.querySelector('[aria-label="Signed blob type"]') as HTMLButtonElement).click())
    expect(isSignedBlobType(schema)).toBe(false)
    expect(schema.type).toBe(MAP_URL)
    expect(schema.properties.type).toBeUndefined()
    expect(schema.required).not.toContain('type')
  })
})
