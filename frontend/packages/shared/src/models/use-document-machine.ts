import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {useActorRef, useSelector} from '@xstate/react'
import {createContext, createElement, ReactNode, useContext, useEffect, useMemo, useRef} from 'react'
import {ActorRefFrom, SnapshotFrom} from 'xstate'
import {classifyRebase, applyRebasePlan} from '../utils/document-changes'
import {
  documentMachine,
  DocumentMachineContext,
  DocumentMachineEvent,
  DocumentMachineInput,
  PendingRebase,
  PublishInput,
  WriteDraftInput,
} from './document-machine'
import {EditorHandlers, EditorHandlersContext} from './editor-handlers-context'
import {useAccount, useChanges} from './entity'

// -- Actor types --

/** Actor reference type for the document machine. */
export type DocumentMachineActorRef = ActorRefFrom<typeof documentMachine>

/** Snapshot type for the document machine. */
export type DocumentMachineSnapshot = SnapshotFrom<typeof documentMachine>

// -- Provided actors interface --

/** Actors that must be provided via `.provide()` before instantiating the machine. */
export type DocumentMachineProvidedActors = {
  writeDraft: (input: WriteDraftInput) => Promise<{id: string}>
  publishDocument: (input: PublishInput) => Promise<HMDocument>
}

// -- React context --

const DocumentMachineContext_ = createContext<DocumentMachineActorRef | null>(null)

/** Props for `DocumentMachineProvider`. */
export interface DocumentMachineProviderProps {
  /** Input to initialise the document machine actor. */
  input: DocumentMachineInput
  /**
   * Optional machine override (e.g. from `documentMachine.provide({actors: {...}})` on desktop).
   * When omitted the default `documentMachine` (with placeholder actors) is used.
   */
  machine?: typeof documentMachine
  /** Optional XState inspect callback for debugging (from @statelyai/inspect). */
  inspect?: (inspectionEvent: any) => void
  children: ReactNode
}

/**
 * Creates a document machine actor and provides it via React context.
 * The actor starts automatically via `useActorRef` and stops on unmount.
 */
export function DocumentMachineProvider({input, machine, inspect, children}: DocumentMachineProviderProps) {
  // Mutable ref populated by `DocumentEditor` with the imperative handlers the
  // machine needs to flip the editor's editable flag, replace blocks on entry,
  // and place the cursor. Read lazily inside provided actions so replacing the
  // handlers does not require recreating the actor.
  const editorHandlersRef = useRef<EditorHandlers | null>(null)

  // Compose the incoming machine (or the default) with React-layer action
  // implementations. The ref is stable, so this only runs once per mount.
  const providedMachine = useMemo(
    () =>
      (machine ?? documentMachine).provide({
        actions: {
          setEditorEditable: () => editorHandlersRef.current?.setEditable(true),
          setEditorReadOnly: () => editorHandlersRef.current?.setEditable(false),
          applyInitialContentToEditor: () => editorHandlersRef.current?.applyInitialContent(),
          placeCursorFromPendingOrDraft: () => editorHandlersRef.current?.placeCursor(),
        },
      }),
    [machine],
  )

  const actorRef = useActorRef(providedMachine, {input, inspect})

  return createElement(
    EditorHandlersContext.Provider,
    {value: editorHandlersRef},
    createElement(DocumentMachineContext_.Provider, {value: actorRef}, children),
  )
}

/**
 * Read the document machine actor ref from context.
 * Throws if used outside a `DocumentMachineProvider`.
 */
export function useDocumentMachineRef(): DocumentMachineActorRef {
  const ref = useContext(DocumentMachineContext_)
  if (!ref) {
    throw new Error('useDocumentMachineRef must be used within a DocumentMachineProvider')
  }
  return ref
}

/**
 * Read the document machine actor ref from context, or null if outside a provider.
 * Unlike `useDocumentMachineRef`, this will NOT throw when used outside a `DocumentMachineProvider`.
 */
export function useDocumentMachineRefOptional(): DocumentMachineActorRef | null {
  return useContext(DocumentMachineContext_)
}

