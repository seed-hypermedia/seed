// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {DocumentMetadataView} from '@shm/ui/document-metadata-view'
import {TooltipProvider} from '@shm/ui/tooltip'
import {AttributeAutocomplete, AttributeAutocompleteProvider} from '@shm/ui/value-editor'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function settleAutocomplete() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
}

function enterText(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

function pressKey(input: HTMLInputElement, key: string) {
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key})))
}

function render(metadata: Record<string, unknown>, autocomplete: AttributeAutocomplete, onMetadata = vi.fn()) {
  // The metadata view resolves onyx schema references via react-query.
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AttributeAutocompleteProvider value={autocomplete}>
            <DocumentMetadataView metadata={metadata} canEdit onMetadata={onMetadata} />
          </AttributeAutocompleteProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    )
  })
  return onMetadata
}

describe('attribute autocomplete', () => {
  it('requests direct-child names and keeps arbitrary field entry available', async () => {
    const listNames = vi.fn(async () => ({
      items: [
        {
          name: 'status',
          kinds: [{kind: 'text' as const}],
          description: 'Workflow state shown on task documents.',
        },
      ],
    }))
    const autocomplete: AttributeAutocomplete = {
      listNames,
      listValues: vi.fn(async () => ({items: []})),
    }
    render({}, autocomplete)

    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add field'),
    )!
    act(() => add.click())
    await settleAutocomplete()

    expect(listNames).toHaveBeenCalledWith(expect.objectContaining({parentPath: [], prefix: ''}))
    expect(document.body.textContent).toContain('status')
    expect(document.body.textContent).toContain('Workflow state shown on task documents.')

    const input = document.querySelector('#field-dialog-name') as HTMLInputElement
    enterText(input, 'anything-new')
    expect(input.value).toBe('anything-new')
  })

  it('rejects dollar-prefixed names for new nested fields', async () => {
    const autocomplete: AttributeAutocomplete = {
      listNames: vi.fn(async () => ({items: []})),
      listValues: vi.fn(async () => ({items: []})),
    }
    const onMetadata = render({workflow: {status: ''}}, autocomplete)
    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add field'),
    )!
    act(() => add.click())

    const input = document.querySelector('#field-dialog-name') as HTMLInputElement
    enterText(input, '$child')
    const submit = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add',
    )!
    act(() => submit.click())

    expect(document.body.textContent).toContain('Field names beginning with "$" are reserved')
    expect(onMetadata).not.toHaveBeenCalled()
  })

  it('requests values for the exact nested path and applies a selected value', async () => {
    const listValues = vi.fn(async () => ({
      items: [{value: 'Published'}],
    }))
    const autocomplete: AttributeAutocomplete = {
      listNames: vi.fn(async () => ({items: []})),
      listValues,
    }
    const onMetadata = render({workflow: {status: ''}}, autocomplete)

    const input = container.querySelector('input[role="combobox"]') as HTMLInputElement
    act(() => input.focus())
    await settleAutocomplete()

    expect(listValues).toHaveBeenCalledWith(
      expect.objectContaining({path: ['workflow', 'status'], kind: 'text', prefix: ''}),
    )
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent?.includes('Published'),
    ) as HTMLButtonElement
    act(() => option.click())
    expect(onMetadata).toHaveBeenCalledWith({workflow: {status: 'Published'}})
  })

  it('supports keyboard navigation and selection for field names', async () => {
    const autocomplete: AttributeAutocomplete = {
      listNames: vi.fn(async () => ({
        items: [
          {name: 'status', kinds: [{kind: 'text' as const}]},
          {
            name: 'priority',
            kinds: [{kind: 'number' as const}],
          },
        ],
      })),
      listValues: vi.fn(async () => ({items: []})),
    }
    const onMetadata = render({}, autocomplete)
    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add field'),
    )!
    act(() => add.click())
    await settleAutocomplete()

    const input = document.querySelector('#field-dialog-name') as HTMLInputElement
    pressKey(input, 'ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe('field-name-suggestions-option-0')
    expect(document.querySelector('#field-name-suggestions-option-0')?.getAttribute('aria-selected')).toBe('true')
    pressKey(input, 'ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe('field-name-suggestions-option-1')
    expect(document.querySelector('#field-name-suggestions-option-0')?.getAttribute('aria-selected')).toBe('false')
    pressKey(input, 'Enter')

    expect(input.value).toBe('priority')
    const submit = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add',
    )!
    act(() => submit.click())
    expect(onMetadata).toHaveBeenCalledWith({priority: 0})
  })

  it('supports keyboard navigation and selection for string values', async () => {
    const autocomplete: AttributeAutocomplete = {
      listNames: vi.fn(async () => ({items: []})),
      listValues: vi.fn(async () => ({
        items: [{value: 'Draft'}, {value: 'Published'}],
      })),
    }
    const onMetadata = render({status: ''}, autocomplete)
    const input = container.querySelector('input[role="combobox"]') as HTMLInputElement
    act(() => input.focus())
    await settleAutocomplete()

    pressKey(input, 'ArrowDown')
    pressKey(input, 'ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-option-1$/)
    expect(document.querySelector('[role="option"]:nth-of-type(2)')?.getAttribute('aria-selected')).toBe('true')
    pressKey(input, 'Enter')

    expect(input.value).toBe('Published')
    expect(onMetadata).toHaveBeenCalledWith({status: 'Published'})
  })

  it('filters sibling names, infers the observed type, and loads another page', async () => {
    const listNames = vi.fn(async ({pageToken}: {pageToken?: string}) =>
      pageToken
        ? {
            items: [
              {
                name: 'owner',
                kinds: [{kind: 'text' as const}],
              },
            ],
          }
        : {
            items: [
              {
                name: 'status',
                kinds: [{kind: 'text' as const}],
              },
              {
                name: 'priority',
                kinds: [{kind: 'number' as const}],
              },
            ],
            nextPageToken: 'page-2',
          },
    )
    const autocomplete: AttributeAutocomplete = {
      listNames,
      listValues: vi.fn(async () => ({items: []})),
    }
    const onMetadata = render({status: 'Draft'}, autocomplete)

    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add field'),
    )!
    act(() => add.click())
    await settleAutocomplete()

    const listbox = document.querySelector('[role="listbox"]') as HTMLDivElement
    Object.defineProperties(listbox, {
      clientHeight: {value: 100, configurable: true},
      scrollHeight: {value: 120, configurable: true},
      scrollTop: {value: 20, configurable: true},
    })
    await act(async () => listbox.dispatchEvent(new Event('scroll', {bubbles: true})))
    expect(listNames).toHaveBeenCalledWith(expect.objectContaining({pageToken: 'page-2'}))

    const priority = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent?.includes('priority'),
    ) as HTMLButtonElement
    act(() => priority.click())
    const submit = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add',
    )!
    act(() => submit.click())
    expect(onMetadata).toHaveBeenCalledWith({priority: 0})
  })

  it('continues pagination when a page only contains used sibling names', async () => {
    const listNames = vi.fn(async ({pageToken}: {pageToken?: string}) =>
      pageToken
        ? {
            items: [
              {
                name: 'owner',
                kinds: [{kind: 'text' as const}],
              },
            ],
          }
        : {
            items: [
              {
                name: 'status',
                kinds: [{kind: 'text' as const}],
              },
            ],
            nextPageToken: 'page-2',
          },
    )
    const autocomplete: AttributeAutocomplete = {
      listNames,
      listValues: vi.fn(async () => ({items: []})),
    }
    render({status: 'Draft'}, autocomplete)

    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add field'),
    )!
    act(() => add.click())
    await settleAutocomplete()

    expect(listNames).toHaveBeenCalledWith(expect.objectContaining({pageToken: 'page-2'}))
    expect(Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('owner')]),
    )
  })

  it('cancels superseded requests and falls back to unrestricted input after errors', async () => {
    const signals: AbortSignal[] = []
    const listNames = vi.fn(
      ({signal}: {signal?: AbortSignal}) =>
        new Promise<never>((_resolve, reject) => {
          signals.push(signal!)
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          if (signals.length > 1) reject(new Error('offline'))
        }),
    )
    const autocomplete: AttributeAutocomplete = {
      listNames,
      listValues: vi.fn(async () => ({items: []})),
    }
    const onMetadata = render({}, autocomplete)
    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add field'),
    )!
    act(() => add.click())
    await settleAutocomplete()

    const input = document.querySelector('#field-dialog-name') as HTMLInputElement
    enterText(input, 'custom')
    await settleAutocomplete()
    expect(signals[0]?.aborted).toBe(true)

    const submit = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add',
    )!
    act(() => submit.click())
    expect(onMetadata).toHaveBeenCalledWith({custom: ''})
  })
})
