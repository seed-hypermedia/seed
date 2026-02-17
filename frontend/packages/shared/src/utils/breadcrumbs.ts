import {UnpackedHypermediaId} from '../hm-types'
import {hmId} from './entity-id-url'

export function getParentPaths(path?: string[] | null): string[][] {
  if (!path) return [[]]
  let walkParentPaths: string[] = []
  return [
    [],
    ...path.map((term) => {
      walkParentPaths = [...walkParentPaths, term]
      return walkParentPaths
    }),
  ]
}

/**
 * Build breadcrumb document IDs from home to current document.
 * Parent breadcrumbs are unversioned; the current breadcrumb preserves
 * the document's version/latest flags so it matches the active resource query.
 */
export function getBreadcrumbDocumentIds(
  docId: UnpackedHypermediaId,
): UnpackedHypermediaId[] {
  const parentPaths = getParentPaths(docId.path)
  const lastPathIndex = parentPaths.length - 1

  return parentPaths.map((path, index) => {
    if (index !== lastPathIndex) {
      return hmId(docId.uid, {path})
    }
    return hmId(docId.uid, {
      path,
      version: docId.version ?? undefined,
      latest: docId.latest ?? undefined,
    })
  })
}
