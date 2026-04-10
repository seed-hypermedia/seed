import {resolveHypermediaUrl, type ResolveOptions} from '@seed-hypermedia/client'
import {createDocumentNavRoute, createInspectNavRoute, type NavRoute} from '@shm/shared/routes'
import {
  activitySlugToFilter,
  extractViewTermFromUrl,
  isSiteProfileTab,
  routeToHmUrl,
  viewTermToRouteKey,
} from '@shm/shared/utils/entity-id-url'
import {appRouteOfId} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'

/**
 * Resolves a URL using the same routing rules as the desktop omnibar.
 */
export async function resolveOmnibarUrlToRoute(url: string, opts?: ResolveOptions): Promise<NavRoute | null> {
  const directRoute = hypermediaUrlToRoute(url)
  if (directRoute) return directRoute

  const {url: cleanUrl, isInspect, viewTerm, activityFilter, commentId, accountUid} = extractViewTermFromUrl(url)
  const routeKey = viewTermToRouteKey(viewTerm)

  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return null
  }

  try {
    const result = await resolveHypermediaUrl(cleanUrl, opts)
    if (!result?.hmId) return null

    const baseRoute = result.panel ? createDocumentNavRoute(result.hmId, null, result.panel) : appRouteOfId(result.hmId)
    if (!baseRoute) return null

    return applyResolvedViewTerm(baseRoute, routeKey, activityFilter, commentId, accountUid, isInspect)
  } catch {
    return null
  }
}

/**
 * Resolves a URL using omnibar routing rules and returns the hm:// URL form.
 */
export async function resolveOmnibarUrlToHypermediaUrl(url: string, opts?: ResolveOptions): Promise<string | null> {
  const route = await resolveOmnibarUrlToRoute(url, opts)
  if (!route) return null
  return routeToHmUrl(route)
}

function applyResolvedViewTerm(
  route: NavRoute,
  routeKey: ReturnType<typeof viewTermToRouteKey>,
  activityFilter?: string,
  commentId?: string,
  accountUid?: string,
  isInspect?: boolean,
): NavRoute {
  if (route.key !== 'document') return route

  if (isInspect) {
    return createInspectNavRoute(
      route.id,
      routeKey,
      routeKey === 'activity' && activityFilter ? `activity/${activityFilter}` : null,
      commentId,
      accountUid,
    )
  }

  if (!routeKey) return route

  if (routeKey === 'comments' && commentId) {
    return {key: 'comments', id: route.id, openComment: commentId}
  }

  if (isSiteProfileTab(routeKey)) {
    return {key: 'site-profile', id: route.id, accountUid: accountUid || undefined, tab: routeKey}
  }

  if (routeKey === 'activity') {
    return {
      key: 'activity',
      id: route.id,
      filterEventType: activityFilter ? activitySlugToFilter(activityFilter) : undefined,
    }
  }

  return {key: routeKey, id: route.id}
}
