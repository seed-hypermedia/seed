// @vitest-environment jsdom
import * as cbor from '@ipld/dag-cbor'
import {BLOB_META_SCHEMA, BLOB_META_SCHEMA_CID} from '@shm/ui/blob-schema'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {TooltipProvider} from '@shm/ui/tooltip'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Parity proof: a schema is a regular IPFS blob. The New Schema route renders
 * the same page with the same Publish flow as New Blob — one PublishBlobs
 * call with explicit sha256 CIDs and a route replace to the published CID.
 */

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

vi.mock('@/models/blob-schema', () => ({
  useSchemaRegistry: () => ({rootSchema: undefined, registry: {}, isLoading: false, isComplete: false}),
}))

import RawBlobPage from '../pages/raw-blob'

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
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(route: Record<string, unknown>) {
  mockState.route = route
  act(() => {
    root.render(
      <TooltipProvider>
        <RawBlobPage />
      </TooltipProvider>,
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

    render({key: 'raw-blob', schemaCid: BLOB_META_SCHEMA_CID})
    findPublishButton()
    // ...and the schema form is what renders below it
    expect(container.textContent).toContain('Schema of')
    expect(container.textContent).toContain('Fields')
  })

  it('publishing a schema stores it like any blob: explicit sha256 CID + route replace', async () => {
    render({key: 'raw-blob', schemaCid: BLOB_META_SCHEMA_CID})
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
    // schema blob + co-published meta-schema, both with explicit CIDs
    expect(params.blobs).toHaveLength(2)
    expect(params.blobs[1]!.cid).toBe(BLOB_META_SCHEMA_CID)

    // the schema blob's CID is the standard pipeline output for its value
    const expectedValue = {schema: {'/': BLOB_META_SCHEMA_CID}, type: 'object'}
    const data = cbor.encode(dagJsonToIpld(expectedValue))
    const digest = await sha256.digest(data)
    const expectedCid = CID.createV1(0x71, digest).toString()
    expect(params.blobs[0]!.cid).toBe(expectedCid)

    // same post-publish treatment as any blob: replace to {key:'raw-blob', cid}
    // (which the titlebar renders as ipfs://<cid> in the omnibar)
    expect(mockState.replaceNavigate).toHaveBeenCalledWith({key: 'raw-blob', cid: expectedCid})
  })

  it('publishing a plain blob uses the identical flow (single blob, no meta)', async () => {
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

  it('the meta-schema co-publish encodes to the pinned CID', async () => {
    const data = cbor.encode(dagJsonToIpld(BLOB_META_SCHEMA))
    const digest = await sha256.digest(data)
    expect(CID.createV1(0x71, digest).toString()).toBe(BLOB_META_SCHEMA_CID)
  })
})
