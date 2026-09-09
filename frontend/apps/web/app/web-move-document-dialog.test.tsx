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
const enqueueCleanupMock = vi.hoisted(() => vi.fn(async () => ({enqueued: true, jobId: 'pending-job'})))
const releaseCleanupMock = vi.hoisted(() => vi.fn(async () => {}))
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
  releaseWebDocumentCardCleanup: releaseCleanupMock,
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
    const id = makeId('site', ['doc'])
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
              signingAccountId="site"
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
    const id = makeId('site', ['parent', 'doc'])
    const writableLocationId = makeId('site', ['parent'])
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
  it('does not release held parent maintenance when the primary move fails', async () => {
    releaseCleanupMock.mockClear()
    const publish = vi.fn(async () => {
      throw new Error('primary publish failed')
    })
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) =>
      id.path?.join('/') === 'parent/child'
        ? {type: 'not-found', id}
        : {
            type: 'document',
            document: {version: 'v1', genesis: 'g1', generationInfo: {genesis: 'g1', generation: 1n}},
          },
    )
    await expect(
      moveWebDocuments({request, publish, getSigner: vi.fn(() => ({}))} as any, {
        from: makeId('site', ['child']),
        to: makeId('site', ['parent', 'child']),
        signingAccountId: 'site',
      }),
    ).rejects.toThrow('primary publish failed')
    expect(releaseCleanupMock).not.toHaveBeenCalled()
  })

  it('rejects an unpublished destination before publishing any refs', async () => {
    const publish = vi.fn()
    await expect(
      moveWebDocuments({request: vi.fn(async () => ({type: 'not-found'})), publish, getSigner: vi.fn()} as any, {
        from: makeId('site', ['child']),
        to: makeId('site', ['unpublished', 'child']),
        signingAccountId: 'site',
      }),
    ).rejects.toThrow('Destination parent must be published')
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes version and redirect refs and enqueues parent card rewrite', async () => {
    const from = makeId('site', ['old-parent', 'doc'])
    const to = makeId('site', ['old-parent', 'renamed'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) =>
      id.id === to.id
        ? {type: 'not-found', id}
        : {
            type: 'document',
            document: {
              version: 'doc-version',
              generationInfo: {genesis: 'genesis-cid', generation: 5n},
            },
          },
    )

    await moveWebDocuments({request, publish, getSigner} as any, {
      from,
      to,
      signingAccountId: 'site',
      capabilityId: 'cap-cid',
    })

    expect(createVersionRefMock).toHaveBeenCalledWith(
      {
        space: 'site',
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
        space: 'site',
        path: '/old-parent/doc',
        genesis: 'genesis-cid',
        generation: expect.any(Number),
        targetSpace: 'site',
        targetPath: '/old-parent/renamed',
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(enqueueCleanupMock.mock.invocationCallOrder.at(-1)!).toBeLessThan(publish.mock.invocationCallOrder[0]!)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(enqueueCleanupMock).toHaveBeenCalledWith(
      {
        operation: 'rewrite',
        awaitingPrimary: {
          documentId: from.id,
          expectedType: 'redirect',
          targetDocumentId: to.id,
          expectedGenesis: 'genesis-cid',
        },
        parentDocumentId: 'hm://site/old-parent',
        sourceDocumentId: from.id,
        targetDocumentId: to.id,
        signingAccountUid: 'site',
        capabilityId: 'cap-cid',
      },
      {client: expect.anything()},
    )
  })

  it('does not fail the move when post-move card cleanup fails', async () => {
    const from = makeId('site', ['old-parent', 'doc'])
    const to = makeId('site', ['new-parent', 'doc'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) =>
      id.id === to.id
        ? {type: 'not-found', id}
        : {
            type: 'document',
            document: {
              version: 'doc-version',
              generationInfo: {genesis: 'genesis-cid', generation: 5n},
            },
          },
    )
    enqueueCleanupMock.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(
      moveWebDocuments({request, publish, getSigner} as any, {
        from,
        to,
        signingAccountId: 'site',
      }),
    ).resolves.toEqual([{from, to}])

    expect(publish).toHaveBeenCalledTimes(2)
    expect(enqueueCleanupMock).toHaveBeenCalled()
  })

  it('moves a republished path as a republish: the destination re-publishes the original, not a fork', async () => {
    // A path that republishes an original is a live mirror. Moving it must keep it a mirror — the
    // destination republishes the SAME original — rather than freezing a fork of its content.
    const from = makeId('site', ['mirror'])
    const to = makeId('site', ['moved-mirror'])
    const original = makeId('other', ['resources', 'guide'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    // The source republishes the original; following it reaches the original document.
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) => {
      if (id.id === to.id) return {type: 'not-found', id}
      if (id.uid === 'site' && (id.path || []).join('/') === 'mirror') {
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
      signingAccountId: 'site',
      capabilityId: 'cap-cid',
    })

    // No fork: the destination gets a republish redirect pointing at the ORIGINAL.
    expect(createVersionRefMock).not.toHaveBeenCalled()
    expect(createRedirectRefMock).toHaveBeenCalledWith(
      {
        space: 'site',
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
        space: 'site',
        path: '/mirror',
        genesis: 'guide-genesis',
        generation: expect.any(Number),
        targetSpace: 'site',
        targetPath: '/moved-mirror',
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('refuses to move a path that has itself already moved', async () => {
    const from = makeId('site', ['old'])
    const to = makeId('site', ['newer'])
    const movedTarget = makeId('site', ['new'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    // A move redirect (republish: false) — the source is a pointer, not content.
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) => {
      if (id.id === to.id) return {type: 'not-found', id}
      if (id.uid === 'site' && (id.path || []).join('/') === 'old') {
        return {type: 'redirect', id, redirectTarget: movedTarget, republish: false}
      }
      return {type: 'document', document: {version: 'v', generationInfo: {genesis: 'g', generation: 1n}}}
    })

    await expect(
      moveWebDocuments({request, publish, getSigner} as any, {from, to, signingAccountId: 'site'}),
    ).rejects.toThrow('already moved')
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('move destination safety', () => {
  it('moves back over its own redirect, replacing it before redirecting the source', async () => {
    createVersionRefMock.mockClear()
    createRedirectRefMock.mockClear()
    const from = makeId('site', ['new'])
    const to = makeId('site', ['old'])
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) =>
      id.id === to.id
        ? {type: 'redirect', id, redirectTarget: from, republish: false}
        : {type: 'document', id, document: {version: 'v', generationInfo: {genesis: 'g', generation: 1n}}},
    )
    const publish = vi.fn(async () => ({}))
    await moveWebDocuments({request, publish, getSigner: () => ({})} as any, {from, to, signingAccountId: 'site'})
    expect(createVersionRefMock).toHaveBeenCalledWith(
      expect.objectContaining({path: '/old', version: 'v', generation: expect.any(Number)}),
      expect.anything(),
    )
    expect(createRedirectRefMock).toHaveBeenCalledWith(
      expect.objectContaining({path: '/new', targetPath: '/old'}),
      expect.anything(),
    )
    expect(publish.mock.calls.map((call: any) => call[0].blobs[0].cid)).toEqual(['version-ref', 'redirect-ref'])
  })

  it.each(['document', 'unrelated-redirect', 'republish', 'error'])(
    'rejects %s destinations without publishing or queueing maintenance',
    async (kind) => {
      enqueueCleanupMock.mockClear()
      const from = makeId('site', ['new'])
      const to = makeId('site', ['old'])
      const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) => {
        if (id.id === to.id) {
          if (kind === 'unrelated-redirect' || kind === 'republish')
            return {
              type: 'redirect',
              id,
              redirectTarget: kind === 'republish' ? from : makeId('site', ['other']),
              republish: kind === 'republish',
            }
          return {type: kind, id}
        }
        return {type: 'document', id, document: {version: 'v'}}
      })
      const publish = vi.fn()
      await expect(
        moveWebDocuments({request, publish, getSigner: () => ({})} as any, {from, to, signingAccountId: 'site'}),
      ).rejects.toThrow('already exists')
      expect(publish).not.toHaveBeenCalled()
      expect(enqueueCleanupMock).not.toHaveBeenCalled()
    },
  )

  it('preflights child collisions before publishing the parent', async () => {
    const from = makeId('site', ['new'])
    const to = makeId('site', ['old'])
    const publish = vi.fn()
    const request = vi.fn(async (_key: string, id: UnpackedHypermediaId) =>
      id.id === to.id ? {type: 'not-found', id} : {type: 'document', id, document: {version: 'v'}},
    )
    await expect(
      moveWebDocuments({request, publish, getSigner: () => ({})} as any, {
        from,
        to,
        childDocuments: [{path: ['new', 'child']}] as any,
        signingAccountId: 'site',
      }),
    ).rejects.toThrow('already exists')
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('republishWebDocument', () => {
  it('publishes a republish redirect and enqueues a parent card add', async () => {
    const from = makeId('source', ['doc'])
    const to = makeId('site', ['parent', 'copy'])
    const publish = vi.fn(async () => ({}))
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async () => ({
      type: 'document',
      document: {
        version: 'source-version',
        generationInfo: {genesis: 'genesis-cid', generation: 8n},
      },
    }))

    await republishWebDocument({request, publish, getSigner} as any, {
      from,
      to,
      signingAccountId: 'site',
      capabilityId: 'cap-cid',
    })

    expect(createRedirectRefMock).toHaveBeenCalledWith(
      {
        space: 'site',
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
        awaitingPrimary: {
          documentId: to.id,
          expectedType: 'redirect',
          targetDocumentId: from.id,
          expectedGenesis: 'genesis-cid',
        },
        parentDocumentId: 'hm://site/parent',
        targetDocumentId: to.id,
        signingAccountUid: 'site',
        capabilityId: 'cap-cid',
      },
      {client: expect.anything()},
    )
  })
})
