import type {HMBlockNode, HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext} from 'react'

/** Options accepted by DraftActions.onCreateInlineDraft. Used by
 * "Turn into doc" to seed the new draft with the selected blocks and a
 * derived name. */
export type CreateInlineDraftOptions = {
  initialContent?: HMBlockNode[]
  name?: string
}

/**
 * Callbacks the editor needs for inline draft embeds: create a new child
 * draft, look up an existing draft's metadata, delete draft, and navigate to draft
 * editor route. On web the context value null and the "New document" slash item is hidden.
 */
export type DraftActions = {
  onCreateInlineDraft: (
    parentId: UnpackedHypermediaId,
    options?: CreateInlineDraftOptions,
  ) => Promise<{draftId: string; draftPath: string[]}>
  /** React hook, which returns the draft's reactive query result. */
  useInlineDraft: (id: string | undefined) => {data?: HMListedDraft | null}
  onDeleteDraft: (id: string) => Promise<void>
  onOpenDraft: (draftId: string, draftPath: string[]) => void
}

export const DraftActionsContext = createContext<DraftActions | null>(null)

/** Returns the draft action callbacks, or null
 * when no host provider is mounted. */
export function useDraftActions(): DraftActions | null {
  return useContext(DraftActionsContext)
}
