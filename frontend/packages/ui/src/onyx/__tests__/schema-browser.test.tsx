// @vitest-environment jsdom
// The by-CID schema page: a bundled CID renders the library page; a published
// (unbundled) schema is fetched through the client and rendered from the blob,
// with refs opening through the navigation context.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {kindUrl, nameToUrl, schemaCid} from '../onyx-engine'
import {OnyxNavContext, OnyxSchemaByCid} from '../onyx-explorer'
import {OnyxSchemaBrowserPage} from '../schema-browser'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const CUSTOM_CID = 'bafyreicustomschemaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const CUSTOM = {
  name: 'Vote',
  description: 'A vote on a document.',
  ref: nameToUrl('hypermedia-blob'),
  required: ['type', 'target'],
  properties: {
    type: {type: kindUrl('string'), enum: ['Vote']},
    target: {ref: nameToUrl('hypermedia-hm-url'), target: 'hm://acme/proposal'},
  },
}

describe('OnyxSchemaByCid', () => {
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

  const mount = (cid: string, request: any, openRef = vi.fn(), nav = vi.fn()) =>
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request} as any}>
            <TooltipProvider>
              <OnyxNavContext.Provider value={{openRef}}>
                <OnyxSchemaByCid cid={cid} nav={nav} />
              </OnyxNavContext.Provider>
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )

  it('renders a bundled schema by its CID without fetching', async () => {
    const request = vi.fn(async () => ({}))
    await mount(schemaCid('example-person')!, request)
    expect(container.textContent).toContain('Person')
    expect(container.textContent).toContain('nicknames')
    expect(request).not.toHaveBeenCalled()
  })

  it('fetches and renders a published schema, with its extension and targets clickable', async () => {
    const request = vi.fn(async (method: string) => (method === 'GetCID' ? {value: CUSTOM} : {}))
    const openRef = vi.fn()
    await mount(CUSTOM_CID, request, openRef)
    await flush()
    expect(request).toHaveBeenCalledWith('GetCID', {cid: CUSTOM_CID})
    const page = container.querySelector('[data-testid="schema-by-cid"]')!
    expect(page.textContent).toContain('Vote')
    expect(page.textContent).toContain('Extends')
    expect(page.textContent).toContain('signed blob')
    // The `target` on the reference field is a chip that opens the referenced type document.
    const chip = Array.from(page.querySelectorAll('button')).find((b) => b.textContent?.includes('→ proposal'))!
    expect(chip).toBeTruthy()
    act(() => chip.click())
    expect(openRef).toHaveBeenCalledWith('hm://acme/proposal')
  })

  it('the page header offers New <type>, which starts a blob draft pre-filled with this schema', async () => {
    const navigate = vi.fn()
    const openUrl = vi.fn()
    const cid = schemaCid('example-person')!
    await act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request: vi.fn()} as any}>
            <TooltipProvider>
              <OnyxSchemaBrowserPage cid={cid} navigate={navigate} openUrl={openUrl} />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )
    const header = container.querySelector('[data-testid="schema-browser-header"]')!
    expect(header.textContent).toContain('Schema')
    expect(header.textContent).toContain(cid)
    // No back button; New starts the raw-blob draft seeded with this schema.
    expect(container.textContent).not.toContain('Back')
    const newButton = container.querySelector('[data-testid="schema-browser-new"]') as HTMLButtonElement
    expect(newButton.textContent).toContain('New Person')
    act(() => newButton.click())
    expect(navigate).toHaveBeenCalledWith({key: 'raw-blob', schemaCid: cid})
    // "browse the library" opens the onyx account's documents.
    const browse = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'browse the library')!
    act(() => browse.click())
    expect(openUrl).toHaveBeenCalledWith('hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb')
  })

  it('a union schema page has no New button (no single seed shape)', async () => {
    const navigate = vi.fn()
    await act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request: vi.fn()} as any}>
            <TooltipProvider>
              <OnyxSchemaBrowserPage cid={schemaCid('hypermedia-any-blob')!} navigate={navigate} openUrl={vi.fn()} />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )
    expect(container.querySelector('[data-testid="schema-browser-new"]')).toBeNull()
  })
})
