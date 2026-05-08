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