/**
 * Attach a native scroll listener to the document's scroll container viewport
 * and forward `{type: 'scroll'}` events to the document machine (throttled).
 *
 * Finds the scroll viewport by querying `#scroll-page-wrapper [data-slot="scroll-area-viewport"]`.
 * No-ops if the machine context or viewport element is unavailable.
 */
export function useScrollSync() {
  const actorRef = useDocumentMachineRefOptional()

  useEffect(() => {
    if (!actorRef) return

    const wrapper = document.getElementById('scroll-page-wrapper')
    const viewport = wrapper
      ? wrapper.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? wrapper
      : null

    if (!viewport) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const handleScroll = () => {
      if (timeoutId) return
      timeoutId = setTimeout(() => {
        timeoutId = null
        actorRef.send({type: 'scroll'})
      }, 100)
    }

    viewport.addEventListener('scroll', handleScroll, {passive: true})
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [actorRef])
}

/**
 * Subscribe to the document machine's emitted `scrolling` event and call the
 * provided callback when it fires.
 *
 * No-ops when used outside a `DocumentMachineProvider` (e.g. draft pages).
 */
export function useHideOnDocumentScroll(onScroll: () => void) {
  const actorRef = useDocumentMachineRefOptional()
  const callbackRef = useRef(onScroll)
  callbackRef.current = onScroll

  useEffect(() => {
    if (!actorRef) return
    const sub = actorRef.on('scrolling', () => {
      callbackRef.current()
    })
    return () => {
      sub.unsubscribe()
    }
  }, [actorRef])
}

/**
 * Sync a resolved document into the machine.
 * Sends `document.loaded` on first non-null document, then `document.remoteUpdate`
 * whenever the version changes.
 */
export function useDocumentSync(document: HMDocument | null | undefined) {
  const actorRef = useDocumentMachineRef()
  const prevVersionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!document) {
      console.log('[DocumentSync] no document yet')
      return
    }

    if (prevVersionRef.current === null) {
      // First time we have a document — transition from loading → loaded
      console.log('[DocumentSync] sending document.loaded, version:', document.version)
      actorRef.send({type: 'document.loaded', document})
      prevVersionRef.current = document.version
    } else if (document.version !== prevVersionRef.current) {
      // Version changed — remote update
      console.log(
        '[DocumentSync] sending document.remoteUpdate, version:',
        document.version,
        '(prev:',
        prevVersionRef.current,
        ')',
      )
      actorRef.send({type: 'document.remoteUpdate', document})
      prevVersionRef.current = document.version
    }
  }, [actorRef, document])
}

/**
 * Sync canEdit prop changes into the machine as `capability.changed` events.
 * Call this inside DocumentMachineProvider when the canEdit value may change
 * (e.g. account switching on desktop).
 */
export function useCapabilitySync(canEdit: boolean) {
  const actorRef = useDocumentMachineRef()
  const prevCanEditRef = useRef(canEdit)

  useEffect(() => {
    if (canEdit !== prevCanEditRef.current) {
      prevCanEditRef.current = canEdit
      actorRef.send({type: 'capability.changed', canEdit})
    }
  }, [actorRef, canEdit])
}

/**
 * Sync account ID changes into the machine as `account.changed` events.
 * Call this inside DocumentMachineProvider when account selection may change
 * (e.g. async resolution of selectedAccountId on desktop).
 */
export function useAccountSync(signingAccountId: string | undefined, publishAccountUid: string | undefined) {
  const actorRef = useDocumentMachineRef()
  const prevSigningRef = useRef(signingAccountId)
  const prevPublishRef = useRef(publishAccountUid)

  useEffect(() => {
    if (signingAccountId !== prevSigningRef.current || publishAccountUid !== prevPublishRef.current) {
      prevSigningRef.current = signingAccountId
      prevPublishRef.current = publishAccountUid
      actorRef.send({type: 'account.changed', signingAccountId, publishAccountUid})
    }
  }, [actorRef, signingAccountId, publishAccountUid])
}

