import {useSelector} from '@xstate/react'
import {useCallback} from 'react'
import {
  DocumentMachineSnapshot,
  selectCanEdit,
  selectIsEditing,
  useDocumentMachineRefOptional,
} from './use-document-machine'

function safeCanEdit(snapshot: DocumentMachineSnapshot | undefined): boolean {
  return snapshot ? selectCanEdit(snapshot) : false
}

function safeIsEditing(snapshot: DocumentMachineSnapshot | undefined): boolean {
  return snapshot ? selectIsEditing(snapshot) : false
}

/**
 * Shared editor-affordance gate used by block-level controls (options panel,
 * query-block pencil, media controls, site header nav editor).
 *
 * Returns:
 * - `canEdit`: whether the current user has write permission on the document.
 *   Resolves to `false` when outside a `DocumentMachineProvider` so callers can
 *   render safely in pure read contexts (e.g. web app).
 * - `isEditing`: whether the machine is currently in the `editing` state.
 * - `beginEditIfNeeded()`: idempotent transition into `editing`. Sends
 *   `edit.start` only when the user can edit and the machine is not already
 *   editing. Phase 0 guarantees `editor.isEditable` flips synchronously inside
 *   the `editing` entry action, so callers may follow `beginEditIfNeeded()`
 *   with `editor.updateBlock(...)` without waiting a render.
 */
export function useEditorGate() {
  const actorRef = useDocumentMachineRefOptional()
  const canEdit = useSelector(actorRef ?? undefined, safeCanEdit)
  const isEditing = useSelector(actorRef ?? undefined, safeIsEditing)

  const beginEditIfNeeded = useCallback(() => {
    if (!actorRef) return
    const snapshot = actorRef.getSnapshot()
    if (!selectCanEdit(snapshot)) return
    if (selectIsEditing(snapshot)) return
    actorRef.send({type: 'edit.start'})
  }, [actorRef])

  return {canEdit, isEditing, beginEditIfNeeded}
}
