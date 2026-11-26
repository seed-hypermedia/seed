// @vitest-environment jsdom
// An inline struct reads as its fields wherever it sits — an allOf or anyOf arm, list items, map
// values — rather than a bare "struct" badge; and an intersection whose arm names a type published
// outside the bundled library still shows its merged fields once that type is fetched.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {kindUrl, nameToUrl} from '../engine'
import {SchemaView} from '../explorer'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const STRING = {type: kindUrl('string')}
const CONTACT = {
  type: kindUrl('struct'),
  properties: {
    email: {value: STRING, required: true},
    phone: {value: STRING},
  },
}

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
const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

const mount = (schema: any, request: any = vi.fn(async () => ({}))) =>
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request} as any}>
          <TooltipProvider>
            <SchemaView schema={schema} nav={() => {}} hideIdentity />
          </TooltipProvider>
        </UniversalAppProvider>
      </QueryClientProvider>,
    ),
  )

const armText = (testid: string) => container.querySelector(`[data-testid="${testid}"] ul`)?.textContent ?? ''

describe('inline structs show their fields', () => {
  it('an intersection reads as its merged fields', () => {
    mount({allOf: [{type: nameToUrl('example/employee')}, CONTACT]})
    const heading = container.querySelector('[data-testid="schema-intersection-heading"]')?.textContent ?? ''
    expect(heading).toContain('all fields of')
    const rows = Array.from(container.querySelectorAll('[data-testid="schema-merged-fields"] tbody > tr'))
    const row = (name: string) => rows.find((r) => r.querySelector('td')?.textContent?.startsWith(name))
    expect(row('employeeId')).toBeDefined()
    expect(row('email')).toBeDefined()
    expect(row('phone')?.textContent).toContain('optional')
  })

  it('an inline anyOf arm', () => {
    mount({anyOf: [STRING, CONTACT]})
    expect(armText('schema-union-variants')).toContain('email')
  })

  it('an inline struct nested in a field union, list items and map values', () => {
    mount({
      type: kindUrl('struct'),
      properties: {
        either: {value: {anyOf: [STRING, CONTACT]}},
        people: {value: {type: kindUrl('list'), items: CONTACT}},
        byName: {value: {type: kindUrl('map'), values: CONTACT}},
      },
    })
    // Each of the three fields opens the contact struct once.
    expect(container.querySelectorAll('[data-testid="schema-inline-fields"]').length).toBe(3)
  })
})

describe('an intersection over a published type', () => {
  const EMPLOYEE_URL = 'hm://z6MkPublisher/types/employee'
  const EMPLOYEE_CID = 'bafyreigw2do5u2yk43d5pbxvalgpakw3q7z6uqaefjkbl2dwlgpbc4efua'
  const EMPLOYEE = {
    type: kindUrl('struct'),
    properties: {employeeId: {value: STRING, required: true}},
  }

  it('fetches the arm, then shows every merged field', async () => {
    const request = vi.fn(async (key: string, input: any) => {
      if (key === 'Resource')
        return {
          type: 'document',
          id: input,
          document: {metadata: {schemaDefinition: `ipfs://${EMPLOYEE_CID}`}},
        }
      if (key === 'GetCID' && input.cid === EMPLOYEE_CID) return {value: EMPLOYEE}
      return {}
    })
    mount({allOf: [{type: EMPLOYEE_URL}, CONTACT]}, request)
    await flush()
    await flush()
    const merged = container.querySelector('[data-testid="schema-merged-fields"]')?.textContent ?? ''
    expect(merged).toContain('employeeId')
    expect(merged).toContain('email')
  })

  it('keeps fetching while the arm is not found, then says which arm is missing', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true})
    try {
      const request = vi.fn(async () => ({type: 'not-found'}))
      mount({allOf: [{type: EMPLOYEE_URL}, CONTACT]}, request)
      await flush()
      expect(container.querySelector('[data-testid="schema-merged-loading"]')).not.toBeNull()
      for (let i = 0; i < 20; i++)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000)
        })
      expect(request.mock.calls.length).toBeGreaterThan(5)
      expect(container.querySelector('[data-testid="schema-merged-missing"]')?.textContent).toContain('types/employee')
    } finally {
      vi.useRealTimers()
    }
  })
})
