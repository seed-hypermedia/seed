// @vitest-environment jsdom
// An intersection has a form of its own: the types it combines as chips, their fields read-only,
// and the fields added here as an ordinary field list. Adding the first field creates the inline
// struct part that holds them; removing the last one drops it.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {kindUrl, nameToUrl, STRUCT_URL} from '../engine'
import {fromIntersection, toIntersection, withOwnFields} from '../intersection'
import {SchemaEditor, structFormFits} from '../schema-editor'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
vi.setConfig({testTimeout: 20_000})

const EMPLOYEE = {type: nameToUrl('example/employee')}
const STRING = {type: kindUrl('string')}

describe('intersection editing', () => {
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
  const render = (schema: any, onSchema: (s: any) => void) =>
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider
            openUrl={() => {}}
            openRoute={null}
            universalClient={{request: async () => null} as any}
          >
            <TooltipProvider>
              <SchemaEditor schema={schema} onSchema={onSchema} />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )

  it('opens in the form, showing the included fields', () => {
    const schema = {allOf: [EMPLOYEE]}
    expect(structFormFits(schema)).toBe(true)
    render(schema, () => {})
    expect(container.querySelector('[data-testid="schema-intersection-form"]')).not.toBeNull()
    const sections = Array.from(container.querySelectorAll('[data-testid="schema-intersection-part"]'))
    expect(sections[0]!.textContent).toContain('employeeId')
    expect(sections.at(-1)!.querySelector('h3')?.textContent).toBe('Custom Fields (struct)')
  })

  it('adding a field creates the inline struct part', () => {
    const onSchema = vi.fn()
    render({allOf: [EMPLOYEE]}, onSchema)
    const add = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add field')!
    act(() => add.click())
    const next = onSchema.mock.calls.at(-1)![0]
    expect(next.allOf).toHaveLength(2)
    expect(next.allOf[0]).toEqual(EMPLOYEE)
    expect(next.allOf[1].type).toBe(STRUCT_URL)
    expect(Object.keys(next.allOf[1].properties)).toEqual(['field'])
  })

  it('removing the last own field drops the inline part', () => {
    const schema = {allOf: [EMPLOYEE, {type: STRUCT_URL, properties: {email: {value: STRING}}}]}
    expect(withOwnFields(schema, {type: STRUCT_URL, properties: {}}).allOf).toEqual([EMPLOYEE])
  })

  it('converts to and from a struct, keeping fields and base', () => {
    const ext = {type: EMPLOYEE.type, properties: {email: {value: STRING}}}
    const inter = toIntersection(ext)
    expect(inter.allOf).toEqual([EMPLOYEE, {type: STRUCT_URL, properties: ext.properties}])
    expect(fromIntersection(inter, STRUCT_URL)).toEqual({type: STRUCT_URL, properties: ext.properties})
  })
})