/**
 * Sync isLatest prop changes into the machine as `version.changed` events.
 * Call this inside DocumentBody when the isLatest value may change
 * (e.g. when React Query detects a newer published version).
 */
export function useVersionLatestSync(isLatest: boolean) {
  const actorRef = useDocumentMachineRef()
  const prevRef = useRef(isLatest)

  useEffect(() => {
    if (isLatest !== prevRef.current) {
      prevRef.current = isLatest
      actorRef.send({type: 'version.changed', isLatest})
    }
  }, [actorRef, isLatest])
}

/**
 * Sync draft resolution into the machine during loading.
 * Sends `draft.resolved` once the draft query has fully settled:
 * - `undefined` = still loading (document or draft content not yet available)
 * - `{draftId: null, content: null}` = no draft exists
 * - `{draftId: string, content: HMBlockNode[]}` = draft exists and content is loaded
 *
 * The machine's `loading` state waits for both `document.loaded` and
 * `draft.resolved` before transitioning to `loaded`, eliminating the
 * race condition where editing starts before draft content is available.
 */
export function useDraftResolutionSync(
  resolved:
    | {
        draftId: string | null
        content: HMBlockNode[] | null
        cursorPosition: number | null
        metadata?: HMMetadata | null
      }
    | undefined,
) {
  const actorRef = useDocumentMachineRef()
  const sentRef = useRef(false)

  useEffect(() => {
    if (resolved !== undefined && !sentRef.current) {
      sentRef.current = true
      console.log(
        '[DraftResolutionSync] sending draft.resolved, draftId:',
        resolved.draftId,
        'metadata:',
        resolved.metadata,
      )
      actorRef.send({
        type: 'draft.resolved',
        draftId: resolved.draftId,
        content: resolved.content,
        cursorPosition: resolved.cursorPosition,
        metadata: resolved.metadata ?? null,
      })
    }
  }, [actorRef, resolved])
}

/**
 * @deprecated Use `useDraftResolutionSync` instead. This hook sends `draft.existing`
 * which doesn't wait for draft content to load, causing race conditions on reload.
 */
export function useExistingDraftSync(existingDraft: {id: string} | false | undefined) {
  const actorRef = useDocumentMachineRef()
  const prevDraftIdRef = useRef<string | null>(null)

  useEffect(() => {
    const draftId = existingDraft ? existingDraft.id : null
    if (draftId && draftId !== prevDraftIdRef.current) {
      prevDraftIdRef.current = draftId
      actorRef.send({type: 'draft.existing', draftId})
    }
  }, [actorRef, existingDraft])
}

// -- Selectors --

/** Whether the machine is in the `loading` state. */
export function selectIsLoading(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches('loading')
}

/** Whether the machine is in the `loaded` state. */
export function selectIsLoaded(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches('loaded')
}

/** Whether the machine is in any `editing` sub-state. */
export function selectIsEditing(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches('editing')
}

/** Whether the machine is in any `publishing` sub-state. */
export function selectIsPublishing(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches('publishing')
}

/** Whether the machine is in the `error` state. */
export function selectIsError(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches('error')
}

/** Whether the machine is in the `confirmingOldVersionEdit` state (waiting for user confirmation). */
export function selectIsConfirmingOldVersionEdit(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches('confirmingOldVersionEdit')
}

/** Whether the current user can edit this document. */
export function selectCanEdit(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.context.canEdit
}

/** The latest known published version (dot-separated CID string). */
export function selectPublishedVersion(snapshot: DocumentMachineSnapshot): string | null {
  return snapshot.context.publishedVersion
}

/** A new version received while editing (not yet applied). */
export function selectPendingRemoteVersion(snapshot: DocumentMachineSnapshot): string | null {
  return snapshot.context.pendingRemoteVersion
}

/** The current draft ID, if any. */
export function selectDraftId(snapshot: DocumentMachineSnapshot): string | null {
  return snapshot.context.draftId
}

/** Whether there are unsaved changes (draft created + in editing state). */
export function selectHasUnsavedChanges(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.context.draftCreated && snapshot.matches('editing')
}

