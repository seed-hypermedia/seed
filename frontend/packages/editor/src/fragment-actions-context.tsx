import {createContext, useContext} from 'react'

/**
 * Callbacks for fragment-level actions (Copy Link, Comment) that need to be
 * available inside the formatting toolbar. These reference the **published**
 * version of the document so citations/comments target stable content.
 *
 * When the context value is `null` (no published version), consumers should
 * hide the corresponding buttons.
 */
export type FragmentActions = {
  onCopyFragmentLink: (blockId: string, rangeStart: number, rangeEnd: number) => void
  onComment: (blockId: string, rangeStart: number, rangeEnd: number) => void
}

export const FragmentActionsContext = createContext<FragmentActions | null>(null)

/**
 * Returns the fragment action callbacks, or `null` if the document has no
 * published version (actions should be hidden).
 */
export function useFragmentActions(): FragmentActions | null {
  return useContext(FragmentActionsContext)
}
