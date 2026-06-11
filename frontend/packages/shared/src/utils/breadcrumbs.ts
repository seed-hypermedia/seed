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

/** Return the draft id encoded by a public/private placeholder path segment. */
export function getDraftIdFromDraftPathSegment(segment: string | undefined | null): string | null {
  if (!isDraftPathSegment(segment)) return null
  const privatePrefix = '-private-'
  const id = segment!.startsWith(privatePrefix) ? segment!.slice(privatePrefix.length) : segment!.slice(1)
  return id.length ? id : null
}

/** Return true when a placeholder segment represents a private draft route. */
export function isPrivateDraftPathSegment(segment: string | undefined | null): boolean {
  return !!segment && segment.startsWith('-private-')
}

/** Return the parent document id when the current id points at a draft placeholder segment. */
export function getDraftPlaceholderParentId(
  docId: UnpackedHypermediaId,
  draftId: string | undefined | null,
): UnpackedHypermediaId | null {
  if (!draftId) return null
  const path = docId.path ?? []
  const last = path.at(-1)
  if (last !== `-${draftId}` && last !== `-private-${draftId}`) return null
  return hmId(docId.uid, {path: path.slice(0, -1)})
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
 * True when targetId is a descendant of parentId. Used to decide how
 * to label cross-document HM links in the embed Link view.
 */
export function isHmDescendantOf(
  targetId: UnpackedHypermediaId,
  parentId: UnpackedHypermediaId | null | undefined,
): boolean {
  if (!parentId) return false
  if (targetId.uid !== parentId.uid) return false
  const targetPath = targetId.path ?? []
  const parentPath = parentId.path ?? []
  if (targetPath.length <= parentPath.length) return false
  for (let i = 0; i < parentPath.length; i++) {
    if (targetPath[i] !== parentPath[i]) return false
  }
  return true
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
