import {hmId, type NavRoute} from '@shm/shared'
import {describe, expect, it, vi} from 'vitest'
import {
  getDocumentResourceRouteKey,
  getCommentReplyPanelRoute,
  hasUnpublishedDraftForResourceState,
  shouldSuppressMainCommentEditor,
  getRenderedDocumentId,
  shouldUseDraftForRenderedDocument,
  getDocumentContentAction,
  getLatestRouteForCurrentDocumentRoute,
} from '../resource-page-common'

describe('getDocumentResourceRouteKey', () => {
  it('changes when only the document version changes', () => {
    const latest = hmId('alice', {path: ['doc'], latest: true})
    const versioned = hmId('alice', {path: ['doc'], version: 'version-1', latest: false})

    expect(getDocumentResourceRouteKey(latest)).not.toBe(getDocumentResourceRouteKey(versioned))
  })
})

describe('getDocumentContentAction', () => {
  const menuItems = [{key: 'options', label: 'Options', icon: null}]

  it('uses editing actions on the content view while editing', () => {
    const editingFloatingActions = vi.fn(() => 'editing-actions')

    expect(
      getDocumentContentAction({
        activeView: 'content',
        isEditing: true,
        hasDraft: true,
        allMenuItems: menuItems,
        editingFloatingActions,
        actionButtons: 'options-actions',
      }),
    ).toBe('editing-actions')
    expect(editingFloatingActions).toHaveBeenCalledWith({menuItems})
  })

  it('uses draft actions on the content view when a draft exists and editing is inactive', () => {
    const draftActions = vi.fn(() => 'draft-actions')

    expect(
      getDocumentContentAction({
        activeView: 'content',
        isEditing: false,
        hasDraft: true,
        allMenuItems: menuItems,
        draftActions,
        actionButtons: 'options-actions',
      }),
    ).toBe('draft-actions')
    expect(draftActions).toHaveBeenCalledWith({menuItems})
  })

  it('uses edit-capable actions on the content view while loaded without a draft', () => {
    const editingFloatingActions = vi.fn(() => 'publish-actions')

    expect(
      getDocumentContentAction({
        activeView: 'content',
        isEditing: false,
        hasDraft: false,
        allMenuItems: menuItems,
        editingFloatingActions,
        actionButtons: 'options-actions',
      }),
    ).toBe('publish-actions')
    expect(editingFloatingActions).toHaveBeenCalledWith({menuItems})
  })

  it('returns the shared edit-capable action for mobile header placement too', () => {
    const editingFloatingActions = vi.fn(() => 'publish-actions')

    const documentContentAction = getDocumentContentAction({
      activeView: 'content',
      isEditing: false,
      hasDraft: false,
      allMenuItems: menuItems,
      editingFloatingActions,
      actionButtons: 'options-actions',
    })

    expect(documentContentAction).toBe('publish-actions')
    expect(editingFloatingActions).toHaveBeenCalledWith({menuItems})
  })

  it('falls back to options actions on the content view', () => {
    expect(
      getDocumentContentAction({
        activeView: 'content',
        isEditing: false,
        hasDraft: false,
        allMenuItems: menuItems,
        actionButtons: 'options-actions',
      }),
    ).toBe('options-actions')
  })

  it('hides content actions outside the content view', () => {
    expect(
      getDocumentContentAction({
        activeView: 'comments',
        isEditing: true,
        hasDraft: true,
        allMenuItems: menuItems,
        editingFloatingActions: () => 'editing-actions',
        draftActions: () => 'draft-actions',
        actionButtons: 'options-actions',
      }),
    ).toBeNull()
  })
})

describe('getLatestRouteForCurrentDocumentRoute', () => {
  it('removes the route document version while preserving other route params', () => {
    const route: Extract<NavRoute, {key: 'comments'}> = {
      key: 'comments',
      id: hmId('alice', {
        path: ['doc'],
        version: 'old-version',
        latest: false,
        blockRef: 'block-1',
      }),
      openComment: 'alice/comment-tsid',
      width: 420,
      panel: {
        key: 'activity',
        id: hmId('alice', {path: ['doc'], version: 'panel-version'}),
        filterEventType: ['Change'],
      },
    }

    const nextRoute = getLatestRouteForCurrentDocumentRoute(route)
    if (!('id' in nextRoute)) throw new Error('Expected route with document id')

    expect(nextRoute).toMatchObject({
      key: 'comments',
      openComment: 'alice/comment-tsid',
      width: 420,
      panel: route.panel,
    })
    expect(nextRoute.id).toMatchObject({
      uid: 'alice',
      path: ['doc'],
      blockRef: 'block-1',
      version: null,
      latest: true,
    })
    expect(route.id.version).toBe('old-version')
    expect(route.id.latest).toBe(false)
  })
})

