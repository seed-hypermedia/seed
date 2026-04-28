import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {
  HMBlockNode,
  HMDocument,
  HMDraft,
  HMMetadata,
  HMNavigationItem,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {assign, emit, fromPromise, raise, setup, spawnChild, StateFrom} from 'xstate'

// -- Types --

/** Input provided when creating the document machine actor. */
export type DocumentMachineInput = {
  documentId: UnpackedHypermediaId
  canEdit: boolean
  isLatest?: boolean
  existingDraftId?: string
  editUid?: string
  editPath?: string[]
  locationUid?: string
  locationPath?: string[]
  deps?: string[]
  signingAccountId?: string
  publishAccountUid?: string
}

/**
 * Pending rebase state recorded during editing.
 * - `auto`: non-overlapping incoming changes can be merged silently.
 * - `conflict`: at least one block was touched on both sides — Phase B handles picks.
 */
export type PendingRebase =
  | {kind: 'auto'; author: string | null}
  | {kind: 'conflict'; conflictedBlockIds: string[]; author: string | null}

/** Full context managed by the machine. */
export type DocumentMachineContext = {
  documentId: UnpackedHypermediaId
  draftId: string | null
  document: HMDocument | null
  metadata: HMDraft['metadata']
  deps: string[]
  publishedVersion: string | null
  pendingRemoteVersion: string | null
  isLatestVersion: boolean
  navigation: HMNavigationItem[] | undefined
  locationUid: string
  locationPath: string[]
  editUid: string
  editPath: string[]
  canEdit: boolean
  hasChangedWhileSaving: boolean
  draftCreated: boolean
  /** True only when machine was initialized with an existingDraftId — drives auto-enter editing. Cleared after first use. */
  shouldAutoEdit: boolean
  signingAccountId: string | null
  publishAccountUid: string | null
  /** True once the document query has resolved during loading. */
  documentReady: boolean
  /** True once the draft query has resolved during loading (either found or not found). */
  draftReady: boolean
  /** Draft content loaded on init. Only set during loading — not updated on autosave. */
  draftContent: HMBlockNode[] | null
  /** Cursor position saved in the draft file; restored when re-entering editing after reload. */
  draftCursorPosition: number | null
  /** Published content in editor-block format. Baseline for unpublished-change diffs. */
  editorBaseline: EditorBlock[] | null
  /** Snapshot of the published blocks taken on entry to editing. Used as the three-way merge base. */
  baseBlocks: HMBlockNode[] | null
  /** Block IDs touched by the local user since edit start (from ProseMirror tr listener). */
  mineTouchedIds: string[]
  /** Full remote document stashed on remoteUpdate while editing. Classification runs outside the machine. */
  pendingRemoteDocument: HMDocument | null
  /** Classification of pending remote update: auto-mergeable or conflict. */
  pendingRebase: PendingRebase | null
  error: unknown
}

/** All events the machine can receive. */
export type DocumentMachineEvent =
  | {type: 'document.loaded'; document: HMDocument}
  | {type: 'document.error'; error: unknown}
  | {type: 'document.retry'}
  | {type: 'edit.start'}
  | {type: 'edit.cancel'}
  | {type: 'change'; metadata?: HMDraft['metadata']}
  | {type: 'change.navigation'; navigation: HMNavigationItem[]}
  | {type: 'reset.content'}
  | {type: 'publish.start'}
  | {type: 'document.remoteUpdate'; document: HMDocument}
  | {type: 'edit.discard'}
  | {type: 'capability.changed'; canEdit: boolean}
  | {type: 'account.changed'; signingAccountId?: string; publishAccountUid?: string}
  | {type: 'edit.confirm'}
  | {type: 'version.changed'; isLatest: boolean}
  | {type: 'draft.existing'; draftId: string}
  | {
      type: 'draft.resolved'
      draftId: string | null
      content: HMBlockNode[] | null
      cursorPosition: number | null
      metadata?: HMMetadata | null
      /** Block IDs the user previously touched in this draft (persisted across reloads). */
      mineTouchedIds?: string[] | null
      /** Three-way merge base captured when the draft was first started or last rebased. */
      baseBlocks?: HMBlockNode[] | null
    }
  | {type: '_save.started'}
  | {type: '_save.completed'}
  | {type: 'editor.baselineUpdate'; blocks: EditorBlock[]}
  | {type: 'scroll'}
  | {type: 'rebase.blockTouched'; blockIds: string[]}
  | {type: 'rebase.apply'; mergedBlocks: HMBlockNode[]; newDocument: HMDocument}
  | {type: 'rebase.detectConflict'; conflictedBlockIds: string[]; author: string | null}
  | {type: 'rebase.dismiss'}

/** Input for the writeDraft actor. */
export type WriteDraftInput = {
  draftId: string | null
  metadata: HMDraft['metadata']
  deps: string[]
  navigation: HMNavigationItem[] | undefined
  locationUid: string
  locationPath: string[]
  editUid: string
  editPath: string[]
  signingAccountId: string | null
  /** Block IDs the user has locally touched since edit-start (or last rebase). */
  mineTouchedIds: string[]
  /** Three-way merge base captured at edit-start (or updated by `rebase.apply`). */
  baseBlocks: HMBlockNode[] | null
}

/** Input for the publishDocument actor. */
export type PublishInput = {
  documentId: UnpackedHypermediaId
  draftId: string
  deps: string[]
  metadata: HMDraft['metadata']
  navigation: HMNavigationItem[] | undefined
  publishAccountUid: string | null
}

/** Input for the pushDocument actor, fired after a successful publish. */
export type PushDocumentInput = {
  publishedDocument: HMDocument
}

export type DocumentMachineState = StateFrom<typeof documentMachine>

// -- Machine --

export const documentMachine = setup({
  types: {
    input: {} as DocumentMachineInput,
    context: {} as DocumentMachineContext,
    events: {} as DocumentMachineEvent,
    emitted: {} as {type: 'scrolling'},
  },
  actions: {
    setDocumentData: assign({
      document: ({event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return event.document
        }
        return null
      },
      publishedVersion: ({event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return event.document.version
        }
        return null
      },
      editorBaseline: ({event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return hmBlocksToEditorContent(event.document.content ?? [], {childrenType: 'Group'})
        }
        return null
      },
    }),
    setMetadata: assign({
      metadata: ({context, event}) => {
        if (event.type === 'change' && event.metadata) {
          return {...context.metadata, ...event.metadata}
        }
        return context.metadata
      },
    }),
    setNavigation: assign({
      navigation: ({event}) => {
        if (event.type === 'change.navigation') {
          return event.navigation
        }
        return undefined
      },
    }),
    setDepsFromPublished: assign({
      deps: ({context}) => (context.publishedVersion ? [context.publishedVersion] : context.deps),
    }),
    setPendingRemoteVersion: assign({
      pendingRemoteVersion: ({event}) => {
        if (event.type === 'document.remoteUpdate') {
          return event.document.version
        }
        return null
      },
    }),
    setDraftIdFromResult: assign({
      draftId: (_, params: {id: string}) => params.id,
    }),
    setDraftCreated: assign({
      draftCreated: true,
    }),
    resetChangeWhileSaving: assign({
      hasChangedWhileSaving: false,
    }),
    setHasChangedWhileSaving: assign({
      hasChangedWhileSaving: true,
    }),
    setError: assign({
      error: ({event}) => {
        if (event.type === 'document.error') {
          return event.error
        }
        return null
      },
    }),
    clearShouldAutoEdit: assign({
      shouldAutoEdit: false,
    }),
    setCanEdit: assign({
      canEdit: ({event}) => {
        if (event.type === 'capability.changed') {
          return event.canEdit
        }
        return false
      },
    }),
    setIsLatestVersion: assign({
      isLatestVersion: ({event}) => (event.type === 'version.changed' ? event.isLatest : true),
    }),
    clearDraftState: assign({
      draftId: null,
      draftCreated: false,
      hasChangedWhileSaving: false,
      pendingRemoteVersion: null,
      draftContent: null,
      draftCursorPosition: null,
      metadata: {},
      navigation: undefined,
      baseBlocks: null,
      mineTouchedIds: [],
      pendingRemoteDocument: null,
      pendingRebase: null,
    }),
    clearEditingState: assign({
      // Preserve draftId and metadata so re-entering editing reuses the same draft
      // and title/summary changes remain visible outside editing mode.
      draftCreated: false,
      hasChangedWhileSaving: false,
      pendingRemoteVersion: null,
      baseBlocks: null,
      mineTouchedIds: [],
      pendingRemoteDocument: null,
      pendingRebase: null,
    }),
    snapshotBaseBlocks: assign({
      baseBlocks: ({context}) => {
        // Preserve restored base blocks from a reloaded draft. We only snapshot
        // fresh from the published document when starting a brand-new draft
        // session (baseBlocks === null and not yet hydrated by draft.resolved).
        if (context.baseBlocks && context.baseBlocks.length) {
          console.log('[Rebase machine] snapshotBaseBlocks: preserving restored', {
            count: context.baseBlocks.length,
          })
          return context.baseBlocks
        }
        const blocks = context.document?.content ?? []
        console.log('[Rebase machine] snapshotBaseBlocks: fresh', {
          count: blocks.length,
          ids: blocks.map((n) => n.block?.id),
          publishedVersion: context.publishedVersion,
        })
        return blocks
      },
      mineTouchedIds: ({context}) => {
        // Preserve restored mineTouchedIds across reload; reset only on a truly
        // fresh edit-start where nothing was loaded from disk.
        if (context.mineTouchedIds.length) return context.mineTouchedIds
        return []
      },
    }),
    appendMineTouched: assign({
      mineTouchedIds: ({context, event}) => {
        if (event.type !== 'rebase.blockTouched') return context.mineTouchedIds
        if (!event.blockIds.length) return context.mineTouchedIds
        const seen = new Set(context.mineTouchedIds)
        let changed = false
        for (const id of event.blockIds) {
          if (!seen.has(id)) {
            seen.add(id)
            changed = true
          }
        }
        const next = changed ? Array.from(seen) : context.mineTouchedIds
        if (changed) {
          console.log('[Rebase machine] appendMineTouched', {added: event.blockIds, total: next})
        }
        return next
      },
    }),
    setPendingRemoteDocument: assign({
      pendingRemoteDocument: ({event}) => {
        if (event.type === 'document.remoteUpdate') {
          console.log('[Rebase machine] setPendingRemoteDocument', {
            version: event.document.version,
            blockIds: (event.document.content ?? []).map((n) => n.block?.id),
          })
          return event.document
        }
        return null
      },
    }),
    applyRebaseMerge: assign({
      document: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.document
        console.log('[Rebase machine] applyRebaseMerge', {
          fromDeps: context.deps,
          toDeps: event.newDocument.version ? [event.newDocument.version] : context.deps,
          fromMineTouched: context.mineTouchedIds,
          mergedBlockCount: event.mergedBlocks.length,
        })
        return event.newDocument
      },
      publishedVersion: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.publishedVersion
        return event.newDocument.version
      },
      deps: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.deps
        return event.newDocument.version ? [event.newDocument.version] : context.deps
      },
      baseBlocks: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.baseBlocks
        return event.mergedBlocks
      },
      mineTouchedIds: [],
      pendingRemoteDocument: null,
      pendingRemoteVersion: null,
      pendingRebase: null,
    }),
    setRebaseConflict: assign({
      pendingRebase: ({event}): PendingRebase | null => {
        if (event.type !== 'rebase.detectConflict') return null
        return {
          kind: 'conflict',
          conflictedBlockIds: event.conflictedBlockIds,
          author: event.author,
        }
      },
    }),
    clearPendingRebase: assign({
      pendingRebase: null,
    }),
    markDocumentReady: assign({
      documentReady: true,
    }),
    setDraftResolved: assign({
      draftReady: true,
      draftId: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.draftId) return event.draftId
        return context.draftId
      },
      draftCreated: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.draftId) return true
        return context.draftCreated
      },
      shouldAutoEdit: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.draftId) return true
        return context.shouldAutoEdit
      },
      draftContent: ({event}) => {
        if (event.type === 'draft.resolved') return event.content ?? null
        return null
      },
      draftCursorPosition: ({event}) => {
        if (event.type === 'draft.resolved') return event.cursorPosition ?? null
        return null
      },
      metadata: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.metadata) return event.metadata
        return context.metadata
      },
      mineTouchedIds: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.mineTouchedIds && event.mineTouchedIds.length) {
          return event.mineTouchedIds
        }
        return context.mineTouchedIds
      },
      baseBlocks: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.baseBlocks && event.baseBlocks.length) {
          return event.baseBlocks
        }
        return context.baseBlocks
      },
    }),
    setExistingDraft: assign({
      draftId: ({event}) => {
        if (event.type === 'draft.existing') {
          return event.draftId
        }
        return null
      },
      draftCreated: true,
      shouldAutoEdit: true,
      draftReady: true,
    }),
    setAccountIds: assign({
      signingAccountId: ({context, event}) => {
        if (event.type === 'account.changed' && event.signingAccountId !== undefined) {
          return event.signingAccountId || null
        }
        return context.signingAccountId
      },
      publishAccountUid: ({context, event}) => {
        if (event.type === 'account.changed' && event.publishAccountUid !== undefined) {
          return event.publishAccountUid || null
        }
        return context.publishAccountUid
      },
    }),
    setEditorEditable: () => {
      // Provided via .provide() in the React layer (editor handlers ref)
    },
    setEditorReadOnly: () => {
      // Provided via .provide() in the React layer (editor handlers ref)
    },
    applyInitialContentToEditor: () => {
      // Provided via .provide() in the React layer (editor handlers ref)
    },
    placeCursorFromPendingOrDraft: () => {
      // Provided via .provide() in the React layer (editor handlers ref)
    },
    updatePublishedVersion: assign({
      publishedVersion: ({event}) => {
        // After publish completes, the done event output is the new HMDocument
        // We extract the version from it
        const doc = (event as any).output as HMDocument
        return doc?.version ?? null
      },
      document: ({event}) => {
        const doc = (event as any).output as HMDocument
        return doc ?? null
      },
      editorBaseline: ({event}) => {
        const doc = (event as any).output as HMDocument
        if (!doc) return null
        return hmBlocksToEditorContent(doc.content ?? [], {childrenType: 'Group'})
      },
    }),
    setEditorBaselineFromSnapshot: assign({
      editorBaseline: ({event, context}) => {
        if (event.type === 'editor.baselineUpdate') return event.blocks
        return context.editorBaseline
      },
    }),
  },
  guards: {
    canTransitionToEditing: ({context}) => {
      const result = context.canEdit
      console.log('[DocMachine] guard canTransitionToEditing', {
        canEdit: context.canEdit,
        isLatestVersion: context.isLatestVersion,
        draftId: context.draftId,
        result,
      })
      return result
    },
    canEditOldVersion: ({context}) => {
      const result = context.canEdit && !context.isLatestVersion && context.draftId === null
      console.log('[DocMachine] guard canEditOldVersion', {
        canEdit: context.canEdit,
        isLatestVersion: context.isLatestVersion,
        draftId: context.draftId,
        result,
      })
      return result
    },
    didChangeWhileSaving: ({context}) => context.hasChangedWhileSaving,
    hasDraftId: ({context}) => context.draftId !== null,
    hasExistingDraft: ({context}) => context.shouldAutoEdit,
    hasRemoteUpdate: ({context}) => context.pendingRemoteVersion !== null,
    bothSourcesReady: ({context}) => context.documentReady && context.draftReady,
    capabilityLost: ({event}) => event.type === 'capability.changed' && !event.canEdit,
    /** Block publish while an unresolved rebase conflict is pending. */
    canPublishGivenRebaseState: ({context}) => context.draftId !== null && context.pendingRebase?.kind !== 'conflict',
  },
  actors: {
    writeDraft: fromPromise<{id: string}, WriteDraftInput>(async () => {
      throw new Error('writeDraft actor must be provided via .provide()')
    }),
    publishDocument: fromPromise<HMDocument, PublishInput>(async () => {
      throw new Error('publishDocument actor must be provided via .provide()')
    }),
    pushDocument: fromPromise<void, PushDocumentInput>(async () => {
      // Default no-op: consumers that want push-on-publish must provide this actor.
      return
    }),
  },
  delays: {
    autosaveTimeout: 500,
    loadingTimeout: 10_000,
    saveIndicatorDismiss: 1000,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBED2BjArgWzAOwBcAZASwDMx0BPdAGzADpbUBDCEvKAYggx3wJNWESAG0ADAF1EoAA6pYJAiVR4ZIAB6IAHOIDsDACyGAnCYCse7SYCM2mw4A0IKogBM58QwBsAZmt63tp6Nt4WFgC+Ec5oWLiEpBTUdIzMbBzcvHECDGAATnmoeRLSSCDyisqq6loIpiYMFuL22m7ihuIehs6uCG6+5gzawd5u-d7ifg5RMXzxxOSUNPRC6ZxcGrAELASMLGS7eQAUaeycACokuKiYBACUXLH8CYvJK6cZJeoVSipqZbVzDZBn5tL5jOITNpRsCeohzGEfOZhiY3CZDHpkcYZiAnvNEksUqsRBAuJAlAwtiw8gQvmUflV-qBajZfFCGOIbP1fA4uX5vOY4Qg9B4GG4HOJzFCJYYxji8QICW9UsJIDw5jk8mBsKhdgBVWQQHZgOlyBS-aoAxAmPQNKGmXydSFBcFChzaJHWNnacyGcyWQLyjUvJLLFVsNWm8rmxk1RCs9mc7m8tz8wUuRC+PxGaxhTwmbyGByGIPZEOElbk5TrKsMdAsPDoMC0KMMv5xhCszkMLlF8H2foWboZhD2HvBNzQqysnmF0vPBaholVjJcdAACwbMAYeBYADcSFAdn9WzH21bO3pwT5UZy9HpDKNbUKBjYOeY2j6gh-J9p5-jXjDXJ2GrbgNy3RhdwPI9GVEGxSjNSpz2ZeMr0MG82hse9HzcZ8RxTBhbUCItDAGP0oX-RVAOXEDVyyBcGC1HV9UNY1TyQy0UL6B8DFIvlmnFXQ3DdaEGA-CZjARcxfF8NxSMo8tlWA35OAYEgIHoNdN04E0pG+M9OM0dxWi8TpRk5STPEmIVMUGWxtCLe8HPsLCFMXCtGBXVT1M0rVYDAQR0FUXZCHYi0mSMvoTI5VNMMs8RrJHH03w8EJbKCAdzDcpUgK8qA1I0sAuFkTAACNaBIWB10pbYaTC2MLw-N0eV8G92mMMwEtlGxsuoytaNU8CdNJIaYHq5DIp5XCGF8B80UhLCpVTIVvyGIFrBsSErALHrolxYN3KUvK620mBST8gK62CgRxsM2opta3R7VTUj7JWgYhhMfR-A-DETFk3ql36lT8tGtVNm2XYGH2Q4jhYW4FH3MBLmuW4HgVRTcoG0HTrEPT6QMiL7twhoxgFcRZtTPRORs4IjARbwsL9YFbRMQGPOU0CTog0kIeNaGDnyOGEdgJGUbAG57keA6cpokHueGuCEOjDiieMtoYvMmx4sS3pqY9CwHx9UiMoLdmjuxustWPdZeDwRgOD3VAAGtGAAdzyJQwGQPIYdutW+lfIwC1MJ9ZWGXw3WBdDvELRnsNsaSSz2jHDqx+X0Gt0D1XttS8Cd12GA9r2fb9+D9NVjt+iBYPCwLXDw7BN0KZBfxbUlATCz0c3065zOwBt7h8kKPIGFkWgdjIIpsCLz3dlLg5-aroPQ9Dhvf0jkd0Vax1OllRmWqCHu5b7rPVzBpeLzabxeLCVMbAsLM+yFMw3xCWwQ+CdpwWP4HT4H7OF1ArXVCvjRC4Uq6TFvqiRmj9CysiFLmGauhSJf0dPvX+nlLaiwPLbVQDt84u3dnPb2vtF5gJVhAi8Ax0SETktJEYaI8J60mI0SUuFZrWHRLtWYZY04nwyJSfcdF8F5wLsQkuZDaTlwJpXahjpBgP0COKKYQQX5XjFJw2BN8hxZRTjLPqWD5Y4NXMPIoY8J4ECnnkGexd55SMvlxcEGsBiTFTJKHknQhSmHQmMbWhYAxjFRJgzmgiTHrAvhQtsd1MwClaglL6WYrybShN4IUWIhi2jkgMIEkpQghOOuE7gQCrqEBulEwmHYszSQ5JCCmN9PGpO8dYMSHRDA+kCNTTw94QklXKpVdcgiOAAAVChQD8rAHOBDxFjzKhVKqqdHGTWaIRAstopTEVZHoRB3Yiwuk5AKOw4pelzIGUMvAozUDjLgJMsxo9x6T2nrM-pCyDpLNqDaVqsUzDBHaeKCwiDURiTCK+bqzQH4nJeYMwa9AGwZANFwd51oNHfKhEbf56ZejSTcKsiYaJ0GShvlEPaeBUAiHgGUVOst6AVyoVxAAtP4sS99QiDmkveIU9K7JmB5QKG+j5qZuBCR8TgtKGpcSBdCQs-gKaoP+m6IsYkZKJMhOJMwejeELmpeGEkYqJosjJjNGSD8ZyTD9MOXoAwDaYk6FCGSyIgQav2nw7VoTRWyLpZFUIok753gfE+EwQpUyPTjknHJvp5L6JdYYt1+UfJgD1TE7iDgjBFm1jOEIyI0lb0LHQx0LQsKEr-FGrVMbjpgwgImgOPJZRrU5Ale8skPyYsQFYbwPYvqFmGC0AsbMS0ASBkY-+g8q2QMfEMLCN8b5SlGNJKOdhCJ+jJiKKUsli2aoHRzQpwj3XgPFZNPwOKBgPkdbNZom89bIiGLHa+WzoQA37VRQdzz5nQqgKOi89L2TiQcKMNk7KQgrWzH4La1cEmBkfZjIkfTX3nMudc2AFK936sQFyrwP7WX-tmiEC1rbbC1K7t67ptpIWwZhQPPA8LZAfq4s2nsmJbAU02oEawNlPATvsP9aEzQP4FIKEUGjkURQpQ6X4fwX0sLbJHMYdtbJJwZTcTabwxKIhAA */
  id: 'DocumentLifecycle',
  on: {
    scroll: {
      actions: emit({type: 'scrolling'}),
    },
    'editor.baselineUpdate': {
      actions: ['setEditorBaselineFromSnapshot'],
    },
  },
  context: ({input}) => ({
    documentId: input.documentId,
    draftId: input.existingDraftId ?? null,
    document: null,
    metadata: {},
    deps: input.deps ?? [],
    publishedVersion: null,
    pendingRemoteVersion: null,
    isLatestVersion: input.isLatest ?? true,
    navigation: undefined,
    locationUid: input.locationUid ?? '',
    locationPath: input.locationPath ?? [],
    editUid: input.editUid ?? '',
    editPath: input.editPath ?? [],
    canEdit: input.canEdit,
    hasChangedWhileSaving: false,
    draftCreated: !!input.existingDraftId,
    shouldAutoEdit: !!input.existingDraftId,
    signingAccountId: input.signingAccountId ?? null,
    publishAccountUid: input.publishAccountUid ?? null,
    documentReady: false,
    draftReady: !!input.existingDraftId,
    draftContent: null,
    draftCursorPosition: null,
    editorBaseline: null,
    baseBlocks: null,
    mineTouchedIds: [],
    pendingRemoteDocument: null,
    pendingRebase: null,
    error: null,
  }),
  initial: 'loading',
  states: {
    loading: {
      on: {
        'document.loaded': {
          // Don't transition yet — wait for draft resolution too.
          actions: ['setDocumentData', 'markDocumentReady'],
        },
        'draft.resolved': {
          actions: ['setDraftResolved'],
        },
        'document.error': {
          // Stay in loading — React Query retries in the background.
          // Store the error for optional inline display (e.g. "retrying…").
          actions: ['setError'],
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'draft.existing': {
          actions: ['setExistingDraft'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
      always: {
        target: 'loaded',
        guard: 'bothSourcesReady',
      },
      after: {
        loadingTimeout: {
          target: 'error',
        },
      },
    },

    loaded: {
      on: {
        'edit.start': [
          {
            target: 'confirmingOldVersionEdit',
            guard: 'canEditOldVersion',
          },
          {
            target: 'editing',
            guard: 'canTransitionToEditing',
            actions: ['setDepsFromPublished', 'snapshotBaseBlocks'],
          },
        ],
        'document.remoteUpdate': {
          target: 'loaded',
          actions: ['setDocumentData'],
          reenter: true,
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
        'draft.existing': {
          target: 'editing',
          actions: ['setExistingDraft', 'clearShouldAutoEdit', 'setDepsFromPublished', 'snapshotBaseBlocks'],
        },
      },
      always: {
        target: 'editing',
        guard: ({context}) => context.shouldAutoEdit && context.isLatestVersion,
        actions: ['clearShouldAutoEdit', 'setDepsFromPublished', 'snapshotBaseBlocks'],
      },
    },

    confirmingOldVersionEdit: {
      entry: () => console.log('[DocMachine] enter confirmingOldVersionEdit'),
      exit: () => console.log('[DocMachine] exit confirmingOldVersionEdit'),
      on: {
        'edit.confirm': {
          target: 'editing',
          actions: [
            () => console.log('[DocMachine] edit.confirm received → editing'),
            'setDepsFromPublished',
            'snapshotBaseBlocks',
          ],
        },
        'edit.cancel': {
          target: 'loaded',
          actions: [() => console.log('[DocMachine] edit.cancel received in confirmingOldVersionEdit → loaded')],
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
    },

    editing: {
      type: 'parallel',
      entry: [
        () => console.log('[DocMachine] enter editing'),
        {type: 'setEditorEditable'},
        {type: 'applyInitialContentToEditor'},
        {type: 'placeCursorFromPendingOrDraft'},
      ],
      exit: [() => console.log('[DocMachine] exit editing'), {type: 'setEditorReadOnly'}],
      on: {
        'edit.cancel': {
          target: 'loaded',
          actions: [() => console.log('[DocMachine] edit.cancel received in editing → loaded'), 'clearEditingState'],
        },
        'edit.discard': {
          target: 'loaded',
          actions: [() => console.log('[DocMachine] edit.discard received in editing → loaded'), 'clearDraftState'],
        },
        'capability.changed': [
          {
            target: 'loaded',
            guard: 'capabilityLost',
            actions: ['setCanEdit', 'clearEditingState'],
          },
          {
            actions: ['setCanEdit'],
          },
        ],
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'document.remoteUpdate': {
          actions: ['setPendingRemoteVersion', 'setPendingRemoteDocument'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
        'rebase.blockTouched': {
          actions: ['appendMineTouched'],
        },
      },
      states: {
        draft: {
          initial: 'idle',
          on: {
            'change.navigation': [
              {
                target: '.saving',
                guard: 'hasDraftId',
                actions: ['setNavigation'],
              },
              {
                target: '.creating',
                actions: ['setNavigation'],
              },
            ],
          },
          states: {
            idle: {
              on: {
                change: {
                  target: 'changed',
                  actions: ['setMetadata'],
                },
                'reset.content': {
                  target: 'changed',
                },
                'publish.start': {
                  target: '#DocumentLifecycle.publishing',
                  guard: 'canPublishGivenRebaseState',
                },
              },
            },
            changed: {
              on: {
                change: {
                  target: 'changed',
                  actions: ['setMetadata'],
                  reenter: true,
                },
                'reset.content': {
                  target: 'changed',
                  reenter: true,
                },
              },
              after: {
                autosaveTimeout: [
                  {
                    target: 'saving',
                    guard: 'hasDraftId',
                  },
                  {
                    target: 'creating',
                  },
                ],
              },
            },
            creating: {
              entry: ['resetChangeWhileSaving', raise({type: '_save.started'})],
              on: {
                change: {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'reset.content': {
                  actions: ['setHasChangedWhileSaving'],
                },
              },
              invoke: {
                id: 'writeDraft',
                src: 'writeDraft',
                input: ({context}) => ({
                  draftId: context.draftId,
                  metadata: context.metadata,
                  deps: context.deps,
                  navigation: context.navigation,
                  locationUid: context.locationUid,
                  locationPath: context.locationPath,
                  editUid: context.editUid,
                  editPath: context.editPath,
                  signingAccountId: context.signingAccountId,
                  mineTouchedIds: context.mineTouchedIds,
                  baseBlocks: context.baseBlocks,
                }),
                onDone: [
                  {
                    target: 'saving',
                    guard: 'didChangeWhileSaving',
                    actions: [
                      'setDraftCreated',
                      {
                        type: 'setDraftIdFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                    ],
                    reenter: true,
                  },
                  {
                    target: 'idle',
                    actions: [
                      'setDraftCreated',
                      {
                        type: 'setDraftIdFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                      raise({type: '_save.completed'}),
                    ],
                  },
                ],
                onError: {
                  target: 'idle',
                  actions: [
                    ({event}: {event: any}) => {
                      console.error('Draft create failed:', event.error)
                    },
                    raise({type: '_save.completed'}),
                  ],
                },
              },
            },
            saving: {
              entry: ['resetChangeWhileSaving', raise({type: '_save.started'})],
              on: {
                change: {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'reset.content': {
                  actions: ['setHasChangedWhileSaving'],
                },
              },
              invoke: {
                id: 'writeDraft',
                src: 'writeDraft',
                input: ({context}) => ({
                  draftId: context.draftId,
                  metadata: context.metadata,
                  deps: context.deps,
                  navigation: context.navigation,
                  locationUid: context.locationUid,
                  locationPath: context.locationPath,
                  editUid: context.editUid,
                  editPath: context.editPath,
                  signingAccountId: context.signingAccountId,
                  mineTouchedIds: context.mineTouchedIds,
                  baseBlocks: context.baseBlocks,
                }),
                onDone: [
                  {
                    target: 'saving',
                    guard: 'didChangeWhileSaving',
                    reenter: true,
                  },
                  {
                    target: 'idle',
                    actions: [raise({type: '_save.completed'})],
                  },
                ],
                onError: {
                  target: 'idle',
                  actions: [
                    ({event}: {event: any}) => {
                      console.error('Draft save failed:', event.error)
                    },
                    raise({type: '_save.completed'}),
                  ],
                },
              },
            },
          },
        },
        saveIndicator: {
          initial: 'hidden',
          states: {
            hidden: {
              on: {
                '_save.started': {
                  target: 'saving',
                },
              },
            },
            saving: {
              on: {
                '_save.completed': {
                  target: 'saved',
                },
              },
            },
            saved: {
              after: {
                saveIndicatorDismiss: {
                  target: 'hidden',
                },
              },
              on: {
                '_save.started': {
                  target: 'saving',
                },
              },
            },
          },
        },
        // Rebase region: tracks whether an incoming remote update has been
        // classified as a conflict awaiting Phase B resolution. The actual
        // classification + auto-merge happens in `useAutoRebase` (React layer);
        // the machine just records the resulting state so guards (like
        // publish.start) and selectors can read it explicitly.
        rebase: {
          initial: 'idle',
          states: {
            idle: {
              entry: () => console.log('[Rebase machine] region.idle entered'),
              on: {
                'rebase.detectConflict': {
                  target: 'conflict',
                  actions: ['setRebaseConflict'],
                },
                // Auto-merge applied from idle stays in idle; the action
                // updates context (document/deps/baseBlocks) and clears
                // pending fields.
                'rebase.apply': {
                  actions: ['applyRebaseMerge'],
                },
              },
            },
            conflict: {
              entry: () => console.log('[Rebase machine] region.conflict entered'),
              on: {
                'rebase.apply': {
                  target: 'idle',
                  actions: ['applyRebaseMerge'],
                },
                'rebase.dismiss': {
                  target: 'idle',
                  actions: ['clearPendingRebase'],
                },
              },
            },
          },
        },
      },
    },

    publishing: {
      initial: 'inProgress',
      states: {
        inProgress: {
          invoke: {
            id: 'publishDocument',
            src: 'publishDocument',
            input: ({context}) => ({
              documentId: context.documentId,
              draftId: context.draftId!,
              deps: context.deps,
              metadata: context.metadata,
              navigation: context.navigation,
              publishAccountUid: context.publishAccountUid,
            }),
            onDone: {
              target: 'cleaningUp',
            },
            onError: {
              target: '#DocumentLifecycle.editing.draft.idle',
            },
          },
        },
        cleaningUp: {
          entry: [
            'clearDraftState',
            'updatePublishedVersion',
            // Fire-and-forget push to destination servers. The spawned child runs
            // independently of the machine's state transitions; its outcome is
            // surfaced via toast in the consumer-provided actor.
            spawnChild('pushDocument', {
              input: ({event}) => ({
                publishedDocument: (event as any).output as HMDocument,
              }),
            }),
          ],
          always: {
            target: '#DocumentLifecycle.loaded',
          },
        },
      },
    },

    error: {
      on: {
        'document.retry': {
          target: 'loading',
          actions: [assign({error: null})],
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
    },
  },
})
