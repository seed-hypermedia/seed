import {HMDocument, HMResourceVisibility, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, hmIdPathToEntityQueryPath} from '@shm/shared'
import {documentContainsLinkToChild, documentHasSelfQuery} from '@seed-hypermedia/client'
import {pathNameify} from './path'

/**
 * Compute the publish path for a document.
 * Private docs keep their random ID path as-is.
 * Public docs append a pathNameified version of the doc name.
 */
export function computePublishPath(isPrivate: boolean, basePath: string[], docName: string): string[] {
  if (isPrivate) return basePath
  const pathifiedName = pathNameify(docName || 'Untitled Document')
  return [...basePath, pathifiedName]
}

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

/**
 * Validate the publish path. Returns an error string or null.
 * Private docs skip path validation entirely since their paths
 * contain random IDs that start with special characters.
 */
export function validatePublishPath(
  isPrivate: boolean,
  path: string[] | null,
  validatePathFn: (path: string) => {error: string} | null,
): string | null {
  if (isPrivate) return null
  const result = validatePathFn(hmIdPathToEntityQueryPath(path))
  return result?.error ?? null
}

/**
 * Determine whether a parent auto-link should be added.
 * Private docs never add links to parents.
 */
export function shouldAutoLinkParent(
  isPrivate: boolean,
  parentDocument: HMDocument | null,
  editableLocation: UnpackedHypermediaId,
  parentId: UnpackedHypermediaId,
): boolean {
  if (isPrivate) return false

  if (parentDocument) {
    if (documentContainsLinkToChild(parentDocument, editableLocation)) {
      return false
    }
    if (documentHasSelfQuery(parentDocument, parentId)) {
      return false
    }
  }

  return true
}

/**
 * Resolve the path used for a publish, given the current destination path and
 * the draft. Precedence:
 *   1. `pathOverride` from the publish popover (user picked it).
 *   2. Inline first-publish: `currentPath` still ends with `-${draftId}` AND
 *      no doc exists at that path → swap the placeholder for the title slug
 *      via `computeInlineDraftPublishPath`.
 *   3. Otherwise return `currentPath` unchanged.
 *
 * Skipped (returns `currentPath` unchanged):
 *   - private docs (random-id paths are intentional),
 *   - home-doc edits (empty path),
 *   - re-publishes (the doc exists at this path).
 */
export function resolvePublishPath(args: {
  currentPath: string[]
  draftId: string
  draftName: string
  isPrivate: boolean
  existsAtDestination: boolean
  pathOverride?: string[]
}): string[] {
  const {currentPath, draftId, draftName, isPrivate, existsAtDestination, pathOverride} = args
  if (pathOverride) return pathOverride
  if (existsAtDestination) return currentPath
  if (isPrivate) return currentPath
  if (currentPath.length === 0) return currentPath
  const lastSeg = currentPath.at(-1) || ''
  if (lastSeg !== `-${draftId}`) return currentPath
  return computeInlineDraftPublishPath(currentPath, draftName, draftId)
}

/**
 * Compute the parameters needed to create a new draft and the document route
 * to navigate to so the unified document machine picks it up.
 *
 * Three cases:
 * 1. Editing an existing doc — `editUid`/`editPath` provided. Document route
 *    targets that doc; draft writer records edit anchor + deps.
 * 2. Public new doc at a location — `locationUid` provided. Draft path becomes
 *    `[...locationPath, '-${draftId}']` so `useExistingDraft` can match the
 *    document route via editUid/editPath.
 * 3. Private doc — needs a `locationUid` (or `selectedAccountId`) and a random
 *    path so the doc has a stable home before publish.
 *
 * Returns null when a private doc is requested but no locationUid is available.
 */
export function computeNewDraftParams(
  visibility: HMResourceVisibility | undefined,
  draftParams: {
    locationUid?: string
    locationPath?: string[]
    editUid?: string
    editPath?: string[]
    deps?: string[]
  },
  selectedAccountId: string | undefined,
  generateId: () => string,
  generatePath: () => string,
): {
  draftId: string
  writeParams: {
    id: string
    locationUid?: string
    locationPath?: string[]
    editUid?: string
    editPath?: string[]
    deps?: string[]
    visibility: HMResourceVisibility
  }
  routeId: UnpackedHypermediaId
} | null {
  const draftId = generateId()

  if (visibility === 'PRIVATE') {
    const locationUid = draftParams.locationUid || selectedAccountId
    if (!locationUid) return null
    const privatePath = generatePath()
    return {
      draftId,
      writeParams: {
        id: draftId,
        locationUid,
        locationPath: [privatePath],
        editUid: locationUid,
        editPath: [privatePath],
        visibility: 'PRIVATE',
      },
      routeId: hmId(locationUid, {path: [privatePath]}),
    }
  }

  if (draftParams.editUid) {
    const editPath = draftParams.editPath || []
    return {
      draftId,
      writeParams: {
        id: draftId,
        editUid: draftParams.editUid,
        editPath,
        deps: draftParams.deps,
        visibility: visibility ?? 'PUBLIC',
      },
      routeId: hmId(draftParams.editUid, {path: editPath}),
    }
  }

  if (draftParams.locationUid) {
    const locationPath = draftParams.locationPath || []
    const editPath = [...locationPath, `-${draftId}`]
    return {
      draftId,
      writeParams: {
        id: draftId,
        locationUid: draftParams.locationUid,
        locationPath,
        editUid: draftParams.locationUid,
        editPath,
        deps: draftParams.deps,
        visibility: visibility ?? 'PUBLIC',
      },
      routeId: hmId(draftParams.locationUid, {path: editPath}),
    }
  }

  return null
}
