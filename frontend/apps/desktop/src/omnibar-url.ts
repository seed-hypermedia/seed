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

function getUrlHostname(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/**
 * Returns the current site's custom domain only when it is actively resolving
 * to the same account as the page shown in the desktop omnibar.
 */
export function selectValidatedOmnibarSiteUrl(params: {
  candidateSiteUrl?: string | null
  gatewayUrl: string
  accountUid?: string | null
  registeredAccountUid?: string | null
  domainStatus?: string | null
  isDomainLoading?: boolean
}): string | null {
  const candidateHostname = getUrlHostname(params.candidateSiteUrl)
  const gatewayHostname = getUrlHostname(params.gatewayUrl)

  if (!params.candidateSiteUrl || !candidateHostname) return null
  if (gatewayHostname && candidateHostname === gatewayHostname) return null

  // Domain check still in flight — optimistically show what the user typed.
  if (params.isDomainLoading) return params.candidateSiteUrl

  // Domain check did not succeed (error, unreachable, unknown, or query
  // returned null). Keep showing the candidate — we only rewrite to gateway
  // when the check *successfully* resolves to the wrong account.
  if (params.domainStatus !== 'success') return params.candidateSiteUrl

  // Domain check succeeded. Verify the account matches.
  if (!params.accountUid || !params.registeredAccountUid) return null
  if (params.registeredAccountUid !== params.accountUid) return null

  return params.candidateSiteUrl
}

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
