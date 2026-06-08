import {
  extractInspectIpfsPathFromPath,
  extractInspectPrefixFromPath,
  extractViewTermFromPath,
  getDocumentRouteLoaderDeps,
} from './document-route-path'

/** Describes the current URL using the framework-neutral document route helpers. */
export function describeDocumentRoute(splat: string, href: string) {
  const url = new URL(href)
  const pathParts = splat.split('/').filter(Boolean)
  const gatewayInspectIpfsPath = pathParts[0] === 'hm' ? extractInspectIpfsPathFromPath(pathParts, true) : null
  const siteInspectIpfsPath = gatewayInspectIpfsPath ? null : extractInspectIpfsPathFromPath(pathParts, false)
  const inspectIpfsPath = gatewayInspectIpfsPath || siteInspectIpfsPath
  const isGatewayDocument = pathParts[0] === 'hm' && pathParts.length > 1
  const inspectResult = extractInspectPrefixFromPath(pathParts, isGatewayDocument)
  const documentPathParts = isGatewayDocument ? inspectResult.pathParts.slice(1) : inspectResult.pathParts
  const view = inspectIpfsPath ? null : extractViewTermFromPath(documentPathParts)

  return {
    runtime: 'bun',
    router: 'tanstack-router',
    pathname: url.pathname,
    splat,
    pathParts,
    loaderDeps: getDocumentRouteLoaderDeps(url),
    inspectIpfsPath,
    isGatewayDocument,
    isInspect: inspectResult.isInspect,
    documentUid: isGatewayDocument ? inspectResult.pathParts[0] : null,
    documentPath: view?.path ?? documentPathParts,
    viewTerm: view?.viewTerm ?? null,
    activityFilter: view?.activityFilter ?? null,
    openComment: view?.commentId ?? null,
    accountUid: view?.accountUid ?? null,
  }
}
