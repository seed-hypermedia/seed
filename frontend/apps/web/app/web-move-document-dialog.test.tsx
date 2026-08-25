// @vitest-environment jsdom
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared/routing'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, describe, expect, it, vi} from 'vitest'

const createVersionRefMock = vi.hoisted(() =>
  vi.fn(async () => ({blobs: [{cid: 'version-ref', data: new Uint8Array([1])}]})),
)
const createRedirectRefMock = vi.hoisted(() =>
  vi.fn(async () => ({blobs: [{cid: 'redirect-ref', data: new Uint8Array([2])}]})),
)
const enqueueCleanupMock = vi.hoisted(() => vi.fn(async () => ({enqueued: true})))
const sharedDestinationDialogMock = vi.hoisted(() => vi.fn(() => <div data-testid="shared-destination-dialog" />))

vi.mock('@seed-hypermedia/client', async () => {
  const actual = await vi.importActual<typeof import('@seed-hypermedia/client')>('@seed-hypermedia/client')
  return {
    ...actual,
    createVersionRef: createVersionRefMock,
    createRedirectRef: createRedirectRefMock,
  }
})

vi.mock('./document-edit/web-document-card-cleanup', () => ({
  enqueueWebDocumentCardCleanup: enqueueCleanupMock,
}))

vi.mock('@shm/ui/document-destination-dialog', () => ({
  DocumentDestinationDialog: sharedDestinationDialogMock,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResources: () => [],
}))

import {moveWebDocuments, republishWebDocument, WebDocumentDestinationDialog} from './web-move-document-dialog'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function makeId(uid: string, path: string[]): UnpackedHypermediaId {
  return {
    uid,
    path,
    id: `hm://${uid}/${path.join('/')}`,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
    latest: false,
  } as UnpackedHypermediaId
}

describe('WebDocumentDestinationDialog', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    sharedDestinationDialogMock.mockClear()
  })

  it('uses the shared destination dialog with only move enabled on web', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const id = makeId('space', ['doc'])
    const queryClient = new QueryClient()

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UniversalAppProvider
            openRoute={vi.fn()}
            openUrl={vi.fn()}
            universalClient={{request: vi.fn(), publish: vi.fn()} as any}
          >
            <WebDocumentDestinationDialog
              input={{id, mode: 'move'}}
              onClose={vi.fn()}
              signingAccountId="space"
              canMove
            />
          </UniversalAppProvider>
        </QueryClientProvider>,
      )
    })

    expect(sharedDestinationDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {id, mode: 'move'},
        enabledModes: ['move'],
      }),
      {},
    )
  })

  it('passes the web writable capability location to the shared destination picker', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const id = makeId('space', ['parent', 'doc'])
    const writableLocationId = makeId('space', ['parent'])
    const queryClient = new QueryClient()

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UniversalAppProvider
            openRoute={vi.fn()}
            openUrl={vi.fn()}
            universalClient={{request: vi.fn(), publish: vi.fn()} as any}
          >
            <WebDocumentDestinationDialog
              input={{id, mode: 'move'}}
              onClose={vi.fn()}
              signingAccountId="writer"
              writableLocationId={writableLocationId}
              canMove
            />
          </UniversalAppProvider>
        </QueryClientProvider>,
      )
    })

    const dialogProps = (sharedDestinationDialogMock.mock.calls as any[])[0][0]
    expect(dialogProps.writableDocuments[0].id).toBe(writableLocationId)
  })
})

