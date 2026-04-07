import {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {useActorRef, useSelector} from '@xstate/react'
import {createContext, createElement, ReactNode, useContext, useEffect, useRef} from 'react'
import {ActorRefFrom, SnapshotFrom} from 'xstate'
import {
  documentMachine,
  DocumentMachineContext,
  DocumentMachineEvent,
  DocumentMachineInput,
  PublishInput,
  WriteDraftInput,
} from './document-machine'

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
  const actorRef = useActorRef(machine ?? documentMachine, {input, inspect})

  // Debug: log actual actor creation (fires only on mount / machine change)
  useEffect(() => {
    console.log('[DocumentMachine] actor created with input:', {
      documentId: input.documentId.uid + '/' + (input.documentId.path?.join('/') || ''),
      canEdit: input.canEdit,
      existingDraftId: input.existingDraftId,
      signingAccountId: input.signingAccountId,
    })

    const sub = actorRef.subscribe((snapshot) => {
      const value = snapshot.value
      const ctx = snapshot.context
      console.log(
        '[DocumentMachine] state:',
        JSON.stringify(value),
        '| draftId:',
        ctx.draftId,
        '| draftCreated:',
        ctx.draftCreated,
        '| shouldAutoEdit:',
        ctx.shouldAutoEdit,
      )
    })
    return () => sub.unsubscribe()
  }, [actorRef])

  return createElement(DocumentMachineContext_.Provider, {value: actorRef}, children)
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
  resolved: {draftId: string | null; content: HMBlockNode[] | null; cursorPosition: number | null} | undefined,
) {
  const actorRef = useDocumentMachineRef()
  const sentRef = useRef(false)

  useEffect(() => {
    if (resolved !== undefined && !sentRef.current) {
      sentRef.current = true
      console.log('[DraftResolutionSync] sending draft.resolved, draftId:', resolved.draftId)
      actorRef.send({
        type: 'draft.resolved',
        draftId: resolved.draftId,
        content: resolved.content,
        cursorPosition: resolved.cursorPosition,
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

// Re-export machine and types for convenience
export {documentMachine} from './document-machine'
export type {DocumentMachineContext, DocumentMachineEvent, DocumentMachineInput} from './document-machine'
