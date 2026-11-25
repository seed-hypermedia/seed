// @vitest-environment jsdom
import {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {HM_SCHEMAS, type HypermediaSchema} from '../schema/engine'
import {metadataSchemaOf} from '../schema/schema-resolve'
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
function Harness({schema, initial}: {schema?: HypermediaSchema; initial: Record<string, unknown>}) {
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
const personMetaSchema = () => metadataSchemaOf(HM_SCHEMAS['example/person-doc'])!

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
    act(() => root.render(<Harness schema={HM_SCHEMAS['metadata']} initial={{name: 'X'}} />))
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

  it('shows readers the required fields read-only: the value, or "not set"', () => {
    const employee = metadataSchemaOf(HM_SCHEMAS['example/admin'])!
    act(() =>
      root.render(
        <TooltipProvider>
          <RequiredAttributesEditor conformanceSchema={employee} metadata={{name: 'X', employeeId: 'E-42'} as any} />
        </TooltipProvider>,
      ),
    )
    const block = container.querySelector('[data-testid="required-attributes"]')!
    expect(block.textContent).toContain('employeeId')
    expect(block.textContent).toContain('E-42')
    expect(block.textContent).toContain('permissions')
    expect(block.textContent).toContain('not set')
    // no editing affordances
    expect(block.querySelector('input')).toBeNull()
  })

  // A required field that picks from options and has no value shows the options with nothing
  // selected, beside the "is required" warning; a value the document holds shows as selected.
  const taskSchema: HypermediaSchema = {
    type: 'hm://hyper.media/struct',
    properties: {Priority: {value: {anyOf: ['High', 'Medium', 'Low']}, required: true}},
  }

  it('shows an unset required enum as an empty select, not as its first option', () => {
    act(() => root.render(<Harness schema={taskSchema} initial={{name: 'X'}} />))
    const trigger = container.querySelector('[role="combobox"]')
    expect(trigger).not.toBeNull()
    expect(trigger!.hasAttribute('data-unset')).toBe(true)
    expect(trigger!.textContent).not.toContain('High')
    expect(trigger!.textContent).toContain('Select')
    expect(patches).toEqual([])
  })

  it('shows a held enum value as the selected option', () => {
    act(() => root.render(<Harness schema={taskSchema} initial={{name: 'X', Priority: 'Medium'}} />))
    const trigger = container.querySelector('[role="combobox"]')
    expect(trigger!.hasAttribute('data-unset')).toBe(false)
    expect(trigger!.textContent).toContain('Medium')
  })

  it('shows a blank enum value as an empty select rather than a text box', () => {
    act(() => root.render(<Harness schema={taskSchema} initial={{name: 'X', Priority: ''}} />))
    const trigger = container.querySelector('[role="combobox"]')
    expect(trigger).not.toBeNull()
    expect(trigger!.hasAttribute('data-unset')).toBe(true)
  })
})