describe('moveWebDocuments', () => {
  it('publishes version and redirect refs and enqueues parent card rewrite', async () => {
    const from = makeId('space', ['old-parent', 'doc'])
    const to = makeId('space', ['old-parent', 'renamed'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async () => ({
      type: 'document',
      document: {
        version: 'doc-version',
        generationInfo: {genesis: 'genesis-cid', generation: 5n},
      },
    }))

    await moveWebDocuments({request, publish, getSigner} as any, {
      from,
      to,
      signingAccountId: 'space',
      capabilityId: 'cap-cid',
    })

    expect(createVersionRefMock).toHaveBeenCalledWith(
      {
        space: 'space',
        path: '/old-parent/renamed',
        genesis: 'genesis-cid',
        version: 'doc-version',
        // Fresh generation so the ref supersedes anything already at the destination path.
        generation: expect.any(Number),
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(createRedirectRefMock).toHaveBeenCalledWith(
      {
        space: 'space',
        path: '/old-parent/doc',
        genesis: 'genesis-cid',
        generation: expect.any(Number),
        targetSpace: 'space',
        targetPath: '/old-parent/renamed',
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(publish).toHaveBeenCalledTimes(2)
    expect(enqueueCleanupMock).toHaveBeenCalledWith(
      {
        operation: 'rewrite',
        parentDocumentId: 'hm://space/old-parent',
        sourceDocumentId: from.id,
        targetDocumentId: to.id,
        signingAccountUid: 'space',
        capabilityId: 'cap-cid',
      },
      {client: expect.anything()},
    )
  })

  it('does not fail the move when post-move card cleanup fails', async () => {
    const from = makeId('space', ['old-parent', 'doc'])
    const to = makeId('space', ['new-parent', 'doc'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async () => ({
      type: 'document',
      document: {
        version: 'doc-version',
        generationInfo: {genesis: 'genesis-cid', generation: 5n},
      },
    }))
    enqueueCleanupMock.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(
      moveWebDocuments({request, publish, getSigner} as any, {
        from,
        to,
        signingAccountId: 'space',
      }),
    ).resolves.toEqual([{from, to}])

    expect(publish).toHaveBeenCalledTimes(2)
    expect(enqueueCleanupMock).toHaveBeenCalled()
  })

  it('moves a republished path as a republish: the destination re-publishes the original, not a fork', async () => {
    // A path that republishes an original is a live mirror. Moving it must keep it a mirror — the
    // destination republishes the SAME original — rather than freezing a fork of its content.
    const from = makeId('space', ['mirror'])
    const to = makeId('space', ['moved-mirror'])
    const original = makeId('other', ['resources', 'guide'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    // The source republishes the original; following it reaches the original document.
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) => {
      if (id.uid === 'space' && (id.path || []).join('/') === 'mirror') {
        return {type: 'redirect', id, redirectTarget: original, republish: true}
      }
      return {
        type: 'document',
        document: {version: 'guide-version', generationInfo: {genesis: 'guide-genesis', generation: 9n}},
      }
    })
    createVersionRefMock.mockClear()
    createRedirectRefMock.mockClear()

    await moveWebDocuments({request, publish, getSigner} as any, {
      from,
      to,
      signingAccountId: 'space',
      capabilityId: 'cap-cid',
    })

    // No fork: the destination gets a republish redirect pointing at the ORIGINAL.
    expect(createVersionRefMock).not.toHaveBeenCalled()
    expect(createRedirectRefMock).toHaveBeenCalledWith(
      {
        space: 'space',
        path: '/moved-mirror',
        genesis: 'guide-genesis',
        generation: expect.any(Number),
        targetSpace: 'other',
        targetPath: '/resources/guide',
        republish: true,
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    // And the source redirects to the destination — a plain move redirect, no republish flag.
    expect(createRedirectRefMock).toHaveBeenCalledWith(
      {
        space: 'space',
        path: '/mirror',
        genesis: 'guide-genesis',
        generation: expect.any(Number),
        targetSpace: 'space',
        targetPath: '/moved-mirror',
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('refuses to move a path that has itself already moved', async () => {
    const from = makeId('space', ['old'])
    const to = makeId('space', ['newer'])
    const movedTarget = makeId('space', ['new'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    // A move redirect (republish: false) — the source is a pointer, not content.
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) => {
      if (id.uid === 'space' && (id.path || []).join('/') === 'old') {
        return {type: 'redirect', id, redirectTarget: movedTarget, republish: false}
      }
      return {type: 'document', document: {version: 'v', generationInfo: {genesis: 'g', generation: 1n}}}
    })

    await expect(
      moveWebDocuments({request, publish, getSigner} as any, {from, to, signingAccountId: 'space'}),
    ).rejects.toThrow('already moved')
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('republishWebDocument', () => {
  it('publishes a republish redirect and enqueues a parent card add', async () => {
    const from = makeId('source', ['doc'])
    const to = makeId('space', ['parent', 'copy'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async () => ({
      type: 'document',
      document: {
        generationInfo: {genesis: 'genesis-cid', generation: 8n},
      },
    }))

    await republishWebDocument({request, publish, getSigner} as any, {
      from,
      to,
      signingAccountId: 'space',
      capabilityId: 'cap-cid',
    })

    expect(createRedirectRefMock).toHaveBeenCalledWith(
      {
        space: 'space',
        path: '/parent/copy',
        genesis: 'genesis-cid',
        // Fresh generation — not the source document's — so any later publish at the
        // destination supersedes the republish redirect.
        generation: expect.any(Number),
        targetSpace: 'source',
        targetPath: '/doc',
        republish: true,
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(publish).toHaveBeenCalledTimes(1)
    expect(enqueueCleanupMock).toHaveBeenCalledWith(
      {
        operation: 'add',
        parentDocumentId: 'hm://space/parent',
        targetDocumentId: to.id,
        signingAccountUid: 'space',
        capabilityId: 'cap-cid',
      },
      {client: expect.anything()},
    )
  })
})