/** The current document data. */
export function selectDocument(snapshot: DocumentMachineSnapshot): HMDocument | null {
  return snapshot.context.document
}

/** Pending metadata changes set during this editing session (e.g. title/summary edits). */
export function selectMetadata(snapshot: DocumentMachineSnapshot): HMMetadata {
  return snapshot.context.metadata
}

/** The current error, if any (available in both loading and error states). */
export function selectError(snapshot: DocumentMachineSnapshot): unknown {
  return snapshot.context.error
}

/** The full machine context. */
export function selectContext(snapshot: DocumentMachineSnapshot): DocumentMachineContext {
  return snapshot.context
}

/** The blocks the editor should render: draft content (if available) or published document content. */
export function selectBlocks(snapshot: DocumentMachineSnapshot): HMBlockNode[] {
  const ctx = snapshot.context
  if (ctx.draftContent) return ctx.draftContent
  return ctx.document?.content ?? []
}

/** Published content in editor-block format. Baseline for unpublished-change diffs. */
export function selectEditorBaseline(snapshot: DocumentMachineSnapshot): EditorBlock[] | null {
  return snapshot.context.editorBaseline
}

/** Cursor position saved in the draft file, or null if none. */
export function selectDraftCursorPosition(snapshot: DocumentMachineSnapshot): number | null {
  return snapshot.context.draftCursorPosition
}

/** Save status derived from editing sub-states. */
export function selectSaveStatus(snapshot: DocumentMachineSnapshot): 'idle' | 'changed' | 'saving' | 'saved' {
  if (snapshot.matches({editing: {draft: 'creating'}}) || snapshot.matches({editing: {draft: 'saving'}}))
    return 'saving'
  if (snapshot.matches({editing: {draft: 'changed'}})) return 'changed'
  if (snapshot.context.draftCreated && snapshot.matches({editing: {draft: 'idle'}})) return 'saved'
  return 'idle'
}

/** Save indicator visibility state, driven by the parallel saveIndicator region in the machine. */
export function selectSaveIndicatorStatus(snapshot: DocumentMachineSnapshot): 'hidden' | 'saving' | 'saved' {
  if (snapshot.matches({editing: {saveIndicator: 'saving'}})) return 'saving'
  if (snapshot.matches({editing: {saveIndicator: 'saved'}})) return 'saved'
  return 'hidden'
}

/** The snapshot'd base blocks (set when entering editing). */
export function selectBaseBlocks(snapshot: DocumentMachineSnapshot): HMBlockNode[] | null {
  return snapshot.context.baseBlocks
}

/** Block IDs touched locally during this editing session. */
export function selectMineTouchedIds(snapshot: DocumentMachineSnapshot): string[] {
  return snapshot.context.mineTouchedIds
}

/** Remote document stashed while editing (null when no pending update). */
export function selectPendingRemoteDocument(snapshot: DocumentMachineSnapshot): HMDocument | null {
  return snapshot.context.pendingRemoteDocument
}

/** Pending rebase classification (auto/conflict/null). */
export function selectPendingRebase(snapshot: DocumentMachineSnapshot): PendingRebase | null {
  return snapshot.context.pendingRebase
}

/** Whether the draft machine is in the editing.draft.idle sub-state (safe-to-apply rebase gate). */
export function selectIsEditingIdle(snapshot: DocumentMachineSnapshot): boolean {
  return snapshot.matches({editing: {draft: 'idle'}})
}

// -- React hook helpers --

/**
 * Use a selector on a document machine actor ref.
 * If no actorRef is provided, reads from context via `useDocumentMachineRef()`.
 *
 * @example
 * ```tsx
 * // With context (inside DocumentMachineProvider)
 * const isEditing = useDocumentSelector(selectIsEditing)
 * // With explicit ref
 * const isEditing = useDocumentSelector(selectIsEditing, actorRef)
 * ```
 */
export function useDocumentSelector<T>(
  selector: (snapshot: DocumentMachineSnapshot) => T,
  actorRef?: DocumentMachineActorRef,
): T {
  const contextRef = useDocumentMachineRef()
  return useSelector(actorRef ?? contextRef, selector)
}

