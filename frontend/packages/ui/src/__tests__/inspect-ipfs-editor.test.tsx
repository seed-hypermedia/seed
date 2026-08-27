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
// The document a field edit is scoped to (a published doc at version v1).
const contextDoc = vi.hoisted(() => ({
  metadata: {name: 'Character'},
  version: 'v1',
  genesis: 'bafygenesis',
  generationInfo: {generation: 3},
}))
vi.mock('@shm/shared/models/entity', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    useResource: (id: unknown) => ({data: id ? {type: 'document', document: contextDoc} : undefined, isLoading: false}),
  }
})

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

  function mount(
    ipfsPath: string,
    blobs: Record<string, unknown> = {},
    props: {editField?: {docUrl: string; field: string}} = {},
  ) {
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
      publishDocument: vi.fn(async (_input: unknown) => {}),
    }
    const selectedIdentity = {get: () => 'z6MkSigner', subscribe: () => () => {}}
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider
            openUrl={() => {}}
            openRoute={null}
            universalClient={client as any}
            selectedIdentity={selectedIdentity as any}
          >
            <TooltipProvider>
              <InspectIpfsPage ipfsPath={ipfsPath} {...props} />
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
    expect(container.querySelector('[data-testid="blob-status"]')!.textContent).toBe('Unpublished draft')
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
    // The header names the blob by its (shortened) CID.
    expect(container.querySelector('[data-document-top-bar]')!.textContent).toContain(cid.slice(0, 10))
  })

  it('a blank draft offers a schema picker; a seeded draft does not', async () => {
    mount('new')
    await flush()
    expect(container.querySelector('[data-testid="new-blob-schema-picker"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Object schema"]')).toBeTruthy()
    act(() => root.unmount())
    root = createRoot(container)
    mount(`new/${schemaCid('example-employee')!}`)
    await flush()
    expect(container.querySelector('[data-testid="new-blob-schema-picker"]')).toBeNull()
  })

  it('the header is a regular top bar with the title, CID, and top-right actions', async () => {
    const value = {hello: 'world'}
    const cid = CID.createV1(0x71, await sha256.digest(cbor.encode(value))).toString()
    mount(cid, {[cid]: value})
    await flush()
    const bar = container.querySelector('[data-document-top-bar]')!
    expect(bar.textContent).toContain('IPFS blob')
    expect(bar.textContent).toContain(cid.slice(0, 10))
    expect(bar.querySelector('[data-testid="blob-edit"]')).toBeTruthy()
    // No omnibar-style URL input inside the page.
    expect(container.querySelector('input')).toBeNull()
    // Edit switches to a draft in place with Publish available.
    act(() => (bar.querySelector('[data-testid="blob-edit"]') as HTMLButtonElement).click())
    expect(container.querySelector('[data-testid="blob-publish"]')).toBeTruthy()
    expect(container.textContent).toContain('Editing blob')
  })

  it('field context: edits the referenced object and, on confirm, publishes a direct metadata change', async () => {
    const schema = {name: 'Stats', type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map', properties: {}}
    const cid = CID.createV1(0x71, await sha256.digest(cbor.encode(schema))).toString()
    const docUrl = 'hm://z6MkOwner/world/types/character'
    const {client, published} = mount(cid, {[cid]: schema}, {editField: {docUrl, field: 'schemaDefinition'}})
    await flush()
    // Opens straight into a draft; the title row says what is being edited, once.
    const bar = container.querySelector('[data-document-top-bar]')!
    expect(bar.textContent).toMatch(/Editing\s*schemaDefinition\s*of\s*Character/)
    expect(container.querySelectorAll('[data-testid="edit-field-doc-link"]')).toHaveLength(1)
    expect((container.textContent!.match(/schemaDefinition/g) || []).length).toBe(1)
    // No CID and no Cancel in this bar.
    expect(bar.textContent).not.toContain(cid.slice(0, 10))
    expect(Array.from(bar.querySelectorAll('button')).some((b) => b.textContent === 'Cancel')).toBe(false)
    const publish = container.querySelector('[data-testid="blob-publish"]') as HTMLButtonElement
    // Nothing to publish until something changes.
    expect(publish.disabled).toBe(true)
    expect(container.textContent).not.toContain('Unpublished')
    const nameInput = container.querySelector('input[value="Stats"]') as HTMLInputElement
    expect(nameInput).toBeTruthy()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(nameInput, 'Stats v2')
      nameInput.dispatchEvent(new Event('input', {bubbles: true}))
      nameInput.dispatchEvent(new FocusEvent('focusout', {bubbles: true}))
    })
    await flush()
    expect(publish.disabled).toBe(false)
    expect(container.querySelector('[data-testid="blob-status"]')!.textContent).toBe('Unpublished changes')
    // Publish asks for confirmation, naming the field and document.
    act(() => publish.click())
    await flush()
    const confirm = document.querySelector('[data-testid="confirm-update-document"]') as HTMLButtonElement
    expect(confirm).toBeTruthy()
    expect(document.body.textContent).toContain('metadata.schemaDefinition')
    expect(client.publishDocument).not.toHaveBeenCalled()
    await act(async () => confirm.click())
    await flush()
    await flush()
    // The blob is published, then the document's metadata is updated directly against its published version.
    expect(published).toHaveLength(1)
    expect(client.publishDocument).toHaveBeenCalledTimes(1)
    const input = client.publishDocument.mock.calls[0]![0] as any
    expect(input.account).toBe('z6MkOwner')
    expect(input.signerAccountUid).toBe('z6MkSigner')
    expect(input.path).toBe('/world/types/character')
    expect(input.baseVersion).toBe('v1')
    expect(input.genesis).toBe('bafygenesis')
    expect(input.generation).toBe(3)
    const op = input.changes[0].op
    expect(op.case).toBe('setMetadata')
    expect(op.value.key).toBe('schemaDefinition')
    expect(op.value.value).toBe(`ipfs://${published[0]!.cid}`)
    // …and we land back on the document.
    expect(nav.push).toHaveBeenCalledWith({key: 'document', id: expect.objectContaining({uid: 'z6MkOwner'})})
  })
})
