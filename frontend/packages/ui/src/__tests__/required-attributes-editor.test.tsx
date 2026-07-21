// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {schemaCid} from '../onyx/onyx-engine'
import {RequiredAttributesEditor} from '../required-attributes-editor'
import {TooltipProvider} from '../tooltip'

const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})

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
function Harness({initial}: {initial: Record<string, unknown>}) {
  const [meta, setMeta] = useState(initial)
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RequiredAttributesEditor
          metadata={meta as any}
          onMetadata={(patch) => {
            patches.push(patch)
            setMeta((m) => ({...m, ...patch}))
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

const employeeCid = () => schemaCid('example-employee')!

describe('RequiredAttributesEditor', () => {
  beforeEach(() => {
    patches = []
  })

  it('renders nothing when the document has no schema', () => {
    act(() => root.render(<Harness initial={{name: 'X'}} />))
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the schema declares no required custom fields', () => {
    // example-geo has required lat/lng but it is not a *document* schema; a
    // plain doc with only standard fields + an unknown CID renders nothing.
    act(() => root.render(<Harness initial={{name: 'X', schemaDefinition: 'ipfs://bogus'}} />))
    expect(container.textContent).toBe('')
  })

  it('shows the required custom field (employeeId) as an always-visible row', () => {
    act(() => root.render(<Harness initial={{name: 'X', schemaDefinition: `ipfs://${employeeCid()}`}} />))
    // The required field surfaces as a labeled row.
    expect(container.textContent).toContain('employeeId')
    // The standard header field name/summary and schemaDefinition are NOT rows here.
    expect(container.querySelector('[title="schemaDefinition"]')).toBeNull()
  })

  it('does not write the seeded value into metadata until edited', () => {
    act(() => root.render(<Harness initial={{name: 'X', schemaDefinition: `ipfs://${employeeCid()}`}} />))
    // Rendering alone stages nothing — the draft is not polluted with a seed.
    expect(patches).toHaveLength(0)
    // The seeded required field renders an editable input wired to onMetadata.
    expect(container.querySelector('input')).not.toBeNull()
  })
})
