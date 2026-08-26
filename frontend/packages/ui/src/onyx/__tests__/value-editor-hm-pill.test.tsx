// @vitest-environment jsdom
// A string value that IS an hm:// URL renders as a title pill even with no
// schema (the raw blob editor), like ipfs:// values render as file pills:
// clickable to open, with an ✕ that clears the value back to editable text.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {CBOR_VALUE_RULES, ValueEditor, ValueEditorProvider} from '../../value-editor'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const URL = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-place-doc'

describe('hm:// string values in the schema-less editor', () => {
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

  const mount = (value: string, onValue = vi.fn(), openUrl = vi.fn()) => {
    const request = vi.fn(async () => ({}))
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider openUrl={openUrl} openRoute={null} universalClient={{request} as any}>
            <TooltipProvider>
              <ValueEditorProvider openUrl={openUrl}>
                <ValueEditor value={value} onValue={onValue} rules={CBOR_VALUE_RULES} />
              </ValueEditorProvider>
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )
    return {onValue, openUrl}
  }

  it('renders a pill with the document title, opens on click, and clears with ✕', async () => {
    const {onValue, openUrl} = mount(URL)
    await act(async () => await new Promise((r) => setTimeout(r, 0)))
    // No raw text input for the URL — a pill instead.
    expect(container.querySelector('input')).toBeNull()
    const pill = container.querySelector('.rounded-full') as HTMLElement
    expect(pill).toBeTruthy()
    // (Title resolution against a real document is covered by the e2e pill test.)
    act(() => (pill.closest('button') as HTMLButtonElement).click())
    expect(openUrl).toHaveBeenCalledWith(URL)
    act(() => (container.querySelector('[aria-label="Remove reference"]') as HTMLButtonElement).click())
    expect(onValue).toHaveBeenCalledWith('')
    // One control only: no separate pencil.
    expect(container.querySelector('[aria-label="Change document"]')).toBeNull()
  })

  it('a plain string that is not an hm:// URL stays a text input', () => {
    mount('just some text')
    expect(container.querySelector('input')).toBeTruthy()
    expect(container.querySelector('.rounded-full')).toBeNull()
  })
})
