// @vitest-environment jsdom
import * as cbor from '@ipld/dag-cbor'
import {BLOB_META_SCHEMA, BLOB_META_SCHEMA_CID, type BlobSchema} from '@shm/ui/blob-schema'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {TooltipProvider} from '@shm/ui/tooltip'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Web parity proof for the blob/schema editor: `web-raw-blob.tsx` must behave
 * exactly like desktop's `raw-blob.tsx` (see raw-blob-schema-parity.test.tsx) —
 * a schema is a regular IPFS blob, New Schema renders the schema form, and
 * Publish makes one PublishBlobs call with explicit sha256 CIDs (schema blobs
 * co-publish the meta-schema) then replaces the route to the published CID.
 * Plus the web-native pieces: `useSchemaRegistries` fetch, advisory warnings,
 * and `ipfsUrlToRoute`.
 */

const mockState = vi.hoisted(() => ({
  route: {key: 'raw-blob'} as Record<string, unknown>,
  pushNavigate: vi.fn(),
  replaceNavigate: vi.fn(),
  request: vi.fn(async () => ({})),
  registry: {} as Record<string, BlobSchema>,
}))

vi.mock('@shm/shared/utils/navigation', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    useNavRoute: () => mockState.route,
    useNavigate: (mode?: string) => (mode === 'replace' ? mockState.replaceNavigate : mockState.pushNavigate),
  }
})

vi.mock('@shm/shared', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    useUniversalClient: () => ({request: mockState.request}),
  }
})

// Web fetches schema blobs through the shared registry hook; stub it so the
// page never touches the network (matches desktop mocking @/models/blob-schema).
vi.mock('@shm/ui/blob-schema-registry', () => ({
  useSchemaRegistries: (seedCids: string[]) => ({
    registry: Object.fromEntries(seedCids.filter((c) => mockState.registry[c]).map((c) => [c, mockState.registry[c]])),
    isLoading: false,
    isComplete: true,
  }),
}))

import {routeToHref} from '@shm/shared'
import {
  BlobEditor,
  blobBuilderMenuItems,
  extractRawBlobRouteFromPath,
  ipfsUrlToRoute,
  WebRawBlobPage,
} from './web-raw-blob'

// A real DAG-CBOR schema blob CID (codec 0x71) so `attachedSchemaCid`'s codec
// check accepts it, keyed to a tiny object schema requiring `title`.
const OBJECT_SCHEMA: BlobSchema = {type: 'object', required: ['title'], properties: {title: {type: 'string'}}}
let SCHEMA_CID: string

beforeAll(async () => {
  const digest = await sha256.digest(cbor.encode(dagJsonToIpld(OBJECT_SCHEMA)))
  SCHEMA_CID = CID.createV1(0x71, digest).toString()
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockState.pushNavigate.mockReset()
  mockState.replaceNavigate.mockReset()
  mockState.request.mockReset()
  mockState.request.mockResolvedValue({})
  mockState.registry = {}
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderRoute(route: Record<string, unknown>) {
  mockState.route = route
  act(() => {
    root.render(
      <TooltipProvider>
        <WebRawBlobPage />
      </TooltipProvider>,
    )
  })
}

function renderValue(value: unknown) {
  mockState.route = {key: 'raw-blob', cid: 'existing-cid'}
  act(() => {
    root.render(
      <TooltipProvider>
        <BlobEditor cid="existing-cid" initialValue={value} />
      </TooltipProvider>,
    )
  })
}

function findPublishButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes('Publish'))
  expect(button, 'Publish button should render').toBeTruthy()
  return button as HTMLButtonElement
}

