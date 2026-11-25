import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared/routes'
import {getDraftIdFromDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {draftDocumentRouteId, type DraftRouteFields} from './draft-route'

/** Route keys that never get a second window; reopening focuses the existing one. */
const SINGLE_INSTANCE_ROUTE_KEYS = new Set<NavRoute['key']>(['contacts', 'settings', 'api-inspector'])

/**
 * Whether a navigation should first check the other windows before opening the
 * route locally. Document and draft routes dedupe by the resource they display;
 * the singleton keys dedupe by route key alone.
 */
export function routeUsesWindowDedupe(route: NavRoute): boolean {
  return route.key === 'document' || route.key === 'draft' || SINGLE_INSTANCE_ROUTE_KEYS.has(route.key)
}

function addDocumentKey(keys: Set<string>, id: UnpackedHypermediaId) {
  const draftId = getDraftIdFromDraftPathSegment(id.path?.at(-1))
  // `id.id` is the version-independent hm://uid/path form: every version of a
  // document counts as the same open resource ("one document = one window").
  keys.add(draftId ? `draft:${draftId}` : `doc:${id.id}`)
}

/**
 * Identity keys a route occupies for duplicate-window checks. A `draft` route
 * owns both its draft id and the document route it redirects to (the published
 * document for edit drafts, the `-<id>` placeholder for location drafts), so it
 * still matches a window that already resolved the redirect. `getDraft` lets
 * the main process resolve bare draft routes against the draft index; callers
 * that cannot resolve drafts may omit it.
 */
export function getRouteWindowResourceKeys(
  route: NavRoute,
  getDraft?: (draftId: string) => DraftRouteFields | null | undefined,
): Set<string> | null {
  if (SINGLE_INSTANCE_ROUTE_KEYS.has(route.key)) return new Set([`route:${route.key}`])
  const keys = new Set<string>()
  if (route.key === 'document') {
    addDocumentKey(keys, route.id)
  } else if (route.key === 'draft') {
    keys.add(`draft:${route.id}`)
    const docId = draftDocumentRouteId(route) ?? draftDocumentRouteId(getDraft?.(route.id) ?? {id: route.id})
    if (docId) addDocumentKey(keys, docId)
  }
  return keys.size > 0 ? keys : null
}

/** True when two routes would claim the same window, i.e. their key sets intersect. */
export function routesShareWindowResource(
  a: NavRoute,
  b: NavRoute,
  getDraft?: (draftId: string) => DraftRouteFields | null | undefined,
): boolean {
  const aKeys = getRouteWindowResourceKeys(a, getDraft)
  const bKeys = getRouteWindowResourceKeys(b, getDraft)
  if (!aKeys || !bKeys) return false
  return Array.from(aKeys).some((key) => bKeys.has(key))
}
