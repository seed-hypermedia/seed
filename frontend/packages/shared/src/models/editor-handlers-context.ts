import {createContext, MutableRefObject, useContext} from 'react'

/**
 * Imperative hooks the document machine calls when entering/exiting `editing`.
 * Populated by `DocumentEditor` once the BlockNote instance is ready, and
 * consumed by action implementations provided via `.provide()` on the machine.
 */
export type EditorHandlers = {
  /** Flip the editor's `isEditable` flag synchronously. */
  setEditable: (editable: boolean) => void
  /** Replace the editor content with whatever blocks should be loaded on entry. */
  applyInitialContent: () => void
  /** Place the cursor from the pending click position or the saved draft position. */
  placeCursor: () => void
}

/**
 * Context that exposes a mutable ref to the editor handlers. The provider
 * (`DocumentMachineProvider`) owns the ref so machine-provided actions can
 * always read `ref.current` and see the freshest handlers without re-creating
 * the actor.
 */
export const EditorHandlersContext = createContext<MutableRefObject<EditorHandlers | null> | null>(null)

/**
 * Read the editor handlers ref from context.
 * Throws if used outside an `EditorHandlersContext.Provider` (i.e. outside
 * `DocumentMachineProvider`).
 */
export function useEditorHandlersRef(): MutableRefObject<EditorHandlers | null> {
  const ref = useContext(EditorHandlersContext)
  if (!ref) {
    throw new Error('useEditorHandlersRef must be used within a DocumentMachineProvider')
  }
  return ref
}
