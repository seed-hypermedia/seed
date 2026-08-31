import {isSiteProfileTab, VIEW_TERMS, viewTermToRouteKey, type ViewRouteKey} from '@shm/shared'

/**
 * Extract view term from path parts and return cleaned path + view term
 * e.g., ['docs', ':activity'] -> {path: ['docs'], viewTerm: 'activity'}
 */
export function extractViewTermFromPath(pathParts: string[]): {
  path: string[]
  viewTerm: ViewRouteKey | null
  activityFilter?: string
  commentId?: string
  accountUid?: string
} {
  if (pathParts.length === 0) return {path: [], viewTerm: null}

  // Check for :comments/UID/TSID pattern (3 segments from end)
  if (pathParts.length >= 3) {
    const thirdToLast = pathParts[pathParts.length - 3]
    if (thirdToLast === ':comments' || thirdToLast === ':comment' || thirdToLast === ':discussions') {
      return {
        path: pathParts.slice(0, -3),
        viewTerm: 'comments',
        commentId: `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`,
      }
    }
  }

  // Check for :comments/COMMENT_ID pattern (2 segments from end)
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    if (secondToLast === ':comments' || secondToLast === ':comment' || secondToLast === ':discussions') {
      return {
        path: pathParts.slice(0, -2),
        viewTerm: 'comments',
        commentId: pathParts[pathParts.length - 1],
      }
    }
  }

  // Check for :activity/<slug> pattern (second-to-last + last)
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    if (secondToLast === ':activity') {
      return {
        path: pathParts.slice(0, -2),
        viewTerm: 'activity',
        activityFilter: pathParts[pathParts.length - 1],
      }
    }
  }

  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    const lastPart = pathParts[pathParts.length - 1]
    if (secondToLast && lastPart) {
      const tab = secondToLast.startsWith(':') ? secondToLast.slice(1) : null
      if (isSiteProfileTab(tab)) {
        return {
          path: pathParts.slice(0, -2),
          viewTerm: tab,
          accountUid: lastPart,
        }
      }
    }
  }

  const lastPart = pathParts[pathParts.length - 1]
  const viewTermMatch = VIEW_TERMS.find((term) => lastPart === term)

  if (viewTermMatch) {
    const viewTerm = viewTermToRouteKey(viewTermMatch)
    if (viewTerm) {
      return {
        path: pathParts.slice(0, -1),
        viewTerm,
      }
    }
  }

  return {path: pathParts, viewTerm: null}
}