/**
 * Type-safe send wrapper. Returns a function that sends events to the machine.
 * If no actorRef is provided, reads from context via `useDocumentMachineRef()`.
 *
 * @example
 * ```tsx
 * const send = useDocumentSend()
 * send({type: 'edit.start'})
 * ```
 */
export function useDocumentSend(actorRef?: DocumentMachineActorRef) {
  const contextRef = useDocumentMachineRef()
  const ref = actorRef ?? contextRef
  return ref.send as (event: DocumentMachineEvent) => void
}

/**
 * Minimal editor interface `useAutoRebase` needs. Compatible with BlockNote
 * editors but avoids a direct dependency on the editor package.
 */
export type AutoRebaseEditor = {
  readonly topLevelBlocks: any[]
  replaceBlocks: (existing: unknown[], replacement: unknown[]) => void
  updateBlock?: (blockOrId: string | {id: string}, update: unknown) => void
  insertBlocks?: (
    blocks: unknown[],
    referenceBlock: string | {id: string},
    placement?: 'before' | 'after',
  ) => void
  removeBlocks?: (blocks: Array<string | {id: string}>) => void
  readonly _tiptapEditor?: {
    view?: {
      state?: {
        selection?: {
          $anchor?: {pos?: number}
        }
      }
    }
  }
}

export type AutoRebaseOptions = {
  /** Editor ref captured from `onEditorReady`. Must accept HMBlockNode[] via replaceBlocks after hmBlocksToEditorContent conversion. */
  editor: AutoRebaseEditor | null
  /** Called after a successful silent auto-merge. `author` may be null if unresolved. */
  onAutoMerged?: (author: string | null) => void
  /** Called when the merge can't be done automatically (Phase B will render UI). */
  onConflictDetected?: (conflict: {conflictedBlockIds: string[]; author: string | null}) => void
  /** Optional ref set to true while the hook is replacing editor content, so editor listeners can suppress `change` events. */
  suppressChangeRef?: {current: boolean}
  /** Debounce ms after the last `change` before attempting auto-rebase. Defaults to 1500. */
  idleDebounceMs?: number
}

/**
 * Walk a ListDocumentChanges payload backwards from `fromVersion` collecting
 * change CIDs introduced after `baseDeps`. Stops traversal when all predecessor
 * edges reach a dep in `baseDeps`.
 */
function collectNewChangeCids(
  changes: Array<{id?: string; deps?: string[]; createTime?: string; author?: string}>,
  fromVersion: string,
  baseDeps: string[],
): {newCids: Set<string>; latestAuthorCid: string | null; latestCreateTime: string | null} {
  const byId = new Map<string, (typeof changes)[number]>()
  for (const c of changes) if (c.id) byId.set(c.id, c)
  const baseSet = new Set(baseDeps)
  // fromVersion may be a dot-separated CID list (multi-head)
  const heads = fromVersion.split('.').filter(Boolean)
  const newCids = new Set<string>()
  const stack: string[] = []
  for (const h of heads) if (!baseSet.has(h)) stack.push(h)
  while (stack.length) {
    const id = stack.pop()!
    if (newCids.has(id) || baseSet.has(id)) continue
    newCids.add(id)
    const node = byId.get(id)
    if (!node?.deps) continue
    for (const d of node.deps) {
      if (!baseSet.has(d) && !newCids.has(d)) stack.push(d)
    }
  }
  let latestAuthorCid: string | null = null
  let latestCreateTime: string | null = null
  newCids.forEach((id) => {
    const node = byId.get(id)
    if (!node) return
    const t = node.createTime ?? ''
    if (!latestCreateTime || t > latestCreateTime) {
      latestCreateTime = t
      latestAuthorCid = node.author ?? null
    }
  })
  return {newCids, latestAuthorCid, latestCreateTime}
}

