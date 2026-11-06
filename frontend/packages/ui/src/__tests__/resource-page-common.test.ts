import {hmId, unpackHmId, type NavRoute} from '@shm/shared'
import {describe, expect, it, vi} from 'vitest'
import {
  getDocumentResourceRouteKey,
  getDraftBreadcrumbEntry,
  getBlockCommentDraftReference,
  getCommentReplyPanelRoute,
  getCommentsPanelTarget,
  hasUnpublishedDraftForResourceState,
  shouldSuppressMainCommentEditor,
  getRenderedDocumentId,
  shouldUseDraftForRenderedDocument,
  getDocumentContentAction,
  getDocumentMachineKey,
  getLatestRouteForCurrentDocumentRoute,
  getOlderVersionToastId,
  shouldShowOlderVersionToast,
  resolveEffectiveExistingDraft,
  getEffectiveCanEdit,
  getDocumentSyncIsPlaceholderData,
  getOldVersionEditBlockedToastOptions,
  getCitationsTargetId,
  orderDocumentMenuItems,
  getDocumentPagePanelMenuItems,
  BACK_TO_TOP_SCROLL_OFFSET,
  getBlockCitationsPanelRoute,
} from '../resource-page-common'

describe('draft breadcrumb metadata', () => {
  const id = hmId('alice', {path: ['opaque-document-id']})
  const draft = {id: 'draft-1', metadata: {}, visibility: 'PUBLIC', deps: [], lastUpdateTime: 0} as const

  it('retains the published title for a body-only draft, including ancestor breadcrumbs', () => {
    const entry = getDraftBreadcrumbEntry({
      id,
      draft: {...draft, deps: []},
      publishedMetadata: {name: 'Document title'},
      isUnpublishedDraft: false,
      isLoading: false,
    })
    expect(entry).toMatchObject({metadata: {name: 'Document title'}, draftId: 'draft-1', isLoading: false})
  })

  it('applies saved draft titles and prefers the latest live title edit', () => {
    const input = {
      id,
      draft: {...draft, deps: [], metadata: {name: 'Saved draft title'}},
      publishedMetadata: {name: 'Published title'},
      isUnpublishedDraft: false,
      isLoading: false,
    }
    expect(getDraftBreadcrumbEntry(input)).toMatchObject({metadata: {name: 'Saved draft title'}})
    expect(getDraftBreadcrumbEntry({...input, currentMetadata: {name: 'Live title'}})).toMatchObject({
      metadata: {name: 'Live title'},
    })
    expect(getDraftBreadcrumbEntry({...input, currentMetadata: {name: ''}})).toMatchObject({
      metadata: {name: ''},
      fallbackName: 'Untitled Document',
    })
  })

  it('shows a loading state until an ancestor title is available', () => {
    expect(
      getDraftBreadcrumbEntry({id, draft: {...draft, deps: []}, isUnpublishedDraft: false, isLoading: true}),
    ).toMatchObject({isLoading: true})
  })

  it.each(['PUBLIC', 'PRIVATE'] as const)('uses a friendly label for an untitled %s draft', (visibility) => {
    expect(
      getDraftBreadcrumbEntry({
        id,
        draft: {...draft, deps: [], visibility},
        isUnpublishedDraft: true,
        isLoading: false,
      }),
    ).toMatchObject({
      fallbackName: visibility === 'PRIVATE' ? 'New Private Document' : 'New Document',
    })
  })
})

describe('back to top visibility', () => {
  it('uses a 200px visibility threshold', () => {
    expect(BACK_TO_TOP_SCROLL_OFFSET).toBe(200)
  })
})

describe('block citations panel route', () => {
  it('opens citations scoped to the selected block', () => {
    const docId = hmId('alice', {path: ['doc']})
    expect(getBlockCitationsPanelRoute(docId, 'block-a')).toMatchObject({
      key: 'activity',
      id: docId,
      targetBlockId: 'block-a',
    })
  })
})

