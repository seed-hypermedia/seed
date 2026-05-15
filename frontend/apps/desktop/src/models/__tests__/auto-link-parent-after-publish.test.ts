import {hmId} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {
  invalidateQueriesMock,
  getDocumentMock,
  listCapabilitiesMock,
  findByEditMock,
  getDraftMock,
  writeDraftMock,
  publishDocumentMock,
} = vi.hoisted(() => ({
  invalidateQueriesMock: vi.fn(),
  getDocumentMock: vi.fn(),
  listCapabilitiesMock: vi.fn(),
  findByEditMock: vi.fn(),
  getDraftMock: vi.fn(),
  writeDraftMock: vi.fn(),
  publishDocumentMock: vi.fn(),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
  setQueriesDataByKey: vi.fn(),
  queryClient: {
    refetchQueries: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    documents: {
      getDocument: getDocumentMock,
    },
    accessControl: {
      listCapabilities: listCapabilitiesMock,
    },
  },
  domainResolver: vi.fn(),
}))

vi.mock('@/trpc', () => ({
  client: {
    drafts: {
      findByEdit: {query: findByEditMock},
      get: {query: getDraftMock},
      write: {mutate: writeDraftMock},
    },
  },
}))

vi.mock('@/desktop-universal-client', () => ({
  desktopUniversalClient: {
    publishDocument: publishDocumentMock,
  },
}))

vi.mock('@shm/shared/document-utils', async (orig) => {
  const actual = (await orig()) as any
  return {
    ...actual,
    prepareHMDocument: (raw: any) => raw,
  }
})

// Keep proto Block.fromJson from crashing on simple mock attributes without
// losing the other exports (GetDocumentRequest, etc.) other modules need.
vi.mock('@shm/shared/client/.generated/documents/v3alpha/documents_pb', async () => {
  const actual = (await vi.importActual('@shm/shared/client/.generated/documents/v3alpha/documents_pb')) as any
  return {
    ...actual,
    Block: {...actual.Block, fromJson: (b: any) => b},
  }
})

import {autoLinkParentAfterPublish} from '../auto-link-parent'

function makeParentDocument(content: any[] = []) {
  return {
    account: 'acct-1',
    path: '/parent',
    content,
    version: 'v1',
    genesis: 'g1',
    visibility: 'PUBLIC',
  }
}