/**
 * Drives automatic rebase when a remote document update arrives during editing.
 *
 * Flow:
 * 1. When `editing.draft.idle` + a pending remote document is stashed + the
 *    user has been idle for `idleDebounceMs`.
 * 2. Fetch ListDocumentChanges for the document; walk the DAG from
 *    `pendingRemoteDocument.version` back to `context.deps` to compute the
 *    CIDs introduced since our base.
 * 3. Feed {base, mine, theirs, mineTouchedIds, newCids} to `classifyRebase`.
 * 4. If no conflicts: produce the merged tree with `applyRebasePlan`, swap
 *    editor content under `suppressChangeRef`, send `rebase.apply`, call
 *    `onAutoMerged` with the author display name.
 * 5. Otherwise: send `rebase.detectConflict` and call `onConflictDetected`
 *    (Phase B renders UI; Phase A leaves the UI stubbed).
 */
export function useAutoRebase({
  editor,
  onAutoMerged,
  onConflictDetected,
  suppressChangeRef,
  idleDebounceMs = 1500,
}: AutoRebaseOptions) {
  const actorRef = useDocumentMachineRef()
  const ctx = useSelector(actorRef, selectContext)
  const isIdle = useSelector(actorRef, selectIsEditingIdle)
  const isEditing = useSelector(actorRef, selectIsEditing)
  const pendingRemoteDocument = ctx.pendingRemoteDocument
  const pendingRebase = ctx.pendingRebase

  const targetId = ctx.documentId
  const changesQuery = useChanges(pendingRemoteDocument ? targetId : null)

  const latestAuthor = useMemo(() => {
    if (!pendingRemoteDocument || !changesQuery.data?.changes?.length) {
      return {cid: null as string | null, createTime: null as string | null}
    }
    const {latestAuthorCid, latestCreateTime} = collectNewChangeCids(
      changesQuery.data.changes,
      pendingRemoteDocument.version,
      ctx.deps,
    )
    return {cid: latestAuthorCid, createTime: latestCreateTime}
  }, [pendingRemoteDocument, changesQuery.data, ctx.deps])

  const authorAccount = useAccount(latestAuthor.cid)
  const authorName = authorAccount.data?.metadata?.name ?? null

  // Attempt to resolve the rebase once everything is ready.
  // Idle (no pending autosave) + debounce window since first entering idle
  // guards against applying mid-stroke.
  useEffect(() => {
    // Gate logs: only start reporting once we at least see a pending remote.
    if (pendingRemoteDocument) {
      console.log('[Rebase hook] gate', {
        isEditing,
        isIdle,
        hasPendingRemote: !!pendingRemoteDocument,
        pendingRemoteVersion: pendingRemoteDocument?.version,
        pendingRebase: pendingRebase?.kind ?? null,
        hasEditor: !!editor,
        hasBaseBlocks: !!ctx.baseBlocks,
        changesLoading: changesQuery.isLoading,
        mineTouched: ctx.mineTouchedIds,
        baseDeps: ctx.deps,
      })
    }
    if (!isEditing) return
    if (!isIdle) return
    if (!pendingRemoteDocument) return
    if (pendingRebase) return
    if (!editor) return
    if (!ctx.baseBlocks) return
    if (changesQuery.isLoading) return

    const baseBlocks = ctx.baseBlocks
    const remoteDoc = pendingRemoteDocument
    const mineTouched = ctx.mineTouchedIds
    const baseDeps = ctx.deps
    const changesList = (changesQuery.data?.changes ?? []) as Array<{
      id?: string
      deps?: string[]
      author?: string
      createTime?: string
    }>

    const timer = setTimeout(() => {
      const snap = actorRef.getSnapshot()
      if (!snap.matches('editing')) {
        console.log('[Rebase hook] skip: not in editing')
        return
      }
      if (!snap.matches({editing: {draft: 'idle'}})) {
        console.log('[Rebase hook] skip: not idle', snap.value)
        return
      }
      if (!snap.context.pendingRemoteDocument) {
        console.log('[Rebase hook] skip: pendingRemoteDocument cleared while waiting')
        return
      }
      if (snap.context.pendingRebase) {
        console.log('[Rebase hook] skip: pendingRebase already set')
        return
      }

      const {newCids} = collectNewChangeCids(changesList, remoteDoc.version, baseDeps)
      console.log('[Rebase hook] newCids from DAG walk', {
        count: newCids.size,
        cids: Array.from(newCids),
        remoteVersion: remoteDoc.version,
        baseDeps,
        totalChangesInList: changesList.length,
      })

      let mineNodes: HMBlockNode[]
      try {
        mineNodes = editorBlocksToHMBlockNodes(editor.topLevelBlocks as any)
      } catch (err) {
        console.log('[Rebase hook] editorBlocksToHMBlockNodes threw, falling back to baseBlocks', err)
        mineNodes = baseBlocks
      }

      const classification = classifyRebase(baseBlocks, mineNodes, remoteDoc.content ?? [], mineTouched, newCids)
      console.log('[Rebase hook] classification', {
        autoMergeable: classification.autoMergeable,
        conflictedBlockIds: classification.conflictedBlockIds,
        planMineBlocks: Array.from(classification.plan.mineBlocks),
        planTheirsBlocks: Array.from(classification.plan.theirsBlocks),
        mineTouchedInput: mineTouched,
        baseBlockIds: baseBlocks.map((n) => n.block?.id),
        mineBlockIds: mineNodes.map((n) => n.block?.id),
        theirsBlockIds: (remoteDoc.content ?? []).map((n) => n.block?.id),
      })

      if (!classification.autoMergeable) {
        console.log('[Rebase hook] -> detectConflict', {
          conflictedBlockIds: classification.conflictedBlockIds,
          author: authorName,
        })
        actorRef.send({
          type: 'rebase.detectConflict',
          conflictedBlockIds: classification.conflictedBlockIds,
          author: authorName,
        })
        onConflictDetected?.({conflictedBlockIds: classification.conflictedBlockIds, author: authorName})
        return
      }

      const merged = applyRebasePlan(mineNodes, remoteDoc.content ?? [], classification.plan)
      console.log('[Rebase hook] applying merge', {
        mergedBlockIds: merged.map((n) => n.block?.id),
        author: authorName,
      })
      // Peek the effective suppressRef on the editor right now. The one passed
      // as prop may have been captured as undefined if it was set on the editor
      // after useAutoRebase first ran.
      const liveSuppressRef =
        suppressChangeRef ??
        ((editor as unknown as {_suppressChangeRef?: {current: boolean}})._suppressChangeRef ?? undefined)
      console.log('[Rebase hook] suppressChangeRef present?', {
        fromProps: !!suppressChangeRef,
        fromEditor: !!(editor as any)?._suppressChangeRef,
        willSuppress: !!liveSuppressRef,
      })
      const editorBlocks = hmBlocksToEditorContent(merged, {childrenType: 'Group'})
      const extractText = (b: any): string => {
        const inline = b?.content
        if (Array.isArray(inline)) {
          return inline.map((i: any) => (typeof i?.text === 'string' ? i.text : '')).join('')
        }
        return ''
      }
      const mergedTextsHM = merged.map((n) => (n.block as any)?.text ?? '')
      const incomingTexts = (editorBlocks as any[]).map(extractText)
      const currentTexts = editor.topLevelBlocks.map(extractText)
      console.log('[Rebase hook] editor before replaceBlocks', {
        topLevelBlockIds: editor.topLevelBlocks.map((b: any) => b?.id),
        topLevelBlockTexts: currentTexts,
        incomingEditorBlockIds: (editorBlocks as any[]).map((b: any) => b?.id),
        incomingEditorBlockTexts: incomingTexts,
        mergedHMBlockNodeTexts: mergedTextsHM,
        textsDiffer: JSON.stringify(currentTexts) !== JSON.stringify(incomingTexts),
      })
      const prev = liveSuppressRef?.current ?? false
      if (liveSuppressRef) liveSuppressRef.current = true
      try {
        // BlockNote's `replaceBlocks` keeps existing blocks whose IDs match the incoming
        // ones — so a naive call with same-id merged blocks is a no-op. Instead apply
        // surgical ops: updateBlock for existing ids, insertBlocks for mine-only adds,
        // removeBlocks for structural deletes. This ensures same-id content actually
        // changes when theirs' text differs from mine's.
        const canSurgicalUpdate =
          typeof editor.updateBlock === 'function' &&
          typeof editor.insertBlocks === 'function' &&
          typeof editor.removeBlocks === 'function'

        if (canSurgicalUpdate) {
          const currentBlocks = editor.topLevelBlocks as Array<{id: string}>
          const currentIds = new Set(currentBlocks.map((b) => b.id))
          const incomingArr = editorBlocks as Array<{id: string}>
          const incomingIds = new Set(incomingArr.map((b) => b.id))

          // 1. Remove blocks no longer in merged output.
          const toRemove = currentBlocks.filter((b) => !incomingIds.has(b.id)).map((b) => b.id)
          if (toRemove.length) editor.removeBlocks!(toRemove)

          // 2. Update existing blocks + insert new ones in-order.
          let prevId: string | null = null
          for (const block of incomingArr) {
            if (currentIds.has(block.id)) {
              editor.updateBlock!(block.id, block)
              prevId = block.id
            } else {
              if (prevId) {
                editor.insertBlocks!([block], prevId, 'after')
              } else {
                // No prior anchor yet — insert before the first existing block, or at end.
                const firstExisting = incomingArr.find((b) => currentIds.has(b.id))
                if (firstExisting) {
                  editor.insertBlocks!([block], firstExisting.id, 'before')
                } else {
                  // Fallback: use replaceBlocks for the edge case of no existing anchor.
                  editor.replaceBlocks(editor.topLevelBlocks, [block])
                }
              }
              prevId = block.id
            }
          }
          console.log('[Rebase hook] surgical update applied', {
            removed: toRemove,
            total: incomingArr.length,
          })
        } else {
          console.log('[Rebase hook] editor lacks surgical API, falling back to replaceBlocks')
          editor.replaceBlocks(editor.topLevelBlocks, editorBlocks as unknown[])
        }
      } finally {
        if (liveSuppressRef) liveSuppressRef.current = prev
      }
      console.log('[Rebase hook] editor after replaceBlocks', {
        topLevelBlockIds: editor.topLevelBlocks.map((b: any) => b?.id),
        topLevelBlockTexts: editor.topLevelBlocks.map((b: any) => {
          const inline = b?.content
          if (Array.isArray(inline)) {
            return inline.map((i: any) => (typeof i?.text === 'string' ? i.text : '')).join('')
          }
          return ''
        }),
      })

      actorRef.send({type: 'rebase.apply', mergedBlocks: merged, newDocument: remoteDoc})
      // Kick the autosave pipeline so the merged blocks hit the draft file on disk.
      // Without this, a reload before the user's next keystroke reverts the merge.
      actorRef.send({type: 'change'})
      const postSnap = actorRef.getSnapshot()
      console.log('[Rebase hook] post-apply state', {
        stateValue: postSnap.value,
        publishedVersion: postSnap.context.publishedVersion,
        deps: postSnap.context.deps,
        mineTouchedIds: postSnap.context.mineTouchedIds,
        pendingRemoteDocument: !!postSnap.context.pendingRemoteDocument,
        pendingRebase: postSnap.context.pendingRebase,
      })
      onAutoMerged?.(authorName)
    }, idleDebounceMs)
    return () => clearTimeout(timer)
  }, [
    actorRef,
    isEditing,
    isIdle,
    pendingRemoteDocument,
    pendingRebase,
    editor,
    ctx.baseBlocks,
    ctx.mineTouchedIds,
    ctx.deps,
    changesQuery.data,
    changesQuery.isLoading,
    authorName,
    idleDebounceMs,
    onAutoMerged,
    onConflictDetected,
    suppressChangeRef,
  ])
}

// Re-export machine and types for convenience
export {documentMachine} from './document-machine'
export type {
  DocumentMachineContext,
  DocumentMachineEvent,
  DocumentMachineInput,
  PendingRebase,
} from './document-machine'