describe('shouldSuppressMainCommentEditor', () => {
  const docId = hmId('alice', {path: ['doc']})

  it('suppresses the main editor when the right panel has the same top-level comment target', () => {
    expect(
      shouldSuppressMainCommentEditor({
        docId,
        activeView: 'comments',
        panelRoute: {
          key: 'comments',
          id: docId,
        },
      }),
    ).toBe(true)
  })

  it('does not suppress the main editor for different focused reply comments', () => {
    expect(
      shouldSuppressMainCommentEditor({
        docId,
        activeView: 'comments',
        discussionsParams: {openComment: 'comment-a'},
        panelRoute: {
          key: 'comments',
          id: docId,
          openComment: 'comment-b',
        },
      }),
    ).toBe(false)
  })

  it('does not suppress the main editor for different block comment targets', () => {
    expect(
      shouldSuppressMainCommentEditor({
        docId,
        activeView: 'comments',
        discussionsParams: {targetBlockId: 'block-a'},
        panelRoute: {
          key: 'comments',
          id: docId,
          targetBlockId: 'block-b',
        },
      }),
    ).toBe(false)
  })

  it('does not suppress the main editor when a non-comments panel is open', () => {
    expect(
      shouldSuppressMainCommentEditor({
        docId,
        activeView: 'comments',
        panelRoute: {
          key: 'activity',
          id: docId,
        },
      }),
    ).toBe(false)
  })
})

describe('getCommentReplyPanelRoute', () => {
  const docId = hmId('alice', {path: ['doc']})

  it('creates a panel comments route focused on the replied comment', () => {
    expect(
      getCommentReplyPanelRoute({
        docId,
        isReplying: true,
        comment: {
          id: 'alice/comment-tsid',
          version: 'comment-version',
          threadRootVersion: 'thread-root-version',
          targetAccount: 'alice',
          targetPath: '/doc',
        } as any,
      }),
    ).toMatchObject({
      key: 'comments',
      id: docId,
      openComment: 'alice/comment-tsid',
      isReplying: true,
      replyCommentVersion: 'comment-version',
      rootReplyCommentVersion: 'thread-root-version',
    })
  })

  it('switches the panel target document when the replied comment belongs to another document', () => {
    const panelRoute = getCommentReplyPanelRoute({
      docId,
      comment: {
        id: 'alice/other-comment-tsid',
        version: 'comment-version',
        targetAccount: 'alice',
        targetPath: '/other-doc',
      } as any,
    })

    expect(panelRoute).toMatchObject({
      key: 'comments',
      openComment: 'alice/other-comment-tsid',
    })
    expect(panelRoute.id.path).toEqual(['other-doc'])
  })
})

describe('shouldUseDraftForRenderedDocument', () => {
  it('uses a draft on the unpinned latest route', () => {
    expect(
      shouldUseDraftForRenderedDocument({
        docId: hmId('alice', {path: ['doc']}),
        existingDraft: {id: 'draft-1', metadata: {name: 'Draft'}} as any,
      }),
    ).toBe(true)
  })

  it('ignores a draft on a version-pinned snapshot route', () => {
    expect(
      shouldUseDraftForRenderedDocument({
        docId: hmId('alice', {path: ['doc'], version: 'old-version'}),
        existingDraft: {id: 'draft-1', metadata: {name: 'Draft'}} as any,
        isLatest: false,
      }),
    ).toBe(false)
  })

  it('uses a draft on a versioned latest route', () => {
    expect(
      shouldUseDraftForRenderedDocument({
        docId: hmId('alice', {path: ['doc'], version: 'latest-version'}),
        existingDraft: {id: 'draft-1', metadata: {name: 'Draft'}} as any,
        isLatest: true,
      }),
    ).toBe(true)
  })

  it('does not use a draft when no draft exists', () => {
    expect(
      shouldUseDraftForRenderedDocument({
        docId: hmId('alice', {path: ['doc']}),
        existingDraft: false,
      }),
    ).toBe(false)
  })
})

describe('hasUnpublishedDraftForResourceState', () => {
  it('treats a reserved draft id as an unpublished draft even while the resource query is initially loading', () => {
    expect(
      hasUnpublishedDraftForResourceState({
        existingDraft: false,
        reservedDraftId: 'draft-1',
        resourceFetchId: null,
        resourceIsDiscovering: false,
        resourceData: undefined,
      }),
    ).toBe(true)
  })

  it('treats a reserved draft id as unpublished while existing draft lookup is still settling', () => {
    expect(
      hasUnpublishedDraftForResourceState({
        existingDraft: undefined,
        reservedDraftId: 'draft-1',
        resourceFetchId: null,
        resourceIsDiscovering: false,
        resourceData: undefined,
      }),
    ).toBe(true)
  })

  it('does not treat a missing draft as unpublished without an existing or reserved draft', () => {
    expect(
      hasUnpublishedDraftForResourceState({
        existingDraft: false,
        reservedDraftId: null,
        resourceFetchId: null,
        resourceIsDiscovering: false,
        resourceData: undefined,
      }),
    ).toBe(false)
  })
})

describe('getRenderedDocumentId', () => {
  const oldId = hmId('uid1', {path: ['old-name']})
  const newId = hmId('uid1', {path: ['new-name']})
  const redirectedDocument = {
    type: 'document' as const,
    id: newId,
    document: {
      version: 'v1',
      account: 'uid1',
      path: '/new-name',
      authors: [],
      content: [],
      metadata: {},
      genesis: 'genesis1',
      visibility: 'PUBLIC' as const,
      createTime: '',
      updateTime: '',
    },
  }

  it('uses the resolved document id when a redirect returned a different document', () => {
    expect(getRenderedDocumentId(oldId, redirectedDocument)).toEqual(newId)
  })

  it('keeps the route document id when the resource is not a document', () => {
    expect(getRenderedDocumentId(oldId, {type: 'not-found', id: oldId})).toEqual(oldId)
  })

  it('keeps the route document id for local-only draft routes even if stale resource data exists', () => {
    expect(getRenderedDocumentId(oldId, redirectedDocument, null)).toEqual(oldId)
  })
})
