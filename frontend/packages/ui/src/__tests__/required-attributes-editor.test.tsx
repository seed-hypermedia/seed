// @vitest-environment jsdom
import {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ONYX_SCHEMAS, type OnyxSchema} from '../onyx/onyx-engine'
import {metadataSchemaOf} from '../onyx/onyx-schema-resolve'
import {RequiredAttributesEditor} from '../required-attributes-editor'
import {TooltipProvider} from '../tooltip'

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

/** Controlled wrapper exposing the latest staged patches. */
let patches: Record<string, unknown>[] = []
function Harness({schema, initial}: {schema?: OnyxSchema; initial: Record<string, unknown>}) {
  const [meta, setMeta] = useState(initial)
  return (
    <TooltipProvider>
      <RequiredAttributesEditor
        conformanceSchema={schema}
        metadata={meta as any}
        onMetadata={(patch) => {
          patches.push(patch)
          setMeta((m) => ({...m, ...patch}))
        }}
      />
    </TooltipProvider>
  )
}

// The person document requires metadata.surname; its metadata sub-schema is the
// conformance schema the caller resolves and passes down.
const personMetaSchema = () => metadataSchemaOf(ONYX_SCHEMAS['example-person-doc'])!

describe('RequiredAttributesEditor', () => {
  beforeEach(() => {
    patches = []
  })

  it('renders nothing when the document has no conformance schema', () => {
    act(() => root.render(<Harness initial={{name: 'X'}} />))
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the schema declares no required custom fields', () => {
    // A schema requiring only standard/header fields yields no required rows.
    act(() => root.render(<Harness schema={ONYX_SCHEMAS['hypermedia-metadata']} initial={{name: 'X'}} />))
    expect(container.textContent).toBe('')
  })

  it('shows the required custom field (surname) as an always-visible row', () => {
    act(() => root.render(<Harness schema={personMetaSchema()} initial={{name: 'X'}} />))
    expect(container.textContent).toContain('surname')
    // The standard/binding fields are NOT rows here.
    expect(container.querySelector('[title="schema"]')).toBeNull()
    expect(container.querySelector('[title="name"]')).toBeNull()
  })

  it('does not write the seeded value into metadata until edited', () => {
    act(() => root.render(<Harness schema={personMetaSchema()} initial={{name: 'X'}} />))
    // Rendering alone stages nothing — the draft is not polluted with a seed.
    expect(patches).toHaveLength(0)
    // The seeded required field renders an editable input wired to onMetadata.
    expect(container.querySelector('input')).not.toBeNull()
  })
})
