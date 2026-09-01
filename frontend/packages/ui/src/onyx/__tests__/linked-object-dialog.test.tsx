// @vitest-environment jsdom
// The linked-object dialog's three schema modes and its publish contract:
//   - REQUIRED (a field `target`): locked to the type, publish gated on validity;
//   - NONE (free-form): publishes any DAG-CBOR value and reports the CID;
//   - the published blob of a typed object carries a `schema` link to its schema.
import * as cbor from '@ipld/dag-cbor'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {LinkedObjectDialog, publishObject} from '../linked-object-dialog'
import {nameToUrl, schemaCid} from '../onyx-engine'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function mockClient() {
  const published: {cid: string; data: Uint8Array}[] = []
  const request = vi.fn(async (method: string, params: any) => {
    if (method === 'PublishBlobs') {
      published.push(...params.blobs)
      return {cids: params.blobs.map((b: any) => b.cid)}
    }
    return {}
  })
  return {request, published}
}

const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

describe('LinkedObjectDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const mount = (client: ReturnType<typeof mockClient>, props: Partial<Parameters<typeof LinkedObjectDialog>[0]>) =>
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request: client.request} as any}>
            <TooltipProvider>
              <LinkedObjectDialog open onOpenChange={() => {}} onPublished={() => {}} {...props} />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )

  it('a target locks the schema and gates publish on validity', async () => {
    const client = mockClient()
    await mount(client, {target: nameToUrl('example-stats')!, fieldLabel: 'stats'})
    await flush()
    const lock = document.querySelector('[data-testid="linked-object-target"]')!
    expect(lock.textContent).toContain('example-stats')
    expect(lock.textContent).toContain('required')
    expect(document.querySelector('[aria-label="Object schema"]')).toBeNull()
    // The seeded stats (0s) violate minimum 1 → the form shows issues and publish is disabled.
    const publish = document.querySelector('[data-testid="linked-object-publish"]') as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    expect(document.body.textContent).toContain('to resolve')
  })

  it('without a target, defaults to free-form and publishes the value', async () => {
    const client = mockClient()
    const onPublished = vi.fn()
    await mount(client, {onPublished, fieldLabel: 'notes'})
    await flush()
    expect(document.querySelector('[aria-label="Object schema"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Free-form')
    const publish = document.querySelector('[data-testid="linked-object-publish"]') as HTMLButtonElement
    expect(publish.disabled).toBe(false)
    await act(async () => publish.click())
    await flush()
    expect(client.request).toHaveBeenCalledWith('PublishBlobs', expect.anything())
    expect(client.published).toHaveLength(1)
    expect(onPublished).toHaveBeenCalledWith(client.published[0]!.cid)
    expect(cbor.decode(client.published[0]!.data)).toEqual({})
  })
})

describe('publishObject', () => {
  it('links a typed object to its schema blob and returns a DAG-CBOR CID', async () => {
    const client = mockClient()
    const cidOfStats = schemaCid('example-stats')!
    const cid = await publishObject(client as any, {strength: 5, intellect: 5, charisma: 5}, cidOfStats)
    expect(cid).toMatch(/^bafyrei/)
    const decoded = cbor.decode(client.published[0]!.data) as any
    expect(decoded.strength).toBe(5)
    expect(decoded.schema.toString()).toBe(cidOfStats)
  })
  it('does not attach a schema link to free-form values or non-objects', async () => {
    const client = mockClient()
    await publishObject(client as any, {a: 1})
    expect(cbor.decode(client.published[0]!.data)).toEqual({a: 1})
    await publishObject(client as any, 'just a string', 'bafy')
    expect(cbor.decode(client.published[1]!.data)).toBe('just a string')
  })
})
