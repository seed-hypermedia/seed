/**
 * Hooks for reading a site's installed extensions from its home document.
 */

import {parseExtensionInstalls, resolveExtensionMount, type ExtensionMount} from '@seed-hypermedia/client/extensions'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useMemo} from 'react'

function useSiteHomeDocument(siteUid: string | null | undefined): HMDocument | null {
  const resource = useResource(siteUid ? hmId(siteUid) : null, {subscribed: true})
  return resource.data?.type === 'document' ? resource.data.document : null
}

/**
 * All extension mounts installed on `siteUid`, sorted by mount path. Filter
 * on `record.nav !== false` for navigation.
 */
export function useSiteExtensionMounts(siteUid: string | null | undefined): ExtensionMount[] {
  const home = useSiteHomeDocument(siteUid)
  const metadata = home?.metadata
  return useMemo(() => (metadata ? parseExtensionInstalls(metadata) : []), [metadata])
}

/** Mounts that should appear in site navigation. */
export function navExtensionMounts(mounts: ExtensionMount[]): ExtensionMount[] {
  return mounts.filter((m) => m.record.nav !== false)
}

/**
 * The extension mounted at (or above) `docId.path` on `docId.uid`, or null.
 * Loads the site home document; returns null while it loads.
 */
export function useResolvedExtensionMount(
  docId: UnpackedHypermediaId | null | undefined,
): (ExtensionMount & {subPath: string[]}) | null {
  const home = useSiteHomeDocument(docId?.uid)
  const metadata = home?.metadata
  const pathKey = docId?.path?.join('/') ?? ''
  return useMemo(
    () => (metadata && docId ? resolveExtensionMount(metadata, docId.path) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metadata, docId?.uid, pathKey],
  )
}
