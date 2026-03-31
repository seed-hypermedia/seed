import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import {createDocumentNavRoute, type NavRoute} from '@shm/shared/routes'
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
export async function resolveOmnibarUrlToRoute(url: string): Promise<NavRoute | null> {
  const directRoute = hypermediaUrlToRoute(url)
  if (directRoute) return directRoute

  const {url: cleanUrl, viewTerm, activityFilter, commentId, accountUid} = extractViewTermFromUrl(url)
  const routeKey = viewTermToRouteKey(viewTerm)

  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return null
  }

  try {
    const result = await resolveHypermediaUrl(cleanUrl)
    if (!result?.hmId) return null

    const baseRoute = result.panel ? createDocumentNavRoute(result.hmId, null, result.panel) : appRouteOfId(result.hmId)
    if (!baseRoute) return null

    return applyResolvedViewTerm(baseRoute, routeKey, activityFilter, commentId, accountUid)
  } catch {
    return null
  }
}

/**
 * Resolves a URL using omnibar routing rules and returns the hm:// URL form.
 */
export async function resolveOmnibarUrlToHypermediaUrl(url: string): Promise<string | null> {
  const route = await resolveOmnibarUrlToRoute(url)
  if (!route) return null
  return routeToHmUrl(route)
}

function applyResolvedViewTerm(
  route: NavRoute,
  routeKey: ReturnType<typeof viewTermToRouteKey>,
  activityFilter?: string,
  commentId?: string,
  accountUid?: string,
): NavRoute {
  if (!routeKey) return route
  if (route.key !== 'document') return route

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