describe('orderDocumentMenuItems', () => {
  it('removes redundant destinations and groups the remaining document actions by intent', () => {
    const item = (key: string, variant?: 'destructive') => ({key, label: key, icon: null, variant})

    expect(
      orderDocumentMenuItems([
        item('delete', 'destructive'),
        item('inspect'),
        item('all-documents'),
        item('export'),
        item('move'),
        item('metadata'),
        item('copy-link'),
        item('directory'),
        item('versions'),
        item('options'),
        item('new'),
      ]).map(({key}) => key),
    ).toEqual(['new', 'options', 'versions', 'copy-link', 'move', 'export', 'inspect', 'delete'])
  })
})

describe('custom HTML page panel menu', () => {
  it('keeps every document tab reachable without replacing the page or targeting a fragment', () => {
    const open = vi.fn()
    const id = {...hmId('alice', {path: ['app'], version: 'v1'}), blockRef: 'block1'}
    const items = orderDocumentMenuItems(getDocumentPagePanelMenuItems(id, open))
    expect(items.map((item) => item.label)).toEqual(['People', 'Comments', 'Citations', 'Attributes'])
    for (const item of items) item.onClick?.({} as never)
    expect(open.mock.calls.map(([panel]) => panel.key)).toEqual(['collaborators', 'comments', 'activity', 'metadata'])
    for (const [panel] of open.mock.calls)
      expect(panel.id).toMatchObject({uid: 'alice', path: ['app'], version: 'v1', blockRef: null, blockRange: null})
    expect(open.mock.calls[2]![0].filterEventType).toEqual([
      'comment/Embed',
      'doc/Embed',
      'doc/Link',
      'doc/Button',
      'metadata/Link',
    ])
  })
})

describe('getDocumentResourceRouteKey', () => {
  it('changes when only the document version changes', () => {
    const latest = hmId('alice', {path: ['doc'], latest: true})
    const versioned = hmId('alice', {path: ['doc'], version: 'version-1', latest: false})

    expect(getDocumentResourceRouteKey(latest)).not.toBe(getDocumentResourceRouteKey(versioned))
  })
})