describe('web blob/schema editor', () => {
  it('New Blob and New Schema both render the same Publish affordance + the schema form', () => {
    renderRoute({key: 'raw-blob'})
    findPublishButton()

    renderRoute({key: 'raw-blob', schemaCid: BLOB_META_SCHEMA_CID})
    findPublishButton()
    expect(container.textContent).toContain('Schema of')
    expect(container.textContent).toContain('Fields')
  })

  it('publishing a schema stores it like any blob: explicit sha256 CID + meta co-publish + route replace', async () => {
    renderRoute({key: 'raw-blob', schemaCid: BLOB_META_SCHEMA_CID})
    await act(async () => {
      findPublishButton().click()
      await Promise.resolve()
    })

    expect(mockState.request).toHaveBeenCalledTimes(1)
    const [method, params] = mockState.request.mock.calls[0] as unknown as [
      string,
      {blobs: {cid: string; data: Uint8Array}[]},
    ]
    expect(method).toBe('PublishBlobs')
    expect(params.blobs).toHaveLength(2)
    expect(params.blobs[1]!.cid).toBe(BLOB_META_SCHEMA_CID)

    const expectedValue = {schema: {'/': BLOB_META_SCHEMA_CID}, type: 'object'}
    const data = cbor.encode(dagJsonToIpld(expectedValue))
    const digest = await sha256.digest(data)
    const expectedCid = CID.createV1(0x71, digest).toString()
    expect(params.blobs[0]!.cid).toBe(expectedCid)
    expect(mockState.replaceNavigate).toHaveBeenCalledWith({key: 'raw-blob', cid: expectedCid})
  })

  it('publishing a plain blob uses the identical flow (single blob, no meta)', async () => {
    renderRoute({key: 'raw-blob'})
    await act(async () => {
      findPublishButton().click()
      await Promise.resolve()
    })
    const [method, params] = mockState.request.mock.calls[0] as unknown as [string, {blobs: {cid: string}[]}]
    expect(method).toBe('PublishBlobs')
    expect(params.blobs).toHaveLength(1)
    expect(mockState.replaceNavigate).toHaveBeenCalledWith({key: 'raw-blob', cid: params.blobs[0]!.cid})
  })

  it('a new instance of a schema seeds required fields and reads as matching', () => {
    mockState.registry = {[SCHEMA_CID]: OBJECT_SCHEMA}
    renderRoute({key: 'raw-blob', schemaCid: SCHEMA_CID})
    findPublishButton()
    expect(container.textContent).toContain('Schema attached')
    expect(container.textContent).toContain('Matches schema')
  })

  it('an instance missing a required field surfaces an advisory warning (kept as-is, never an error)', () => {
    mockState.registry = {[SCHEMA_CID]: OBJECT_SCHEMA}
    renderValue({schema: {'/': SCHEMA_CID}}) // missing required "title"
    // Web runs the same advisory validator: the violation is reported, the
    // value is kept, and the page renders normally (no error boundary).
    expect(container.textContent).toContain('match the schema') // "…doesn't match the schema — kept as-is"
    expect(container.textContent).toContain('Schema attached')
  })

  it('the meta-schema co-publish encodes to the pinned CID', async () => {
    const data = cbor.encode(dagJsonToIpld(BLOB_META_SCHEMA))
    const digest = await sha256.digest(data)
    expect(CID.createV1(0x71, digest).toString()).toBe(BLOB_META_SCHEMA_CID)
  })
})

describe('ipfsUrlToRoute', () => {
  it('parses ipfs:// URLs and bare CIDs into a raw-blob route', () => {
    expect(ipfsUrlToRoute(`ipfs://${BLOB_META_SCHEMA_CID}`)).toEqual({key: 'raw-blob', cid: BLOB_META_SCHEMA_CID})
    expect(ipfsUrlToRoute(BLOB_META_SCHEMA_CID)).toEqual({key: 'raw-blob', cid: BLOB_META_SCHEMA_CID})
  })
  it('rejects non-CID input', () => {
    expect(ipfsUrlToRoute('not a cid')).toBeNull()
    expect(ipfsUrlToRoute('')).toBeNull()
  })
})

describe('raw-blob URL routing round-trips (routeToHref ⇄ extractRawBlobRouteFromPath)', () => {
  const cases = [
    {route: {key: 'raw-blob'} as const, href: '/hm/blob/new'},
    {route: {key: 'raw-blob', cid: 'bafyCID'} as const, href: '/hm/blob/ipfs/bafyCID'},
    {route: {key: 'raw-blob', schemaCid: 'bafySchema'} as const, href: '/hm/blob/new-instance/bafySchema'},
  ]
  it('routeToHref emits the reserved /hm/blob/… URLs', () => {
    for (const {route, href} of cases) expect(routeToHref(route, {})).toBe(href)
  })
  it('extractRawBlobRouteFromPath parses those URLs back to the same route', () => {
    for (const {route, href} of cases) {
      const parts = href.split('/').filter(Boolean)
      expect(extractRawBlobRouteFromPath(parts)).toEqual(route)
    }
  })
  it('ignores non-blob paths (site router falls through)', () => {
    expect(extractRawBlobRouteFromPath(['hm', 'inspect', 'ipfs', 'x'])).toBeNull()
    expect(extractRawBlobRouteFromPath(['some', 'doc'])).toBeNull()
    expect(extractRawBlobRouteFromPath(['hm', 'blob'])).toBeNull()
  })
})

describe('blobBuilderMenuItems (New Blob / New Schema document-menu entries)', () => {
  it('offers New Blob and New Schema, navigating to the right routes', () => {
    const navigate = vi.fn()
    const items = blobBuilderMenuItems(navigate)
    expect(items.map((i) => i.label)).toEqual(['New Blob', 'New Schema'])

    const click = (key: string) => (items.find((i) => i.key === key)!.onClick as () => void)()

    click('new-raw-blob')
    expect(navigate).toHaveBeenLastCalledWith({key: 'raw-blob'})

    click('new-schema')
    expect(navigate).toHaveBeenLastCalledWith({key: 'raw-blob', schemaCid: BLOB_META_SCHEMA_CID})
  })
})
