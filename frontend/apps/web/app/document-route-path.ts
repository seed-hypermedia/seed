import {isSiteProfileTab, VIEW_TERMS, viewTermToRouteKey, type InspectTab, type ViewRouteKey} from '@shm/shared'

/** Parsed document route view suffix and cleaned document path. */
export type DocumentRouteViewParts = {
  path: string[]
  viewTerm: ViewRouteKey | null
  activityFilter?: string
  commentId?: string
  accountUid?: string
}

/**
 * Extracts a Seed document view suffix from URL path parts.
 *
 * Examples:
 * - `docs/:activity/changes` -> document path `docs`, activity panel filter `changes`
 * - `docs/:comments/uid/tsid` -> document path `docs`, opened comment `uid/tsid`
 * - `docs/:followers/alice` -> document path `docs`, site profile tab for `alice`
 */
export function extractViewTermFromPath(pathParts: string[]): DocumentRouteViewParts {
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

/** Extracts the optional inspect prefix from gateway or site document path parts. */
export function extractInspectPrefixFromPath(
  pathParts: string[],
  isGatewayPath: boolean,
): {pathParts: string[]; isInspect: boolean} {
  if (isGatewayPath) {
    if (pathParts[1] === 'inspect') {
      return {pathParts: pathParts.slice(2), isInspect: true}
    }
    return {pathParts: pathParts.slice(1), isInspect: false}
  }

  if (pathParts[0] === 'inspect') {
    return {pathParts: pathParts.slice(1), isInspect: true}
  }

  return {pathParts, isInspect: false}
}

/** Extracts an inspect-ipfs route payload from gateway or site path parts. */
export function extractInspectIpfsPathFromPath(pathParts: string[], isGatewayPath: boolean): string | null {
  if (isGatewayPath) {
    return pathParts[1] === 'inspect' && pathParts[2] === 'ipfs' ? pathParts.slice(3).join('/') || null : null
  }

  return pathParts[0] === 'inspect' && pathParts[1] === 'ipfs' ? pathParts.slice(2).join('/') || null : null
}

/** Route data dependencies that should cause the document loader to re-run. */
export function getDocumentRouteLoaderDeps(url: URL): {pathname: string; version: string | null; latest: boolean} {
  const version = url.searchParams.get('v')
  return {
    pathname: url.pathname,
    version,
    latest: url.searchParams.get('l') === '' || !version,
  }
}

/**
 * Shared document route revalidation policy.
 *
 * TanStack Router can use `getDocumentRouteLoaderDeps`; the current Remix route
 * uses this compatibility helper to preserve behavior during the migration.
 */
export function shouldReloadDocumentRouteData(currentUrl: URL, nextUrl: URL, defaultShouldReload: boolean): boolean {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldReload

  const currentDeps = getDocumentRouteLoaderDeps(currentUrl)
  const nextDeps = getDocumentRouteLoaderDeps(nextUrl)

  if (currentDeps.version === nextDeps.version && currentDeps.latest === nextDeps.latest) {
    return false
  }

  return defaultShouldReload
}

/** Main document route inspect tab query value after validation by route loaders. */
export type DocumentRouteInspectTab = InspectTab