describe('older version toast helpers', () => {
  it('does not show the toast when the route has no explicit version', () => {
    expect(
      shouldShowOlderVersionToast({
        routeDocId: hmId('alice', {path: ['doc']}),
        latestVersion: 'latest-version',
      }),
    ).toBe(false)
  })

  it('shows the toast for an explicit old-version route', () => {
    expect(
      shouldShowOlderVersionToast({
        routeDocId: hmId('alice', {path: ['doc'], version: 'old-version', latest: false}),
        latestVersion: 'latest-version',
      }),
    ).toBe(true)
  })

  it('does not show the toast when an explicit route version matches the latest known version', () => {
    expect(
      shouldShowOlderVersionToast({
        routeDocId: hmId('alice', {path: ['doc'], version: 'latest-version', latest: false}),
        latestVersion: 'latest-version',
      }),
    ).toBe(false)
  })

  it('does not show the toast before the latest version is known', () => {
    expect(
      shouldShowOlderVersionToast({
        routeDocId: hmId('alice', {path: ['doc'], version: 'old-version', latest: false}),
        latestVersion: null,
      }),
    ).toBe(false)
  })

  it('uses the same toast ID for different old versions of the same document', () => {
    const firstVersion = hmId('alice', {path: ['doc'], version: 'old-version-1', latest: false})
    const secondVersion = hmId('alice', {path: ['doc'], version: 'old-version-2', latest: false})

    expect(getOlderVersionToastId(firstVersion)).toBe(getOlderVersionToastId(secondVersion))
  })

  it('uses a separate short bottom-center toast for blocked old-version edit attempts', () => {
    const docId = hmId('alice', {path: ['doc'], version: 'old-version', latest: false})
    const options = getOldVersionEditBlockedToastOptions(docId)

    expect(options).toMatchObject({
      id: 'old-version-edit-blocked:hm://alice/doc',
      description: 'Go to the latest version to make changes.',
      duration: 3000,
      position: 'bottom-center',
    })
    expect(options.id).not.toBe(getOlderVersionToastId(docId))
    expect('action' in options).toBe(false)
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

describe('getDocumentMachineKey', () => {
  it('stays stable across any version change on the same document (no remount on publish/version reset)', () => {
    // Reproduces the "Publish button stays green" bug: publishing bumps the
    // resolved version (and the content route resets ?v= to latest), which
    // previously changed the key and recreated the machine mid/post-publish,
    // re-loading the just-cleared draft.
    const latest = hmId('alice', {path: ['doc']})
    const resolvedOld = hmId('alice', {path: ['doc'], version: 'v-old'})
    const resolvedNew = hmId('alice', {path: ['doc'], version: 'v-new'})
    expect(getDocumentMachineKey(resolvedOld)).toBe(getDocumentMachineKey(resolvedNew))
    expect(getDocumentMachineKey(resolvedOld)).toBe(getDocumentMachineKey(latest))
  })

  it('changes when the document path changes (first-publish slug)', () => {
    const draftRendered = hmId('alice', {path: ['-draft-1']})
    const publishedRendered = hmId('alice', {path: ['my-slug']})
    expect(getDocumentMachineKey(draftRendered)).not.toBe(getDocumentMachineKey(publishedRendered))
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

describe('getBlockCommentDraftReference', () => {
  const docId = hmId('alice', {
    path: ['doc'],
    latest: true,
    blockRef: 'current-selection',
    blockRange: {start: 1, end: 3},
  })
  const route: Extract<NavRoute, {key: 'document'}> = {key: 'document', id: docId}

  it('opens only the root Comments panel and retains the document selection', () => {
    const request = getBlockCommentDraftReference({route, version: 'published-version', blockId: 'quoted-block'})
    expect(request.route).toEqual({...route, panel: {key: 'comments', id: docId}})
    expect(request.route.id).toBe(docId)
    expect(request.reference.documentId).toBe(docId.id)
    expect(request.reference.commentId).toBeUndefined()
    expect(unpackHmId(request.reference.link)).toMatchObject({
      version: 'published-version',
      blockRef: 'quoted-block',
      blockRange: {expanded: false},
    })
    expect(unpackHmId(request.reference.link)?.latest).toBeFalsy()
  })

  it('queues a fragment for the thread root even when a nested reply is selected', () => {
    const panelDocId = hmId('bob', {path: ['discussion']})
    const threadRoute: typeof route = {
      ...route,
      panel: {key: 'comments', id: panelDocId, openComment: 'bob/root', replyCommentId: 'bob/reply'},
    }
    const request = getBlockCommentDraftReference({
      route: threadRoute,
      version: 'published-version',
      blockId: 'quoted-block',
      blockRange: {start: 2, end: 12},
    })
    expect(request.route).toBe(threadRoute)
    expect(request.reference.documentId).toBe(panelDocId.id)
    expect(request.reference.commentId).toBe('bob/root')
    expect(unpackHmId(request.reference.link)).toMatchObject({
      uid: 'alice',
      path: ['doc'],
      version: 'published-version',
      blockRef: 'quoted-block',
      blockRange: {start: 2, end: 12},
    })
  })

  it('pins the rendered source behind a republish alias without changing the alias route', () => {
    const sourceId = hmId('bob', {path: ['original']})
    const request = getBlockCommentDraftReference({
      route,
      sourceId,
      version: 'source-version',
      blockId: 'source-block',
    })
    expect(request.route.id).toBe(docId)
    expect(request.reference.documentId).toBe(docId.id)
    expect(unpackHmId(request.reference.link)).toMatchObject({
      uid: 'bob',
      path: ['original'],
      version: 'source-version',
      blockRef: 'source-block',
    })
  })

  it('targets the resolved root for a legacy reply link without changing its route', () => {
    const legacyRoute: typeof route = {
      ...route,
      panel: {key: 'comments', id: docId, openComment: 'alice/legacy-reply'},
    }
    const request = getBlockCommentDraftReference({
      route: legacyRoute,
      resolvedThreadRootId: 'alice/root',
      version: 'v1',
      blockId: 'block',
    })
    expect(request.route).toBe(legacyRoute)
    expect(request.reference.commentId).toBe('alice/root')
    expect(request.reference.documentId).toBe(docId.id)
  })

  it('uses the thread root when no specific reply is selected', () => {
    const threadRoute: typeof route = {...route, panel: {key: 'comments', id: docId, openComment: 'alice/root'}}
    const request = getBlockCommentDraftReference({route: threadRoute, version: 'v1', blockId: 'block'})
    expect(request.route).toBe(threadRoute)
    expect(request.reference.commentId).toBe('alice/root')
  })

  it('retains an existing root draft and replaces a different panel only when needed', () => {
    const commentsRoute: typeof route = {...route, panel: {key: 'comments', id: docId}}
    const active = getBlockCommentDraftReference({route: commentsRoute, version: 'v1', blockId: 'block'})
    expect(active.route).toBe(commentsRoute)
    expect(active.reference.commentId).toBeUndefined()
    const otherRoute: typeof route = {...route, panel: {key: 'collaborators', id: docId}}
    const opened = getBlockCommentDraftReference({route: otherRoute, version: 'v1', blockId: 'block'})
    expect(opened.route).toEqual(commentsRoute)
    expect(opened.route.id).toBe(docId)
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

  it('keeps the root open when the selected reply has a different parent', () => {
    const panelRoute = getCommentReplyPanelRoute({
      docId,
      isReplying: true,
      comment: {
        id: 'alice/nested-reply',
        replyParent: 'alice/first-reply',
        threadRoot: 'alice/root',
        version: 'reply-version',
        threadRootVersion: 'root-version',
        targetAccount: 'alice',
        targetPath: '/doc',
      } as any,
    })

    expect(panelRoute).toMatchObject({
      openComment: 'alice/root',
      replyCommentId: 'alice/nested-reply',
      isReplying: true,
      replyCommentVersion: 'reply-version',
      rootReplyCommentVersion: 'root-version',
    })
  })

  it('opens a selected reply without requesting composer focus from its reply count', () => {
    const panelRoute = getCommentReplyPanelRoute({
      docId,
      comment: {
        id: 'alice/reply',
        threadRoot: 'alice/root',
        targetAccount: 'alice',
        targetPath: '/doc',
      } as any,
    })

    expect(panelRoute.openComment).toBe('alice/root')
    expect(panelRoute.replyCommentId).toBe('alice/reply')
    expect(panelRoute.isReplying).toBeUndefined()
    expect(panelRoute.replyCommentVersion).toBeUndefined()
  })

  it('preserves the source document version and fragment when opening its thread', () => {
    const sourceId = hmId('alice', {
      path: ['doc'],
      version: 'document-version',
      blockRef: 'paragraph',
      blockRange: {start: 2, end: 8},
    })
    const panelRoute = getCommentReplyPanelRoute({
      docId: sourceId,
      comment: {
        id: 'alice/root',
        targetAccount: 'alice',
        targetPath: '/doc',
        targetVersion: 'older-version',
      } as any,
    })

    expect(panelRoute.id).toBe(sourceId)
  })

  it('does not set a separate reply target when the root refers to itself', () => {
    const panelRoute = getCommentReplyPanelRoute({
      docId,
      comment: {
        id: 'alice/root',
        threadRoot: 'alice/root',
        targetAccount: 'alice',
        targetPath: '/doc',
      } as any,
    })

    expect(panelRoute.openComment).toBe('alice/root')
    expect(panelRoute.replyCommentId).toBeUndefined()
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

describe('getCommentsPanelTarget', () => {
  const mainDocId = hmId('alice', {path: ['embedded-doc']})
  const sourceDocId = hmId('alice', {path: ['source-doc']})

  it('uses the comments panel source document and focused comment', () => {
    const panelRoute: Extract<NavRoute, {key: 'document'}>['panel'] = {
      key: 'comments',
      id: sourceDocId,
      openComment: 'alice/source-comment',
    }

    expect(getCommentsPanelTarget(mainDocId, panelRoute)).toEqual({
      docId: sourceDocId,
      openComment: 'alice/source-comment',
    })
  })

  it('uses the resolved document version when an inline-comments panel targets the same unpinned document', () => {
    const resolvedMainDocId = hmId('alice', {path: ['embedded-doc'], version: 'resolved-version'})
    const panelRoute: Extract<NavRoute, {key: 'document'}>['panel'] = {
      key: 'comments',
      id: mainDocId,
      targetBlockId: 'paragraph',
    }

    expect(getCommentsPanelTarget(resolvedMainDocId, panelRoute).docId.version).toBe('resolved-version')
  })

  it('uses the main document when no comments panel is open or another panel type is open', () => {
    expect(getCommentsPanelTarget(mainDocId, null)).toEqual({docId: mainDocId, openComment: undefined})
    expect(
      getCommentsPanelTarget(mainDocId, {
        key: 'activity',
        id: sourceDocId,
      }),
    ).toEqual({docId: mainDocId, openComment: undefined})
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

describe('getEffectiveCanEdit', () => {
  it('allows editing a local-only reserved draft before the draft record exists', () => {
    expect(
      getEffectiveCanEdit({
        canEdit: false,
        resourceFetchId: null,
        existingDraft: undefined,
        reservedDraftId: 'draft-1',
      }),
    ).toBe(true)
  })

  it('does not let a reserved draft unlock a published resource route', () => {
    expect(
      getEffectiveCanEdit({
        canEdit: false,
        resourceFetchId: hmId('alice', {path: ['doc']}),
        existingDraft: undefined,
        reservedDraftId: 'draft-1',
      }),
    ).toBe(false)
  })
})

describe('getDocumentSyncIsPlaceholderData', () => {
  it('does not treat a fabricated local draft document as stale React Query placeholder data', () => {
    expect(
      getDocumentSyncIsPlaceholderData({
        resourceFetchId: null,
        hasUnpublishedDraft: true,
        resourceIsPreviousData: true,
      }),
    ).toBe(false)
  })

  it('still skips retained published-resource data while a version route is loading', () => {
    expect(
      getDocumentSyncIsPlaceholderData({
        resourceFetchId: hmId('alice', {path: ['doc']}),
        hasUnpublishedDraft: false,
        resourceIsPreviousData: true,
      }),
    ).toBe(true)
  })
})

describe('getCitationsTargetId', () => {
  it('skips citations for unpublished draft placeholder documents', () => {
    expect(
      getCitationsTargetId({
        docId: hmId('alice', {path: ['new-doc']}),
        documentVersion: '',
      }),
    ).toBeNull()
  })

  it('skips citations for pending-space local documents', () => {
    expect(
      getCitationsTargetId({
        docId: hmId('pending-123', {path: []}),
        documentVersion: 'version-1',
      }),
    ).toBeNull()
  })

  it('fetches citations for published documents without block fragments', () => {
    expect(
      getCitationsTargetId({
        docId: hmId('alice', {
          path: ['doc'],
          version: 'version-1',
          blockRef: 'block-1',
          blockRange: {expanded: true},
        }),
        documentVersion: 'version-1',
      }),
    ).toEqual(hmId('alice', {path: ['doc'], version: 'version-1', blockRef: null, blockRange: null}))
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

describe('resolveEffectiveExistingDraft', () => {
  const draft = {id: 'draft-1', metadata: {name: 'Draft'}} as any

  it('preserves undefined (draft still loading) so the machine does not latch to no-draft', () => {
    // Regression: during the async startup window `existingDraft` is undefined and
    // `shouldUseDraft` is false (since `!undefined` is truthy). Collapsing to false
    // here fired `draft.resolved{draftId:null}` and stranded a saved draft on reload.
    expect(resolveEffectiveExistingDraft(undefined, false)).toBeUndefined()
    expect(resolveEffectiveExistingDraft(undefined, true)).toBeUndefined()
  })

  it('returns the draft once settled and the draft should be used', () => {
    expect(resolveEffectiveExistingDraft(draft, true)).toBe(draft)
  })

  it('returns false when settled with no draft, or when the draft should not be used', () => {
    expect(resolveEffectiveExistingDraft(false, true)).toBe(false)
    expect(resolveEffectiveExistingDraft(draft, false)).toBe(false)
  })
})
