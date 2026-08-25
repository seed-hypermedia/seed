import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createDocumentNavRoute, createWebHMUrl, routeToUrl, ViewRouteKey} from '@shm/shared'

export type RedirectRouteContext = {
  viewTerm?: ViewRouteKey | null
  panelParam?: string | null
  openComment?: string | null
  accountUid?: string | null
}

/**
 * Builds the destination URL for a moved/redirected resource. The request's
 * route context (view term, open comment, panel) is rebuilt on the redirect
 * target so deep links survive document moves.
 */
export function createResourceRedirectUrl(
  target: UnpackedHypermediaId,
  routeContext: RedirectRouteContext,
  originHomeId?: UnpackedHypermediaId,
): string {
  const route = createDocumentNavRoute(
    target,
    routeContext.viewTerm,
    routeContext.panelParam,
    routeContext.openComment,
    routeContext.accountUid,
  )
  return (
    routeToUrl(route, {hostname: null, originHomeId}) ??
    createWebHMUrl(target.uid, {path: target.path, originHomeId, hostname: null})
  )
}
