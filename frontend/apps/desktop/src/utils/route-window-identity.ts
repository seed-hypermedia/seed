import type {NavRoute} from '@shm/shared/routes'
import {getDraftIdFromDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {draftDocumentRouteId, type DraftRouteFields} from './draft-route'

/** Resolves bare draft routes using the loaded desktop draft index. */
export type WindowDraftLookup = (id: string) => DraftRouteFields | null | undefined

/** Resource aliases reserved by an active route; document versions share one window. */
export function getRouteWindowResourceKeys(route: NavRoute, getDraft: WindowDraftLookup = () => undefined): string[] {
  if (route.key === 'contacts' || route.key === 'settings' || route.key === 'api-inspector') {
    return [`route:${route.key}`]
  }
  if (
    route.key === 'document' ||
    route.key === 'metadata' ||
    route.key === 'comments' ||
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'site-profile' ||
    route.key === 'all-documents'
  ) {
    const draftId = getDraftIdFromDraftPathSegment(route.id.path?.at(-1))
    if (!draftId) return [`doc:${route.id.id}`]
    const draft = getDraft(draftId)
    const editedDocument = draft?.editUid ? draftDocumentRouteId(draft) : undefined
    return editedDocument ? [`draft:${draftId}`, `doc:${editedDocument.id}`] : [`draft:${draftId}`]
  }
  if (route.key !== 'draft') return []
  const resolved = draftDocumentRouteId(route) ?? draftDocumentRouteId(getDraft(route.id) ?? {id: route.id})
  if (!resolved) throw new Error(`Cannot resolve window identity for draft ${route.id}`)
  return Array.from(
    new Set([`draft:${route.id}`, ...getRouteWindowResourceKeys({key: 'document', id: resolved}, getDraft)]),
  )
}

/** Whether a route reserves a resource or singleton window. */
export function routeUsesWindowDedupe(route: NavRoute): boolean {
  return route.key === 'draft' || getRouteWindowResourceKeys(route).length > 0
}

/** Whether two routes reserve any of the same resource aliases. */
export function routesShareWindowResource(
  a: NavRoute,
  b: NavRoute,
  getDraft: WindowDraftLookup = () => undefined,
): boolean {
  const bKeys = getRouteWindowResourceKeys(b, getDraft)
  return getRouteWindowResourceKeys(a, getDraft).some((key) => bKeys.includes(key))
}
