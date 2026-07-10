import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  INSPECT_TABS,
  type InspectTab,
  type NavRoute,
  createDocumentNavRoute,
  createInspectIpfsNavRoute,
  createInspectNavRoute,
  type SiteSettingsTab,
} from '../routes'
import {
  activitySlugToFilter,
  extractViewTermFromUrl,
  parseCustomURL,
  routeToUrl,
  viewTermToRouteKey,
} from './entity-id-url'
import {appRouteOfId} from './navigation'
import {unpackHmId} from './entity-id-url'

/**
 * Converts a directly parseable Hypermedia app URL into an application route.
 */
export function hypermediaUrlToRoute(url: string): NavRoute | null {
  const inspectIpfsMatch =
    url.match(/^hm:\/\/inspect\/ipfs\/([^?#]+)(?:[?#].*)?$/) ||
    url.match(/^((?:https?:\/\/[^/]+)?\/hm)\/inspect\/ipfs\/([^?#]+)(?:[?#].*)?$/) ||
    url.match(/^((?:https?:\/\/[^/]+)?)\/inspect\/ipfs\/([^?#]+)(?:[?#].*)?$/)
  if (inspectIpfsMatch) {
    const ipfsPath = inspectIpfsMatch.at(-1)
    return ipfsPath ? createInspectIpfsNavRoute(ipfsPath) : null
  }

  const {
    url: cleanUrl,
    isInspect,
    viewTerm,
    activityFilter,
    commentId,
    accountUid,
    settingsTab,
  } = extractViewTermFromUrl(url)
  const routeKey = viewTermToRouteKey(viewTerm)
  const id = unpackHmId(cleanUrl)
  if (!id) return null

  const query = parseCustomURL(cleanUrl)?.query
  const panelParam = query?.panel || null
  const effectivePanelParam =
    !panelParam && routeKey === 'activity' && activityFilter ? `activity/${activityFilter}` : panelParam
  const inspectTabParam = query?.tab
  const inspectTab =
    isInspect && inspectTabParam && (INSPECT_TABS as readonly string[]).includes(inspectTabParam)
      ? (inspectTabParam as InspectTab)
      : null

  if (isInspect) {
    return createInspectNavRoute(id, routeKey, effectivePanelParam, commentId, accountUid, inspectTab)
  }

  if (routeKey || panelParam || commentId || accountUid) {
    const route = createDocumentNavRoute(id, routeKey, effectivePanelParam, commentId, accountUid)
    if (route.key === 'activity' && activityFilter) {
      return {
        ...route,
        filterEventType: activitySlugToFilter(activityFilter),
      }
    }
    if (route.key === 'site-settings' && settingsTab) {
      return {...route, tab: settingsTab as SiteSettingsTab}
    }
    return route
  }

  return appRouteOfId(id) || null
}

/**
 * Converts a parseable Hypermedia app URL into the browser-safe href for the
 * current web origin. Non-Hypermedia URLs are returned unchanged.
 */
export function hypermediaUrlToHref(
  url: string | null | undefined,
  options?: {
    hmUrlHref?: boolean
    originHomeId?: UnpackedHypermediaId
    origin?: string | null
  },
) {
  if (!url || options?.hmUrlHref) return url
  const route = hypermediaUrlToRoute(url)
  if (!route) return url
  return (
    routeToUrl(route, {
      hostname: options?.origin,
      originHomeId: options?.originHomeId,
    }) || url
  )
}
