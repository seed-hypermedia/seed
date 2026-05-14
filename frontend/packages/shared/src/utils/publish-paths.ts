import {pathNameify} from './path'

/**
 * For a "claimed" inline draft (editPath = parent + `-${draftId}`),
 * compute the final published path from the title slug. The fallback
 * `untitled-${draftId}` keeps multiple untitled drafts collision-free.
 * An empty `currentEditPath` means a home-document edit; the root path
 * is preserved as-is so callers cannot accidentally publish a sibling
 * `untitled-*` document at the site root.
 */
export function computeInlineDraftPublishPath(currentEditPath: string[], docName: string, draftId: string): string[] {
  if (currentEditPath.length === 0) return []
  const parentPath = currentEditPath.slice(0, -1)
  const slug = pathNameify(docName || '') || `untitled-${draftId}`
  return [...parentPath, slug]
}
