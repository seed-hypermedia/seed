// @vitest-environment jsdom
import * as cbor from '@ipld/dag-cbor'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {ONYX_SCHEMAS, schemaCid, seedValue} from '@shm/ui/onyx/index'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Parity proof: a schema is a regular IPFS blob. The New Schema route renders
 * the same page with the same Publish flow as New Blob — one PublishBlobs call
 * with an explicit sha256 CID and a route replace to the published CID. On Onyx
 * a schema is self-describing (validates against the bundled meta-schema), so
 * publishing one is the identical single-blob flow — no co-published meta blob.
 */

// The Onyx meta-schema's real published DAG-CBOR CID (the "New Schema" target).
const META_SCHEMA_CID = schemaCid('onyx-schema')!

const mockState = vi.hoisted(() => ({
  route: {key: 'raw-blob'} as Record<string, unknown>,
  pushNavigate: vi.fn(),
  replaceNavigate: vi.fn(),
  request: vi.fn(async () => ({})),
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

import RawBlobPage from '../pages/raw-blob'

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  mockState.pushNavigate.mockReset()
  mockState.replaceNavigate.mockReset()
  mockState.request.mockReset()
  mockState.request.mockResolvedValue({})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(route: Record<string, unknown>) {
  mockState.route = route
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RawBlobPage />
        </TooltipProvider>
      </QueryClientProvider>,
    )
  })
}

function findPublishButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes('Publish'))
  expect(button, 'Publish button should render').toBeTruthy()
  return button as HTMLButtonElement
}

describe('schema blobs are regular blobs', () => {
  it('New Blob and New Schema both render the same Publish affordance', () => {
    render({key: 'raw-blob'})
    findPublishButton()

    render({key: 'raw-blob', schemaCid: META_SCHEMA_CID})
    findPublishButton()
    // ...and the seeded value is recognized as a schema (edited against the meta-schema)
    expect(container.textContent).toContain('This blob is a schema')
    expect(container.textContent).toContain('New schema')
  })

  it('publishing a schema stores it like any blob: single explicit sha256 CID + route replace', async () => {
    render({key: 'raw-blob', schemaCid: META_SCHEMA_CID})
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
    // A self-describing schema publishes as a single blob — no co-published meta.
    expect(params.blobs).toHaveLength(1)

    // the schema blob's CID is the standard pipeline output for the seeded value
    const expectedValue = seedValue(ONYX_SCHEMAS['onyx-schema'])
    const data = cbor.encode(dagJsonToIpld(expectedValue))
    const digest = await sha256.digest(data)
    const expectedCid = CID.createV1(0x71, digest).toString()
    expect(params.blobs[0]!.cid).toBe(expectedCid)

    // same post-publish treatment as any blob: replace to {key:'raw-blob', cid}
    expect(mockState.replaceNavigate).toHaveBeenCalledWith({key: 'raw-blob', cid: expectedCid})
  })

  it('publishing a plain blob uses the identical flow (single blob)', async () => {
    render({key: 'raw-blob'})
    await act(async () => {
      findPublishButton().click()
      await Promise.resolve()
    })
    const [method, params] = mockState.request.mock.calls[0] as unknown as [string, {blobs: {cid: string}[]}]
    expect(method).toBe('PublishBlobs')
    expect(params.blobs).toHaveLength(1)
    expect(mockState.replaceNavigate).toHaveBeenCalledWith({key: 'raw-blob', cid: params.blobs[0]!.cid})
  })

  it('the New Schema route seeds a value that is a real published-CID meta-schema target', () => {
    // The meta-schema resolves to a real DAG-CBOR CID (not a hardcoded constant).
    expect(META_SCHEMA_CID).toMatch(/^bafy/)
  })
})
