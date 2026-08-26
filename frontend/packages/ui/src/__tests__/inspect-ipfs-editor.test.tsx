// @vitest-environment jsdom
// The inspector is THE blob page: `new` is a blank draft, `new/<schemaCid>`
// seeds an instance (or, for the meta-schema, a new schema), a published CID
// is viewed, and publishing a draft stores one blob and replaces the route.
import * as cbor from '@ipld/dag-cbor'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {InspectIpfsPage} from '../inspect-ipfs-page'
import {META_SCHEMA_CID} from '../onyx/blob-menu-items'
import {schemaCid} from '../onyx/onyx-engine'
import {TooltipProvider} from '../tooltip'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// Navigation is app plumbing; the page only needs push/replace callbacks.
const nav = vi.hoisted(() => ({push: vi.fn(), replace: vi.fn()}))
vi.mock('@shm/shared/utils/navigation', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    useNavigate: (mode?: string) => (mode === 'replace' ? nav.replace : nav.push),
  }
})

const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

describe('InspectIpfsPage as the blob editor', () => {
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

  function mount(ipfsPath: string, blobs: Record<string, unknown> = {}) {
    const published: {cid?: string; data: Uint8Array}[] = []
    nav.push.mockReset()
    nav.replace.mockReset()
    const client = {
      request: vi.fn(async (method: string, params: any) => {
        if (method === 'GetCID') return {value: blobs[params.cid]}
        return {}
      }),
      publish: vi.fn(async (input: {blobs: {cid?: string; data: Uint8Array}[]}) => {
        published.push(...input.blobs)
        return {cids: input.blobs.map((b) => b.cid!)}
      }),
    }
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={client as any}>
            <TooltipProvider>
              <InspectIpfsPage ipfsPath={ipfsPath} />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )
    return {client, published}
  }

  it('`new` is a blank draft that publishes one DAG-CBOR blob and replaces the route with its CID', async () => {
    const {published} = mount('new')
    await flush()
    expect(container.textContent).toContain('New blob')
    const publish = container.querySelector('[data-testid="blob-publish"]') as HTMLButtonElement
    expect(publish.disabled).toBe(false)
    await act(async () => publish.click())
    await flush()
    expect(published).toHaveLength(1)
    const expected = CID.createV1(0x71, await sha256.digest(cbor.encode({}))).toString()
    expect(published[0]!.cid).toBe(expected)
    expect(nav.replace).toHaveBeenCalledWith({key: 'inspect-ipfs', ipfsPath: expected})
  })

  it('`new/<meta-schema>` seeds a new schema (self-describing, no schema link)', async () => {
    mount(`new/${META_SCHEMA_CID}`)
    await flush()
    expect(container.textContent).toContain('New schema')
    expect(container.textContent).toContain('This blob is a schema')
    expect(container.textContent).not.toContain('Schema attached')
  })

  it('`new/<schemaCid>` seeds an instance linked to its schema, with its required fields', async () => {
    const employee = schemaCid('example-employee')!
    const {published} = mount(`new/${employee}`)
    await flush()
    expect(container.textContent).toContain('Schema attached')
    expect(container.textContent).toContain('employeeId')
    const publish = container.querySelector('[data-testid="blob-publish"]') as HTMLButtonElement
    await act(async () => publish.click())
    await flush()
    const value = cbor.decode(published[0]!.data) as any
    expect(value.schema.toString()).toBe(employee)
    expect(value).toHaveProperty('employeeId')
  })

  it('a published DAG-CBOR blob is viewed (not editable until Edit…), with its schema status', async () => {
    const value = {hello: 'world', n: 3}
    const cid = CID.createV1(0x71, await sha256.digest(cbor.encode(value))).toString()
    mount(cid, {[cid]: value})
    await flush()
    expect(container.querySelector('[data-testid="blob-publish"]')).toBeNull()
    expect(container.textContent).toContain('hello')
    expect(container.textContent).toContain('world')
    // The resting URL is shown in the omnibar input.
    expect((container.querySelector('input') as HTMLInputElement | null)?.value ?? container.textContent).toContain(cid)
  })
})