describe('autoLinkParentAfterPublish', () => {
  beforeEach(() => {
    invalidateQueriesMock.mockReset()
    getDocumentMock.mockReset()
    listCapabilitiesMock.mockReset()
    findByEditMock.mockReset()
    getDraftMock.mockReset()
    writeDraftMock.mockReset()
    publishDocumentMock.mockReset()
    publishDocumentMock.mockResolvedValue(undefined)
    writeDraftMock.mockResolvedValue(undefined)
  })

  it('skips when no signing account is provided', async () => {
    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: undefined,
      isPrivate: false,
    })
    expect(result).toEqual({kind: 'skipped', reason: 'no-account'})
    expect(getDocumentMock).not.toHaveBeenCalled()
  })

  it('skips when child is at root (path length < 1)', async () => {
    const childId = hmId('acct-1', {path: []})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })
    expect(result).toEqual({kind: 'skipped', reason: 'at-root'})
  })

  it('skips when parent document cannot be fetched', async () => {
    getDocumentMock.mockRejectedValueOnce(new Error('not found'))
    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })
    expect(result).toEqual({kind: 'skipped', reason: 'no-parent-doc'})
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(writeDraftMock).not.toHaveBeenCalled()
  })

  it('skips when child is private', async () => {
    getDocumentMock.mockResolvedValueOnce(makeParentDocument())
    findByEditMock.mockResolvedValueOnce(null)
    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: true,
    })
    expect(result).toEqual({kind: 'skipped', reason: 'should-not-link'})
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(writeDraftMock).not.toHaveBeenCalled()
  })

  it('skips when parent already has a self-referencing query block', async () => {
    const parentWithSelfQuery = makeParentDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            query: {
              includes: [{space: 'acct-1', path: '/parent', mode: 'Children'}],
            },
          },
        },
      },
    ])
    getDocumentMock.mockResolvedValueOnce(parentWithSelfQuery)
    findByEditMock.mockResolvedValueOnce(null)
    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })
    expect(result).toEqual({kind: 'skipped', reason: 'should-not-link'})
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(writeDraftMock).not.toHaveBeenCalled()
  })

  it('skips when parent already contains an embed link to the child', async () => {
    const parentWithLink = makeParentDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://acct-1/parent/child',
          attributes: {view: 'Card'},
        },
      },
    ])
    getDocumentMock.mockResolvedValueOnce(parentWithLink)
    findByEditMock.mockResolvedValueOnce(null)
    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })
    expect(result).toEqual({kind: 'skipped', reason: 'should-not-link'})
    expect(publishDocumentMock).not.toHaveBeenCalled()
  })

  it('appends to parent draft when one exists', async () => {
    getDocumentMock.mockResolvedValueOnce(makeParentDocument())
    findByEditMock.mockResolvedValueOnce({id: 'parent-draft-id'})
    getDraftMock.mockResolvedValueOnce({
      id: 'parent-draft-id',
      locationUid: 'acct-1',
      locationPath: [],
      editUid: 'acct-1',
      editPath: ['parent'],
      metadata: {},
      content: [{id: 'b1', type: 'paragraph', props: {}, content: [], children: []}],
      deps: [],
      navigation: [],
      visibility: 'PUBLIC',
    })

    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })

    expect(result.kind).toBe('added-to-draft')
    if (result.kind === 'added-to-draft') {
      expect(result.parentDraftId).toBe('parent-draft-id')
      expect(result.parentId.uid).toBe('acct-1')
      expect(result.parentId.path).toEqual(['parent'])
    }
    expect(writeDraftMock).toHaveBeenCalledTimes(1)
    const writeArgs = writeDraftMock.mock.calls[0]![0]
    expect(writeArgs.content.length).toBe(2) // original + new embed
    expect(writeArgs.content.at(-1)).toMatchObject({type: 'embed', props: {view: 'Card'}})
    expect(publishDocumentMock).not.toHaveBeenCalled()
    const invalidatedKeys = invalidateQueriesMock.mock.calls.map((c) => c[0][0])
    expect(invalidatedKeys).toContain(queryKeys.DRAFT)
    expect(invalidatedKeys).toContain(queryKeys.ENTITY)
    expect(invalidatedKeys).toContain(queryKeys.RESOLVED_ENTITY)
    expect(invalidatedKeys).toContain(queryKeys.DOC_LIST_DIRECTORY)
  })

  it('rewrites an existing inline-draft embed in place when childDraftId matches', async () => {
    getDocumentMock.mockResolvedValueOnce(makeParentDocument())
    findByEditMock.mockResolvedValueOnce({id: 'parent-draft-id'})
    // Parent draft contains an inline draft embed pointing at the child by
    // draftId. After publish, that block should be
    // rewritten in place.
    getDraftMock.mockResolvedValueOnce({
      id: 'parent-draft-id',
      locationUid: 'acct-1',
      locationPath: [],
      editUid: 'acct-1',
      editPath: ['parent'],
      metadata: {},
      content: [
        {id: 'b1', type: 'paragraph', props: {}, content: [], children: []},
        {
          id: 'b2',
          type: 'embed',
          props: {url: '', draftId: 'child-draft-id', defaultOpen: 'false'},
          content: [],
          children: [],
        },
        {id: 'b3', type: 'paragraph', props: {}, content: [], children: []},
      ],
      deps: [],
      navigation: [],
      visibility: 'PUBLIC',
    })

    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      childDraftId: 'child-draft-id',
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })

    expect(result.kind).toBe('added-to-draft')
    expect(writeDraftMock).toHaveBeenCalledTimes(1)
    const writeArgs = writeDraftMock.mock.calls[0]![0]
    // Check the amount of blocks to be the same.
    expect(writeArgs.content.length).toBe(3)
    // The embed block is rewritten in place at its original index.
    expect(writeArgs.content[1]).toMatchObject({
      id: 'b2',
      type: 'embed',
      props: {
        url: 'hm://acct-1/parent/child',
        draftId: '',
        view: 'Card',
      },
    })
    expect(publishDocumentMock).not.toHaveBeenCalled()
  })

  it('rewrites the inline-draft embed even when the parent has no published version (nested drafts)', async () => {
    // Nested-draft chain: the parent has never been published, so
    // the gRPC getDocument call fails. The rewrite path should still
    // run via the parent draft and its matching embed.
    getDocumentMock.mockRejectedValueOnce(new Error('not found'))
    findByEditMock.mockResolvedValueOnce({id: 'parent-draft-id'})
    getDraftMock.mockResolvedValueOnce({
      id: 'parent-draft-id',
      locationUid: 'acct-1',
      locationPath: [],
      editUid: 'acct-1',
      editPath: ['parent'],
      metadata: {},
      content: [
        {
          id: 'b1',
          type: 'embed',
          props: {url: '', draftId: 'child-draft-id', defaultOpen: 'false'},
          content: [],
          children: [],
        },
      ],
      deps: [],
      navigation: [],
      visibility: 'PUBLIC',
    })

    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      childDraftId: 'child-draft-id',
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })

    expect(result.kind).toBe('added-to-draft')
    expect(writeDraftMock).toHaveBeenCalledTimes(1)
    const writeArgs = writeDraftMock.mock.calls[0]![0]
    expect(writeArgs.content[0]).toMatchObject({
      type: 'embed',
      props: {
        url: 'hm://acct-1/parent/child',
        draftId: '',
        view: 'Card',
      },
    })
    expect(publishDocumentMock).not.toHaveBeenCalled()
  })

  it('falls back to appending when childDraftId does not match any embed in the parent draft', async () => {
    getDocumentMock.mockResolvedValueOnce(makeParentDocument())
    findByEditMock.mockResolvedValueOnce({id: 'parent-draft-id'})
    // getDraft is consumed twice now: once by the rewrite attempt,
    // once by addLinkToParentDraft when it appends.
    const parentDraftData = {
      id: 'parent-draft-id',
      locationUid: 'acct-1',
      locationPath: [],
      editUid: 'acct-1',
      editPath: ['parent'],
      metadata: {},
      content: [
        {
          id: 'b1',
          type: 'embed',
          props: {url: '', draftId: 'some-other-draft', defaultOpen: 'false'},
          content: [],
          children: [],
        },
      ],
      deps: [],
      navigation: [],
      visibility: 'PUBLIC',
    }
    getDraftMock.mockResolvedValueOnce(parentDraftData)
    getDraftMock.mockResolvedValueOnce(parentDraftData)

    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      childDraftId: 'child-draft-id', // not present in parent draft
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })

    expect(result.kind).toBe('added-to-draft')
    expect(writeDraftMock).toHaveBeenCalledTimes(1)
    const writeArgs = writeDraftMock.mock.calls[0]![0]
    // Check the original blocks are preserved and new Card embed appended at the end.
    expect(writeArgs.content.length).toBe(2)
    expect(writeArgs.content[0]).toMatchObject({props: {draftId: 'some-other-draft'}})
    expect(writeArgs.content.at(-1)).toMatchObject({
      type: 'embed',
      props: {url: 'hm://acct-1/parent/child', view: 'Card'},
    })
  })

  it('publishes a new parent version when no draft exists', async () => {
    const parentDoc = makeParentDocument()
    getDocumentMock.mockResolvedValueOnce(parentDoc) // initial parent fetch
    findByEditMock.mockResolvedValueOnce(null)
    getDocumentMock.mockResolvedValueOnce(parentDoc) // fetch-after-publish in publishLinkToParentDocument

    const childId = hmId('acct-1', {path: ['parent', 'child']})
    const result = await autoLinkParentAfterPublish({
      childId,
      signingAccountUid: 'acct-1',
      isPrivate: false,
    })

    expect(result.kind).toBe('published-parent')
    if (result.kind === 'published-parent') {
      expect(result.parentId.uid).toBe('acct-1')
      expect(result.parentId.path).toEqual(['parent'])
    }
    expect(publishDocumentMock).toHaveBeenCalledTimes(1)
    const publishArgs = publishDocumentMock.mock.calls[0]![0]
    expect(publishArgs.account).toBe('acct-1')
    expect(publishArgs.path).toBe('/parent')
    expect(publishArgs.signerAccountUid).toBe('acct-1')
    expect(writeDraftMock).not.toHaveBeenCalled()
    const invalidatedKeys = invalidateQueriesMock.mock.calls.map((c) => c[0][0])
    expect(invalidatedKeys).toContain(queryKeys.ENTITY)
    expect(invalidatedKeys).toContain(queryKeys.RESOLVED_ENTITY)
    expect(invalidatedKeys).toContain(queryKeys.DOC_LIST_DIRECTORY)
  })
})
