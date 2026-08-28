import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

// Builds the UnpackedHypermediaId for an account's home document (hm://<uid>),
// or a document under it when a path is given.
export function hmId(uid: string, path: string[] = []): UnpackedHypermediaId {
  const restPath = path.length ? `/${path.join('/')}` : ''
  return {
    id: `hm://${uid}${restPath}`,
    uid,
    path,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
    latest: true,
  }
}
