import {type NavRoute, createDocumentNavRoute} from '../routes'
import {activitySlugToFilter, extractViewTermFromUrl, parseCustomURL, viewTermToRouteKey} from './entity-id-url'
import {appRouteOfId} from './navigation'
import {unpackHmId} from './entity-id-url'

/**
 * Converts a directly parseable Hypermedia app URL into an application route.
 */
export function hypermediaUrlToRoute(url: string): NavRoute | null {
  const {url: cleanUrl, viewTerm, activityFilter, commentId, accountUid} = extractViewTermFromUrl(url)
  const routeKey = viewTermToRouteKey(viewTerm)
  const id = unpackHmId(cleanUrl)
  if (!id) return null

  const panelParam = parseCustomURL(cleanUrl)?.query.panel || null
  if (routeKey || panelParam || commentId || accountUid) {
    const route = createDocumentNavRoute(id, routeKey, panelParam, commentId, accountUid)
    if (route.key === 'activity' && activityFilter) {
      return {
        ...route,
        filterEventType: activitySlugToFilter(activityFilter),
      }
    }
    return route
  }

  return appRouteOfId(id) || null
}
