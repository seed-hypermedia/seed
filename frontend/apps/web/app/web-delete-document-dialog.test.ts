import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'

const createTombstoneRefMock = vi.hoisted(() =>
  vi.fn(async () => ({blobs: [{cid: 'ref-cid', data: new Uint8Array([1])}]})),
)
const invalidateQueriesMock = vi.hoisted(() => vi.fn())
const enqueueCleanupMock = vi.hoisted(() => vi.fn(async () => ({enqueued: true})))

vi.mock('@seed-hypermedia/client', async () => {
  const actual = await vi.importActual<typeof import('@seed-hypermedia/client')>('@seed-hypermedia/client')
  return {
    ...actual,
    createTombstoneRef: createTombstoneRefMock,
  }
})

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
}))

vi.mock('./document-edit/web-document-card-cleanup', () => ({
  enqueueWebDocumentCardCleanup: enqueueCleanupMock,
}))

import {deleteWebDocuments} from './web-delete-document-dialog'

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

describe('deleteWebDocuments', () => {
  it('publishes tombstone refs for the target documents', async () => {
    const ids = [makeId('uid-1', ['parent']), makeId('uid-1', ['parent', 'child'])]
    const publish = vi.fn(async () => ({}))
    const deleteRecent = vi.fn(async () => undefined)
    const getSigner = vi.fn(() => ({
      getPublicKey: async () => new Uint8Array([1]),
      sign: async () => new Uint8Array([2]),
    }))
    const request = vi.fn(async () => ({
      type: 'document',
      document: {
        genesis: 'genesis-cid',
        generationInfo: {generation: 7n},
      },
    }))

    await deleteWebDocuments({request, publish, getSigner, deleteRecent} as any, {
      ids,
      signingAccountId: 'uid-1',
      capabilityId: 'cap-cid',
    })

    expect(getSigner).toHaveBeenCalledWith('uid-1')
    expect(request).toHaveBeenCalledTimes(2)
    expect(deleteRecent).toHaveBeenCalledTimes(2)
    expect(createTombstoneRefMock).toHaveBeenCalledWith(
      {
        space: 'uid-1',
        path: '/parent',
        genesis: 'genesis-cid',
        generation: 7,
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(createTombstoneRefMock).toHaveBeenCalledWith(
      {
        space: 'uid-1',
        path: '/parent/child',
        genesis: 'genesis-cid',
        generation: 7,
        capability: 'cap-cid',
      },
      expect.anything(),
    )
    expect(publish).toHaveBeenCalledTimes(2)
    expect(invalidateQueriesMock).toHaveBeenCalled()
    expect(enqueueCleanupMock).toHaveBeenCalledWith(
      {
        deletedDocumentId: ids[0]!.id,
        signingAccountUid: 'uid-1',
        capabilityId: 'cap-cid',
      },
      {client: expect.anything()},
    )
  })

  it('rejects non-document resources', async () => {
    await expect(
      deleteWebDocuments(
        {
          request: vi.fn(async () => ({type: 'not-found'})),
          publish: vi.fn(),
          getSigner: vi.fn(() => ({})),
        } as any,
        {ids: [makeId('uid-1', ['doc'])], signingAccountId: 'uid-1'},
      ),
    ).rejects.toThrow(/Cannot delete/)
  })

  it('requires signing support', async () => {
    await expect(
      deleteWebDocuments({request: vi.fn(), publish: vi.fn()} as any, {
        ids: [makeId('uid-1', ['doc'])],
        signingAccountId: 'uid-1',
      }),
    ).rejects.toThrow(/Signing not available/)
  })
})
