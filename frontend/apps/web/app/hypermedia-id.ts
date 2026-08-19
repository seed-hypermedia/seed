import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {extractViewTermFromUrl, hmId, viewTermToRouteKey} from '@shm/shared'

export type RequestResourceIds = {
  // The daemon resource to resolve/load. For profile URLs this stays the
  // account root document because `:profile` is a view term, not a document path.
  loadResourceId: UnpackedHypermediaId
  // The public resource ID to expose in HTML meta tags and OPTIONS headers.
  // Usually identical to loadResourceId; profile URLs include the profile view term.
  publicMetadataId: UnpackedHypermediaId
}

function stripInspectPrefix(pathParts: string[]): string[] {
  if (pathParts[0] === 'hm' && pathParts[1] === 'inspect') {
    return ['hm', ...pathParts.slice(2)]
  }
  if (pathParts[0] === 'inspect') {
    return pathParts.slice(1)
  }
  return pathParts
}

export function getRequestResourceIds(url: URL, originAccountId: string | undefined): RequestResourceIds | null {
  const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(url.toString())
  const effectivePathParts = stripInspectPrefix(new URL(cleanUrl).pathname.split('/').filter(Boolean))
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === '' || !version

  let uid = originAccountId
  let path = effectivePathParts
  if (effectivePathParts[0] === 'hm') {
    uid = effectivePathParts[1]
    path = effectivePathParts.slice(2)
  }
  if (!uid) return null

  if (viewTermToRouteKey(viewTerm) === 'profile') {
    const resourceId = hmId(accountUid || uid, {version, latest})
    return {
      loadResourceId: resourceId,
      publicMetadataId: {...resourceId, id: `${resourceId.id}/:profile`},
    }
  }

  const resourceId = hmId(uid, {path, version, latest})
  return {loadResourceId: resourceId, publicMetadataId: resourceId}
}
