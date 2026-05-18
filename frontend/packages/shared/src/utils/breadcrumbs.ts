import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from './entity-id-url'

/**
 * A breadcrumb path segment that starts with `-` is the placeholder slug we
 * assign to a new child draft before it is published. Use this as a fast
 * pre-check before the full draft-list lookup.
 */
export function isDraftPathSegment(segment: string | undefined | null): boolean {
  return !!segment && segment.startsWith('-')
}

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
export function getBreadcrumbDocumentIds(docId: UnpackedHypermediaId): UnpackedHypermediaId[] {
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
