// @vitest-environment jsdom
import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {queryClient} from '@shm/shared/models/query-client'
import {UniversalAppProvider} from '@shm/shared/routing'
import type {UniversalClient} from '@shm/shared/universal-client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {HMEntityField} from '../hm-entity-field'

let container: HTMLDivElement
let root: Root
let client: QueryClient

const accounts: HMMentionCandidate[] = ['Alice', 'Bea', 'Bea'].map((title) => ({
  id: hmId(title.toLowerCase(), {path: [':profile'], version: 'version'}),
  type: 'account',
  title,
  icon: '',
  parentNames: [],
  searchQuery: '',
  sameSite: false,
  issuedContact: false,
}))

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  client = new QueryClient({defaultOptions: {queries: {retry: false}}})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  client.clear()
  queryClient.clear()
})

function renderField() {
  const onValue = vi.fn()
  const universalClient = {
    request: async (key: string) => (key === 'MentionCandidates' ? accounts : null),
    fetchRecents: async () => [],
  } as unknown as UniversalClient
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={universalClient}>
          <HMEntityField value="" mode="profile" onValue={onValue} />
        </UniversalAppProvider>
      </QueryClientProvider>,
    )
  })
  const input = container.querySelector('input')!
  act(() => input.focus())
  return {input, onValue}
}

function pressKey(input: HTMLInputElement, key: string) {
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true})))
}

function enterText(input: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

async function waitForAccounts(count: number) {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.querySelectorAll('[role="option"]:not(:disabled)')).toHaveLength(count)
  })
}

describe('profile mention selection', () => {
  it('offers unique accounts on focus and saves keyboard selection as a bare account URL', async () => {
    const {input, onValue} = renderField()
    await waitForAccounts(2)
    pressKey(input, 'ArrowDown')
    pressKey(input, 'Enter')
    expect(onValue).toHaveBeenCalledExactlyOnceWith('hm://bea')
  })

  it('filters typed names and saves pointer selection without profile paths or versions', async () => {
    const {input, onValue} = renderField()
    enterText(input, 'Bea')
    await waitForAccounts(1)
    act(() => (container.querySelector('[role="option"]') as HTMLButtonElement).click())
    expect(onValue).toHaveBeenCalledExactlyOnceWith('hm://bea')
  })

  it('discards search text on Escape without saving it on blur', async () => {
    const {input, onValue} = renderField()
    enterText(input, 'Bea')
    await waitForAccounts(1)
    pressKey(input, 'Escape')
    act(() => input.blur())
    expect(onValue).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('preserves direct account URL entry', () => {
    const {input, onValue} = renderField()
    enterText(input, 'hm://bea')
    pressKey(input, 'Enter')
    expect(onValue).toHaveBeenCalledExactlyOnceWith('hm://bea')
  })
})
