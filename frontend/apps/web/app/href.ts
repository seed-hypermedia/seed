import {serializeBlockRange, UnpackedHypermediaId} from '@shm/shared'

export function getHref(
  homeId: UnpackedHypermediaId | null | undefined,
  id: UnpackedHypermediaId,
  version?: string,
) {
  const path = `/${(id.path || []).join('/')}`
  const fragment = id.blockRef
    ? `#${id.blockRef}${serializeBlockRange(id.blockRange)}`
    : ''
  let urlWithoutHost = `/hm/${id.uid}${path}${
    version ? `?v=${version}` : ''
  }${fragment}`
  if (homeId && homeId.uid === id.uid)
    urlWithoutHost = `${path}${version ? `?v=${version}` : ''}${fragment}`
  if (id.hostname) {
    return `${id.hostname}${urlWithoutHost}`
  }
  return urlWithoutHost
}
