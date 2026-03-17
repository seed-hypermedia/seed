/**
 * Resolve file:// links in HMBlockNode trees (CLI wrapper).
 *
 * Thin wrapper around the shared resolveFileLinksInBlocks from
 * @seed-hypermedia/client, providing Node.js fs.readFileSync as
 * the file reader.
 */

import {readFileSync} from 'fs'
import {resolveFileLinksInBlocks, hasFileLinks} from '@seed-hypermedia/client'
import type {CollectedBlob} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

export type {CollectedBlob}
export {hasFileLinks}

/**
 * Resolve all file:// links in a block tree using Node.js fs.
 *
 * Reads local files, chunks them into UnixFS IPFS blocks, and replaces
 * file:// links with ipfs://CID. Returns the modified tree and the
 * collected blobs so they can be published alongside the document.
 */
export async function resolveFileLinks(nodes: HMBlockNode[]): Promise<{
  nodes: HMBlockNode[]
  blobs: CollectedBlob[]
}> {
  return resolveFileLinksInBlocks(nodes, (path) => readFileSync(path))
}
