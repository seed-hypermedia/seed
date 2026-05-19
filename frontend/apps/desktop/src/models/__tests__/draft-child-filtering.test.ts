import {HMListedDraft} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    documents: {
      getDocument: vi.fn(),
      listDocumentChanges: vi.fn(),
    },
    accessControl: {
      listCapabilities: vi.fn(),
    },
  },
  domainResolver: vi.fn(),
}))

vi.mock('@/desktop-universal-client', () => ({
  desktopUniversalClient: {
    publishDocument: vi.fn(),
  },
}))

vi.mock('@/trpc', () => ({
  client: {
    drafts: {
      list: {query: vi.fn()},
      listAccount: {query: vi.fn()},
      write: {mutate: vi.fn()},
      get: {query: vi.fn()},
      delete: {mutate: vi.fn()},
    },
  },
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: vi.fn(),
  setQueriesDataByKey: vi.fn(),
  queryClient: {
    refetchQueries: vi.fn().mockResolvedValue(undefined),
  },
}))

import {filterChildDrafts, resolveDraftWriteAnchors} from '../documents'

function draft({
  id,
  locationPath,
  editPath,
}: {
  id: string
  locationPath?: string[]
  editPath?: string[]
}): HMListedDraft {
  const locationId = locationPath ? hmId('acct', {path: locationPath}) : undefined
  const editId = editPath ? hmId('acct', {path: editPath}) : undefined
  return {
    id,
    locationUid: locationPath ? 'acct' : undefined,
    locationPath,
    editUid: editPath ? 'acct' : undefined,
    editPath,
    metadata: {name: ''},
    visibility: 'PUBLIC',
    deps: [],
    lastUpdateTime: 1,
    locationId,
    editId,
  } as HMListedDraft
}

describe('filterChildDrafts', () => {
  it('keeps drafts located under the parent while excluding drafts editing the parent itself', () => {
    const parentId = hmId('acct', {path: ['parent']})
    const childDraft = draft({
      id: 'child-draft',
      locationPath: ['parent'],
      editPath: ['parent', '-child-draft'],
    })
    const selfDraft = draft({
      id: 'self-draft',
      locationPath: ['parent'],
      editPath: ['parent'],
    })
    const siblingDraft = draft({
      id: 'sibling-draft',
      locationPath: ['sibling'],
      editPath: ['sibling', '-sibling-draft'],
    })

    expect(filterChildDrafts([childDraft, selfDraft, siblingDraft], parentId)).toEqual([childDraft])
  })

  it('keeps root child drafts with an empty root location path', () => {
    const rootId = hmId('acct', {path: []})
    const childDraft = draft({
      id: 'root-child-draft',
      locationPath: [],
      editPath: ['-root-child-draft'],
    })

    expect(filterChildDrafts([childDraft], rootId)).toEqual([childDraft])
  })
})

describe('resolveDraftWriteAnchors', () => {
  it('preserves an existing parent location when autosave rewrites an opened inline draft', () => {
    expect(
      resolveDraftWriteAnchors(
        {
          locationUid: 'acct',
          locationPath: ['parent'],
          editUid: 'acct',
          editPath: ['parent', '-draft'],
        },
        {
          editUid: 'acct',
          editPath: ['parent', '-draft'],
        },
      ),
    ).toEqual({
      locationUid: 'acct',
      locationPath: ['parent'],
      editUid: 'acct',
      editPath: ['parent', '-draft'],
    })
  })

  it('preserves empty root location paths instead of dropping them', () => {
    expect(
      resolveDraftWriteAnchors(
        {
          locationUid: 'acct',
          locationPath: [],
          editUid: 'acct',
          editPath: ['-draft'],
        },
        {
          editUid: 'acct',
          editPath: ['-draft'],
        },
      ),
    ).toMatchObject({
      locationUid: 'acct',
      locationPath: [],
    })
  })
})
