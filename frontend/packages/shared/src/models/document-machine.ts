import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {
  entityQueryPathToHmIdPath,
  HMBlockChildrenType,
  HMBlockNode,
  HMDocument,
  HMDraft,
  HMMetadata,
  HMNavigationItem,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {collectChildDraftIds} from '../utils/child-draft-refs'
import {assign, emit, fromPromise, raise, setup, spawnChild, StateFrom} from 'xstate'

const DOCUMENT_EMBED_CLEANUP_LOG_PREFIX = '[Document embed cleanup]'

function getTopLevelBlockCount(blocks: unknown[] | null | undefined) {
  return Array.isArray(blocks) ? blocks.length : 0
}

type QueryInclude = {
  space?: unknown
  path?: unknown
  [key: string]: unknown
}

function includeTargetsDocument(include: QueryInclude, documentId: UnpackedHypermediaId) {
  if (include.space !== documentId.uid) return false
  const includePath = entityQueryPathToHmIdPath(typeof include.path === 'string' ? include.path : '')
  return includePath.join('/') === (documentId.path ?? []).join('/')
}

function retargetQueryBlock(block: EditorBlock, fromId: UnpackedHypermediaId, toId: UnpackedHypermediaId) {
  if (block.type !== 'query') return block
  const rawIncludes = block.props.queryIncludes
  if (!rawIncludes) return block

  let includes: unknown
  try {
    includes = JSON.parse(rawIncludes)
  } catch {
    return block
  }
  if (!Array.isArray(includes)) return block

  const targetPath = (toId.path ?? []).join('/')
  let changed = false
  const nextIncludes = includes.map((include) => {
    if (!include || typeof include !== 'object') return include
    const queryInclude = include as QueryInclude
    if (!includeTargetsDocument(queryInclude, fromId)) return include
    changed = true
    return {
      ...queryInclude,
      space: toId.uid,
      path: targetPath,
    }
  })

  if (!changed) return block
  return {
    ...block,
    props: {
      ...block.props,
      queryIncludes: JSON.stringify(nextIncludes),
    },
  } as EditorBlock
}

/**
 * Retarget query-block includes that still point at the draft placeholder
 * document to the final published document id.
 */
export function retargetQueryBlockIncludesForPublish(
  blocks: EditorBlock[],
  fromId: UnpackedHypermediaId,
  toId: UnpackedHypermediaId,
): EditorBlock[] {
  if (fromId.uid === toId.uid && (fromId.path ?? []).join('/') === (toId.path ?? []).join('/')) return blocks

  let changed = false
  const nextBlocks = blocks.map((block) => {
    const retargetedBlock = retargetQueryBlock(block, fromId, toId)
    let nextBlock = retargetedBlock
    if (block.children?.length) {
      const nextChildren = retargetQueryBlockIncludesForPublish(block.children, fromId, toId)
      if (nextChildren !== block.children) {
        nextBlock = {...retargetedBlock, children: nextChildren} as EditorBlock
      }
    }
    if (nextBlock !== block) changed = true
    return nextBlock
  })

  return changed ? nextBlocks : blocks
}

// -- Types --

/**
 * Platform-agnostic interface for reading the active editor instance.
 * Both web and desktop create an accessor conforming to this shape,
 * which actors use to read blocks and cursor position.
 */
export type EditCursorPosition = number | 'end'

export interface EditorAccessor {
  /** Read the editor's current top-level blocks. */
  getTopLevelBlocks(): EditorBlock[] | null
  /** Optional cursor offset for restoring on reload. */
  getCursorPosition?: () => number | null
}

/** Input provided when creating the document machine actor. */
export type DocumentMachineInput = {
  documentId: UnpackedHypermediaId
  canEdit: boolean
  isLatest?: boolean
  reservedDraftId?: string
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
  /** True when machine should enter editing after loading (existing or route-reserved draft). Cleared after first use. */
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
  /** Cursor requested by the edit.start event that entered or refocused editing. */
  pendingEditCursorPosition: EditCursorPosition | null
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
  /**
   * Optional path picked by the user in the publish popover, captured on
   * `publish.start` and forwarded to the publishDocument actor input. Cleared
   * on cleanup so it does not leak to a subsequent publish.
   */
  pendingPathOverride: string[] | null
  /** Child draft ids currently referenced by draft embed cards in editor content. */
  referencedChildDraftIds: string[]
  /** Child draft ids whose cards were removed and should be deleted on publish/discard unless restored by undo. */
  pendingDeletedChildDraftIds: string[]
  /**
   * True when `publish.start` is received while an autosave/create is in flight
   * or while the draft has unsaved changes. Causes the machine to flush the
   * pending save and then enter `publishing` once `_save.completed` raises.
   * Cleared on entry to `publishing` so a second publish click does not double-fire.
   */
  pendingPublish: boolean
  error: unknown
  /**
   * Last document payload seen via `document.loaded` or `document.remoteUpdate`. Survives
   * subsequent transient resource failures so UI can keep rendering the document while a
   * background refetch is errored / discovering / not-found.
   */
  lastGoodDocument: HMDocument | null
  /** Version string for {@link lastGoodDocument}; mirrors `publishedVersion` at the time of capture. */
  lastGoodVersion: string | null
  /**
   * Non-fatal resource fetch state surfaced by the consumer (`useResource`). Drives a banner
   * in the page header without changing the machine's top-level state. `null` when the
   * resource fetch is in a healthy state.
   */
  transientResourceError: TransientResourceError
}

/**
 * Non-fatal resource fetch state derived by the consumer of {@link useResource}.
 * Stored in {@link DocumentMachineContext} so banners and debug tooling read from
 * a single source of truth.
 */
export type TransientResourceError =
  | {kind: 'refetch-error'; message: string}
  | {kind: 'discovering'}
  | {kind: 'not-found-transient'}
  | null

/** All events the machine can receive. */
export type DocumentMachineEvent =
  | {type: 'document.loaded'; document: HMDocument}
  | {type: 'document.error'; error: unknown}
  | {type: 'document.retry'}
  | {type: 'edit.start'; cursorPosition?: EditCursorPosition | null}
  | {type: 'edit.cancel'}
  | {type: 'change'; metadata?: HMDraft['metadata']}
  | {type: 'rootChildrenType.change'; childrenType: HMBlockChildrenType}
  | {type: 'change.navigation'; navigation: HMNavigationItem[]}
  | {type: 'reset.content'}
  | {
      type: 'publish.start'
      /**
       * Optional explicit path the user picked in the publish popover. Wins over
       * the inline first-publish slug rename in `usePublishResource`.
       */
      pathOverride?: string[]
    }
  | {type: 'document.remoteUpdate'; document: HMDocument}
  | {type: 'edit.discard'}
  | {type: 'childDraftRefs.changed'; draftIds: string[]}
  | {type: 'capability.changed'; canEdit: boolean}
  | {type: 'account.changed'; signingAccountId?: string; publishAccountUid?: string}
  | {type: 'version.changed'; isLatest: boolean}
  | {type: 'draft.existing'; draftId: string}
  | {
      type: 'draft.resolved'
      draftId: string | null
      content: HMBlockNode[] | null
      cursorPosition: number | null
      metadata?: HMMetadata | null
      deps?: string[] | null
      /** Block IDs the user previously touched in this draft (persisted across reloads). */
      mineTouchedIds?: string[] | null
      /** Three-way merge base captured when the draft was first started or last rebased. */
      baseBlocks?: HMBlockNode[] | null
    }
  | {
      type: 'draft.externallyModified'
      draftId: string
      source?: 'document-card-cleanup'
      deletedDocumentId?: string
      removedBlockIds?: string[]
      content?: HMBlockNode[] | null
      cursorPosition?: number | null
      metadata?: HMMetadata | null
      deps?: string[] | null
      mineTouchedIds?: string[] | null
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
  | {type: 'resource.transientError'; error: NonNullable<TransientResourceError>}
  | {type: 'resource.recovered'}

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

/** Output returned by draft writers after the saved draft hits local storage. */
export type WriteDraftOutput = {
  id: string
  content?: HMBlockNode[] | null
  cursorPosition?: number | null
}

/** Input for the publishDocument actor. */
export type PublishInput = {
  documentId: UnpackedHypermediaId
  draftId: string
  deps: string[]
  metadata: HMDraft['metadata']
  navigation: HMNavigationItem[] | undefined
  publishAccountUid: string | null
  /**
   * Optional explicit destination path the user picked in the publish popover.
   * When set, the consumer-provided actor must use it as-is and skip the
   * inline first-publish slug rename.
   */
  pathOverride?: string[]
  /** Child drafts removed from this parent draft and confirmed by publishing. */
  deletedChildDraftIds: string[]
}

/** Input for the discardDraft actor. */
export type DiscardDraftInput = {
  draftId: string
  /** Child drafts removed from this parent draft and confirmed by discarding. */
  deletedChildDraftIds: string[]
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
      lastGoodDocument: ({context, event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return event.document
        }
        return context.lastGoodDocument
      },
      lastGoodVersion: ({context, event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return event.document.version
        }
        return context.lastGoodVersion
      },
    }),
    setTransientResourceError: assign({
      transientResourceError: ({context, event}) => {
        if (event.type !== 'resource.transientError') return context.transientResourceError
        return event.error
      },
    }),
    clearTransientResourceError: assign({
      transientResourceError: null,
    }),
    setMetadata: assign({
      metadata: ({context, event}) => {
        if (event.type === 'change' && event.metadata) {
          return {...context.metadata, ...event.metadata}
        }
        if (event.type === 'rootChildrenType.change') {
          return {...context.metadata, childrenType: event.childrenType}
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
      deps: ({context}) => {
        if (context.draftId && context.deps.length) return context.deps
        return context.publishedVersion ? [context.publishedVersion] : context.deps
      },
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
    setDraftSavedSnapshotFromResult: assign({
      draftContent: ({context}, params: WriteDraftOutput) => {
        if (params.content !== undefined) return params.content ?? null
        return context.draftContent
      },
      draftCursorPosition: ({context}, params: WriteDraftOutput) => {
        if (params.cursorPosition !== undefined) return params.cursorPosition ?? null
        return context.draftCursorPosition
      },
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
    setPendingEditCursorPosition: assign({
      pendingEditCursorPosition: ({event}) => {
        if (event.type !== 'edit.start') return null
        return event.cursorPosition ?? null
      },
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
      pendingEditCursorPosition: null,
      metadata: {},
      navigation: undefined,
      baseBlocks: null,
      mineTouchedIds: [],
      pendingRemoteDocument: null,
      pendingRebase: null,
      pendingPathOverride: null,
      pendingPublish: false,
      referencedChildDraftIds: [],
      pendingDeletedChildDraftIds: [],
    }),
    clearEditingState: assign({
      // Preserve draftId and metadata so re-entering editing reuses the same draft
      // and title/summary changes remain visible outside editing mode.
      hasChangedWhileSaving: false,
      pendingRemoteVersion: null,
      pendingEditCursorPosition: null,
      baseBlocks: null,
      mineTouchedIds: [],
      pendingRemoteDocument: null,
      pendingRebase: null,
      pendingPathOverride: null,
      pendingPublish: false,
    }),
    snapshotBaseBlocks: assign({
      baseBlocks: ({context}) => {
        // Preserve restored base blocks from a reloaded draft. We only snapshot
        // fresh from the published document when starting a brand-new draft
        // session (baseBlocks === null and not yet hydrated by draft.resolved).
        if (context.baseBlocks && context.baseBlocks.length) {
          // console.log('[Rebase machine] snapshotBaseBlocks: preserving restored', {
          //   count: context.baseBlocks.length,
          // })
          return context.baseBlocks
        }
        const blocks = context.document?.content ?? []
        // console.log('[Rebase machine] snapshotBaseBlocks: fresh', {
        //   count: blocks.length,
        //   ids: blocks.map((n) => n.block?.id),
        //   publishedVersion: context.publishedVersion,
        // })
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
          // console.log('[Rebase machine] appendMineTouched', {added: event.blockIds, total: next})
        }
        return next
      },
    }),
    setPendingRemoteDocument: assign({
      pendingRemoteDocument: ({event}) => {
        if (event.type === 'document.remoteUpdate') {
          // console.log('[Rebase machine] setPendingRemoteDocument', {
          //   version: event.document.version,
          //   blockIds: (event.document.content ?? []).map((n) => n.block?.id),
          // })
          return event.document
        }
        return null
      },
    }),
    applyRebaseMerge: assign({
      document: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.document
        // console.log('[Rebase machine] applyRebaseMerge', {
        //   fromDeps: context.deps,
        //   toDeps: event.newDocument.version ? [event.newDocument.version] : context.deps,
        //   fromMineTouched: context.mineTouchedIds,
        //   mergedBlockCount: event.mergedBlocks.length,
        // })
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
      lastGoodDocument: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.lastGoodDocument
        return event.newDocument
      },
      lastGoodVersion: ({context, event}) => {
        if (event.type !== 'rebase.apply') return context.lastGoodVersion
        return event.newDocument.version ?? context.lastGoodVersion
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
    clearPendingRemoteUpdate: assign({
      pendingRemoteVersion: null,
      pendingRemoteDocument: null,
      pendingRebase: null,
    }),
    setPathOverrideFromEvent: assign({
      pendingPathOverride: ({context, event}) => {
        if (event.type !== 'publish.start') return context.pendingPathOverride
        // Preserve a previously captured override when a queued publish click
        // arrives without one — first click wins for the path argument.
        return event.pathOverride ?? context.pendingPathOverride
      },
    }),
    clearPathOverride: assign({
      pendingPathOverride: null,
    }),
    markPendingPublish: assign({
      pendingPublish: true,
    }),
    clearPendingPublish: assign({
      pendingPublish: false,
    }),
    updateChildDraftRefs: assign({
      referencedChildDraftIds: ({event, context}) => {
        if (event.type !== 'childDraftRefs.changed') return context.referencedChildDraftIds
        return Array.from(new Set(event.draftIds.filter((id) => !!id)))
      },
      pendingDeletedChildDraftIds: ({event, context}) => {
        if (event.type !== 'childDraftRefs.changed') return context.pendingDeletedChildDraftIds
        const nextRefs = new Set(event.draftIds.filter((id) => !!id))
        const prevRefs = new Set(context.referencedChildDraftIds)
        const pending = new Set(context.pendingDeletedChildDraftIds)
        for (const id of Array.from(prevRefs)) {
          if (!nextRefs.has(id)) pending.add(id)
        }
        for (const id of Array.from(nextRefs)) {
          pending.delete(id)
        }
        return Array.from(pending)
      },
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
      deps: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.deps && event.deps.length) return event.deps
        return context.deps
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
      referencedChildDraftIds: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.content) return collectChildDraftIds(event.content)
        return context.referencedChildDraftIds
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
    pushContentToEditor: () => {
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
      lastGoodDocument: ({context, event}) => {
        const doc = (event as any).output as HMDocument
        return doc ?? context.lastGoodDocument
      },
      lastGoodVersion: ({context, event}) => {
        const doc = (event as any).output as HMDocument
        return doc?.version ?? context.lastGoodVersion
      },
    }),
    setEditorBaselineFromSnapshot: assign({
      editorBaseline: ({event, context}) => {
        if (event.type === 'editor.baselineUpdate') return event.blocks
        return context.editorBaseline
      },
    }),
    applyExternalDraftState: assign({
      draftContent: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId &&
          event.content
        ) {
          return event.content
        }
        return context.draftContent
      },
      draftCursorPosition: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId &&
          event.cursorPosition !== undefined
        ) {
          return event.cursorPosition
        }
        return context.draftCursorPosition
      },
      metadata: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId &&
          event.metadata
        ) {
          return event.metadata
        }
        return context.metadata
      },
      deps: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId &&
          event.deps
        ) {
          return event.deps
        }
        return context.deps
      },
      mineTouchedIds: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId &&
          event.mineTouchedIds
        ) {
          return event.mineTouchedIds
        }
        return context.mineTouchedIds
      },
      baseBlocks: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId &&
          event.baseBlocks
        ) {
          return event.baseBlocks
        }
        return context.baseBlocks
      },
      hasChangedWhileSaving: ({context, event}) => {
        if (
          event.type === 'draft.externallyModified' &&
          event.source === 'document-card-cleanup' &&
          event.draftId === context.draftId
        ) {
          return false
        }
        return context.hasChangedWhileSaving
      },
    }),
    logDraftResolved: ({context, event}) => {
      if (event.type !== 'draft.resolved') return
      console.info(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft.resolved`, {
        documentId: context.documentId.id,
        eventDraftId: event.draftId,
        currentDraftId: context.draftId,
        contentTopLevelBlockCount: getTopLevelBlockCount(event.content),
        hasMetadata: !!event.metadata,
        deps: event.deps ?? null,
        mineTouchedIds: event.mineTouchedIds ?? null,
        baseBlockCount: getTopLevelBlockCount(event.baseBlocks),
      })
    },
    logEnterEditing: ({context}) => {
      console.info(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine entering editing`, {
        documentId: context.documentId.id,
        draftId: context.draftId,
        draftCreated: context.draftCreated,
        shouldAutoEdit: context.shouldAutoEdit,
        draftContentTopLevelBlockCount: getTopLevelBlockCount(context.draftContent),
        documentTopLevelBlockCount: getTopLevelBlockCount(context.document?.content),
        editorBaselineTopLevelBlockCount: getTopLevelBlockCount(context.editorBaseline),
        contentSource: context.draftContent ? 'draft' : 'published-document',
      })
    },
    logDraftExternallyModified: ({context, event}) => {
      if (event.type !== 'draft.externallyModified') return
      console.info(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft externally modified`, {
        documentId: context.documentId.id,
        eventDraftId: event.draftId,
        currentDraftId: context.draftId,
        matchesCurrentDraft: !!context.draftId && context.draftId === event.draftId,
        source: event.source ?? null,
        deletedDocumentId: event.deletedDocumentId ?? null,
        removedBlockIds: event.removedBlockIds ?? null,
        incomingContentTopLevelBlockCount: getTopLevelBlockCount(event.content),
        stateStillUsesDraftContentTopLevelBlockCount: getTopLevelBlockCount(context.draftContent),
        documentTopLevelBlockCount: getTopLevelBlockCount(context.document?.content),
        hasPendingLocalSave: context.hasChangedWhileSaving,
        draftCreated: context.draftCreated,
      })
    },
    applyExternalDraftCleanupToEditor: () => {
      // Provided via .provide() in the React layer (editor handlers ref)
    },
    logSaveStarted: ({context}) => {
      console.info(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft save started`, {
        documentId: context.documentId.id,
        draftId: context.draftId,
        draftCreated: context.draftCreated,
        hasChangedWhileSaving: context.hasChangedWhileSaving,
        mineTouchedIds: context.mineTouchedIds,
        baseBlockCount: getTopLevelBlockCount(context.baseBlocks),
      })
    },
    logSaveCompleted: ({context}) => {
      console.info(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft save completed`, {
        documentId: context.documentId.id,
        draftId: context.draftId,
        draftCreated: context.draftCreated,
        hasChangedWhileSaving: context.hasChangedWhileSaving,
      })
    },
    logRemoteUpdateWhileEditing: ({context, event}) => {
      if (event.type !== 'document.remoteUpdate') return
      console.info(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine remote update while editing`, {
        documentId: context.documentId.id,
        draftId: context.draftId,
        incomingVersion: event.document.version,
        currentPublishedVersion: context.publishedVersion,
        incomingTopLevelBlockCount: getTopLevelBlockCount(event.document.content),
        draftContentTopLevelBlockCount: getTopLevelBlockCount(context.draftContent),
      })
    },
  },
  guards: {
    canTransitionToEditing: ({context}) => {
      const result = context.canEdit && (context.isLatestVersion || !!context.draftId)
      // console.log('[DocMachine] guard canTransitionToEditing', {
      //   canEdit: context.canEdit,
      //   isLatestVersion: context.isLatestVersion,
      //   draftId: context.draftId,
      //   result,
      // })
      return result
    },
    canOpenExistingDraft: ({context, event}) => {
      return context.canEdit && (context.isLatestVersion || (event.type === 'draft.existing' && !!event.draftId))
    },
    didChangeWhileSaving: ({context}) => context.hasChangedWhileSaving,
    hasDraftId: ({context}) => context.draftId !== null,
    hasPersistedDraft: ({context}) => context.draftId !== null && context.draftCreated,
    hasExistingDraft: ({context}) => context.shouldAutoEdit,
    hasRemoteUpdate: ({context}) => context.pendingRemoteVersion !== null,
    bothSourcesReady: ({context}) => context.documentReady && context.draftReady,
    capabilityLost: ({event}) => event.type === 'capability.changed' && !event.canEdit,
    hasPendingPublish: ({context}) => context.pendingPublish,
  },
  actors: {
    writeDraft: fromPromise<WriteDraftOutput, WriteDraftInput>(async () => {
      throw new Error('writeDraft actor must be provided via .provide()')
    }),
    publishDocument: fromPromise<HMDocument, PublishInput>(async () => {
      throw new Error('publishDocument actor must be provided via .provide()')
    }),
    discardDraft: fromPromise<void, DiscardDraftInput>(async () => {
      throw new Error('discardDraft actor must be provided via .provide()')
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
    'childDraftRefs.changed': {
      actions: ['updateChildDraftRefs'],
    },
    'resource.transientError': {
      actions: ['setTransientResourceError'],
    },
    'resource.recovered': {
      actions: ['clearTransientResourceError'],
    },
    'draft.externallyModified': {
      actions: ['logDraftExternallyModified', 'applyExternalDraftState', 'applyExternalDraftCleanupToEditor'],
    },
  },
  context: ({input}) => ({
    documentId: input.documentId,
    draftId: input.existingDraftId ?? input.reservedDraftId ?? null,
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
    shouldAutoEdit: !!input.existingDraftId || !!input.reservedDraftId,
    signingAccountId: input.signingAccountId ?? null,
    publishAccountUid: input.publishAccountUid ?? null,
    documentReady: false,
    draftReady: !!input.existingDraftId || !!input.reservedDraftId,
    draftContent: null,
    draftCursorPosition: null,
    pendingEditCursorPosition: null,
    editorBaseline: null,
    baseBlocks: null,
    mineTouchedIds: [],
    pendingRemoteDocument: null,
    pendingRebase: null,
    pendingPathOverride: null,
    pendingPublish: false,
    referencedChildDraftIds: [],
    pendingDeletedChildDraftIds: [],
    error: null,
    lastGoodDocument: null,
    lastGoodVersion: null,
    transientResourceError: null,
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
          actions: ['logDraftResolved', 'setDraftResolved'],
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
        'edit.start': {
          target: 'editing',
          guard: 'canTransitionToEditing',
          actions: ['setPendingEditCursorPosition', 'setDepsFromPublished', 'snapshotBaseBlocks'],
        },
        'edit.discard': [
          {
            target: 'discarding',
            guard: 'hasPersistedDraft',
          },
          {
            actions: ['clearDraftState'],
          },
        ],
        'document.remoteUpdate': {
          target: 'loaded',
          actions: ['setDocumentData', 'pushContentToEditor'],
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
        'draft.existing': [
          {
            target: 'editing',
            guard: 'canOpenExistingDraft',
            actions: ['setExistingDraft', 'clearShouldAutoEdit', 'setDepsFromPublished', 'snapshotBaseBlocks'],
          },
          {
            actions: ['setExistingDraft'],
          },
        ],
      },
      always: {
        target: 'editing',
        guard: ({context}) =>
          context.shouldAutoEdit && context.canEdit && (context.isLatestVersion || !!context.draftId),
        actions: ['clearShouldAutoEdit', 'setDepsFromPublished', 'snapshotBaseBlocks'],
      },
    },

    editing: {
      type: 'parallel',
      entry: [
        'logEnterEditing',
        {type: 'setEditorEditable'},
        {type: 'applyInitialContentToEditor'},
        {type: 'placeCursorFromPendingOrDraft'},
      ],
      exit: [
        () => {
          //console.log('[DocMachine] exit editing'),
        },
        {type: 'setEditorReadOnly'},
      ],
      on: {
        'edit.start': {
          actions: ['setPendingEditCursorPosition', 'placeCursorFromPendingOrDraft'],
        },
        'edit.cancel': {
          target: 'loaded',
          actions: [() => console.log('[DocMachine] edit.cancel received in editing → loaded'), 'clearEditingState'],
        },
        'edit.discard': [
          {
            target: 'discarding',
            guard: 'hasPersistedDraft',
            actions: [() => console.log('[DocMachine] edit.discard received in editing → discarding')],
          },
          {
            target: 'loaded',
            actions: ['clearDraftState'],
          },
        ],
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
          actions: ['logRemoteUpdateWhileEditing', 'setPendingRemoteVersion', 'setPendingRemoteDocument'],
        },
        'document.loaded': {
          actions: ['setDocumentData', 'markDocumentReady'],
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
                guard: 'hasPersistedDraft',
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
                'rootChildrenType.change': {
                  target: 'changed',
                  actions: ['setMetadata'],
                },
                'reset.content': {
                  target: 'changed',
                },
                'publish.start': {
                  target: '#DocumentLifecycle.publishing',
                  guard: 'hasPersistedDraft',
                  actions: ['setPathOverrideFromEvent'],
                },
                // A `publish.start` queued during a previous saving/creating
                // raises `_save.completed` from the actor's onDone, lands here,
                // and immediately flushes into `publishing`.
                '_save.completed': {
                  target: '#DocumentLifecycle.publishing',
                  guard: 'hasPendingPublish',
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
                'rootChildrenType.change': {
                  target: 'changed',
                  actions: ['setMetadata'],
                  reenter: true,
                },
                'reset.content': {
                  target: 'changed',
                  reenter: true,
                },
                // Publish during the autosave debounce window: skip the timer,
                // jump straight into saving/creating, and queue the publish to
                // fire once the save completes.
                'publish.start': [
                  {
                    target: 'saving',
                    guard: 'hasPersistedDraft',
                    actions: ['markPendingPublish', 'setPathOverrideFromEvent'],
                  },
                  {
                    target: 'creating',
                    actions: ['markPendingPublish', 'setPathOverrideFromEvent'],
                  },
                ],
              },
              after: {
                autosaveTimeout: [
                  {
                    target: 'saving',
                    guard: 'hasPersistedDraft',
                  },
                  {
                    target: 'creating',
                  },
                ],
              },
            },
            creating: {
              entry: ['logSaveStarted', 'resetChangeWhileSaving', raise({type: '_save.started'})],
              on: {
                change: {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'rootChildrenType.change': {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'reset.content': {
                  actions: ['setHasChangedWhileSaving'],
                },
                // Queue the publish; flushed when the in-flight create resolves
                // and onDone raises `_save.completed` in idle.
                'publish.start': {
                  actions: ['markPendingPublish', 'setPathOverrideFromEvent'],
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
                      {
                        type: 'setDraftSavedSnapshotFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                      'logSaveCompleted',
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
                      {
                        type: 'setDraftSavedSnapshotFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                      'logSaveCompleted',
                      raise({type: '_save.completed'}),
                    ],
                  },
                ],
                onError: {
                  target: 'idle',
                  actions: [
                    ({event}: {event: any}) => {
                      console.error(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft create failed`, {
                        error: event.error,
                      })
                    },
                    raise({type: '_save.completed'}),
                  ],
                },
              },
            },
            saving: {
              entry: ['logSaveStarted', 'resetChangeWhileSaving', raise({type: '_save.started'})],
              on: {
                change: {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'rootChildrenType.change': {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'reset.content': {
                  actions: ['setHasChangedWhileSaving'],
                },
                // Same flush semantics as `creating`. Repeated clicks are
                // idempotent thanks to `markPendingPublish` being a constant
                // assign.
                'publish.start': {
                  actions: ['markPendingPublish', 'setPathOverrideFromEvent'],
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
                      {
                        type: 'setDraftSavedSnapshotFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                    ],
                    reenter: true,
                  },
                  {
                    target: 'idle',
                    actions: [
                      {
                        type: 'setDraftSavedSnapshotFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                      'logSaveCompleted',
                      raise({type: '_save.completed'}),
                    ],
                  },
                ],
                onError: {
                  target: 'idle',
                  actions: [
                    ({event}: {event: any}) => {
                      console.error(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft save failed`, {
                        error: event.error,
                      })
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
              entry: () => {
                //console.log('[Rebase machine] region.idle entered')
              },
              on: {
                'rebase.detectConflict': {
                  actions: ['clearPendingRemoteUpdate'],
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
              entry: () => {
                //console.log('[Rebase machine] region.conflict entered')
              },
              on: {
                'rebase.apply': {
                  target: 'idle',
                  actions: ['applyRebaseMerge'],
                },
                'rebase.dismiss': {
                  target: 'idle',
                  actions: ['clearPendingRemoteUpdate'],
                },
              },
            },
          },
        },
      },
    },

    discarding: {
      invoke: {
        id: 'discardDraft',
        src: 'discardDraft',
        input: ({context}) => ({
          draftId: context.draftId!,
          deletedChildDraftIds: context.pendingDeletedChildDraftIds,
        }),
        onDone: {
          target: 'loaded',
          actions: ['clearDraftState'],
        },
        onError: {
          target: 'editing',
          actions: ({event}: {event: any}) => {
            console.error(`${DOCUMENT_EMBED_CLEANUP_LOG_PREFIX} document machine draft discard failed`, {
              error: event.error,
            })
          },
        },
      },
    },

    publishing: {
      initial: 'inProgress',
      entry: ['clearPendingPublish'],
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
              pathOverride: context.pendingPathOverride ?? undefined,
              deletedChildDraftIds: context.pendingDeletedChildDraftIds,
            }),
            onDone: {
              target: 'cleaningUp',
            },
            onError: {
              target: '#DocumentLifecycle.editing.draft.idle',
              actions: ['clearPathOverride'],
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
