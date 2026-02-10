import {
  HMDocument,
  HMResourceVisibility,
  UnpackedHypermediaId,
  hmIdPathToEntityQueryPath,
} from '@shm/shared'
import {
  documentContainsLinkToChild,
  documentHasSelfQuery,
} from '../models/auto-link-utils'
import {pathNameify} from './path'

/**
 * Compute the publish path for a document.
 * Private docs keep their random ID path as-is.
 * Public docs append a pathNameified version of the doc name.
 */
export function computePublishPath(
  isPrivate: boolean,
  basePath: string[],
  docName: string,
): string[] {
  if (isPrivate) return basePath
  const pathifiedName = pathNameify(docName || 'Untitled Document')
  return [...basePath, pathifiedName]
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
 * Compute the draft route params for creating a new document.
 * Private docs use the current location uid (falling back to selectedAccountId)
 * with a random path. Public docs use draftParams as-is.
 * Returns null if a private doc is requested but no locationUid is available.
 */
export function computeDraftRoute(
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
):
  | {
      key: 'draft'
      id: string
      locationUid: string
      locationPath: string[]
      visibility: 'PRIVATE'
    }
  | {
      key: 'draft'
      id: string
      locationUid?: string
      locationPath?: string[]
      editUid?: string
      editPath?: string[]
      deps?: string[]
      visibility?: HMResourceVisibility
    }
  | null {
  const id = generateId()

  if (visibility === 'PRIVATE') {
    const locationUid = draftParams.locationUid || selectedAccountId
    if (!locationUid) return null
    const privatePath = generatePath()
    return {
      key: 'draft',
      id,
      locationUid,
      locationPath: [privatePath],
      visibility: 'PRIVATE',
    }
  }

  return {
    key: 'draft',
    id,
    ...draftParams,
    visibility: visibility ?? undefined,
  }
}
