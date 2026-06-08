/**
 * IPFS-backed image upload for the web editor.
 *
 * Mirrors the comment-editor's flow (`commenting.tsx:449`): chunk the file
 * with UnixFS, publish blobs via `client.publish`, return the root CID. The
 * editor's `fileUpload` prop expects a string CID for `ipfs://CID` links.
 */

import {filesToIpfsBlobs} from '@seed-hypermedia/client'
import type {UniversalClient} from '@shm/shared/universal-client'

/**
 * Build a `fileUpload(file)` function compatible with the editor's prop.
 * Returns the root CID of the uploaded file.
 */
export function makeWebFileUpload(client: UniversalClient): (file: File) => Promise<string> {
  return async (file: File) => {
    const buffer = await file.arrayBuffer()
    const {resultCIDs, blobs} = await filesToIpfsBlobs([new Uint8Array(buffer)])
    if (!blobs.length || !resultCIDs[0]) {
      throw new Error('IPFS chunking produced no blobs')
    }
    await client.publish({blobs: blobs.map((b) => ({cid: b.cid, data: b.data}))})
    return resultCIDs[0]
  }
}

/** Download a remote web file through the same-origin web proxy. */
export async function fetchWebImportBlob(url: string): Promise<{blob: Blob; type: string; size: number}> {
  const res = await fetch(`/hm/api/web-file?url=${encodeURIComponent(url)}`)

  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`)
  }

  const type = res.headers.get('content-type') || 'application/octet-stream'
  const blob = await res.blob()

  return {
    blob,
    type,
    size: blob.size,
  }
}

/**
 * Build an importWebFile function for the web document editor.
 * Remote bytes are fetched server-side to avoid browser CORS, then published to IPFS.
 */
export function makeWebImportWebFile(
  client: UniversalClient,
): (url: string) => Promise<{cid: string; type: string; size: number}> {
  const fileUpload = makeWebFileUpload(client)
  return async (url: string) => {
    const {blob, type, size} = await fetchWebImportBlob(url)
    const file = new File([blob], filenameFromUrl(url), {type})
    const cid = await fileUpload(file)
    return {cid, type, size}
  }
}

function filenameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname
    const name = pathname.split('/').filter(Boolean).pop()
    return name || `imported-file-${Date.now()}`
  } catch {
    return `imported-file-${Date.now()}`
  }
}
