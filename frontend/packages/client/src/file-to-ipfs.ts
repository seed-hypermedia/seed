/**
 * Shared IPFS file chunking utilities.
 *
 * Chunks binary data into UnixFS IPFS blocks using a MemoryBlockstore.
 * Used by both the CLI (file:// link resolution) and the web app
 * (comment attachment uploads) so the logic is not duplicated.
 */

import {MemoryBlockstore} from 'blockstore-core/memory'
import {importer as unixFSImporter} from 'ipfs-unixfs-importer'
import type {HMBlockNode} from './hm-types'

export type CollectedBlob = {
  cid: string
  data: Uint8Array
}

/**
 * Chunk a single piece of binary data into UnixFS IPFS blocks.
 *
 * Returns the root CID and all constituent IPFS blobs (DAG blocks)
 * that should be published alongside the document/comment.
 */
export async function fileToIpfsBlobs(data: Uint8Array): Promise<{
  cid: string
  blobs: CollectedBlob[]
}> {
  const blockstore = new MemoryBlockstore()
  const results = unixFSImporter([{content: data}], blockstore)
  const result = await results.next()
  if (!result.value) {
    throw new Error('Failed to chunk file into IPFS blocks')
  }

  const rootCid = result.value.cid.toString()
  const blobs: CollectedBlob[] = []
  for await (const pair of blockstore.getAll()) {
    blobs.push({
      cid: pair.cid.toString(),
      data: pair.block,
    })
  }

  return {cid: rootCid, blobs}
}

/**
 * Chunk multiple binary attachments into IPFS blocks using a shared blockstore.
 *
 * Returns the root CIDs (one per input) and all collected IPFS blobs.
 * This is the multi-file equivalent of `fileToIpfsBlobs`, suitable for
 * comment editors that upload several images at once.
 */
export async function filesToIpfsBlobs(binaries: Uint8Array[]): Promise<{
  resultCIDs: string[]
  blobs: CollectedBlob[]
}> {
  const blockstore = new MemoryBlockstore()
  const resultCIDs: string[] = []

  for (const binary of binaries) {
    const results = unixFSImporter([{content: binary}], blockstore)
    const result = await results.next()
    if (!result.value) {
      throw new Error('Failed to chunk file into IPFS blocks')
    }
    resultCIDs.push(result.value.cid.toString())
  }

  const blobs: CollectedBlob[] = []
  for await (const pair of blockstore.getAll()) {
    blobs.push({
      cid: pair.cid.toString(),
      data: pair.block,
    })
  }

  return {resultCIDs, blobs}
}

// ── file:// link resolution in block trees ──────────────────────────────────

const FILE_PROTOCOL = 'file://'

/**
 * Extract the link field from a block if it exists and is a string.
 * Handles the discriminated union where not all block types have `link`.
 */
function getBlockLink(block: HMBlockNode['block']): string | undefined {
  const b = block as Record<string, unknown>
  return typeof b.link === 'string' ? b.link : undefined
}

/**
 * Set the link field on a block. Creates a shallow copy with the new link.
 */
function setBlockLink(block: HMBlockNode['block'], link: string): HMBlockNode['block'] {
  return {...block, link} as HMBlockNode['block']
}

/**
 * Resolve all file:// links in a block tree.
 *
 * Walks the tree, finds blocks whose `link` field starts with `file://`,
 * reads the data via the provided `readFile` callback, chunks with UnixFS,
 * and replaces the link with `ipfs://ROOT_CID`.
 *
 * The `readFile` callback allows this to work in both Node.js (fs.readFileSync)
 * and browser environments without importing `fs` directly.
 *
 * @returns The modified block tree and all collected IPFS blobs.
 */
export async function resolveFileLinksInBlocks(
  nodes: HMBlockNode[],
  readFile: (path: string) => Uint8Array | Promise<Uint8Array>,
): Promise<{
  nodes: HMBlockNode[]
  blobs: CollectedBlob[]
}> {
  const blockstore = new MemoryBlockstore()
  const cidMap = new Map<string, string>() // filePath -> ipfs://CID

  const resolved = await resolveNodes(nodes, blockstore, cidMap, readFile)

  // Collect all blocks from the blockstore
  const blobs: CollectedBlob[] = []
  for await (const pair of blockstore.getAll()) {
    blobs.push({
      cid: pair.cid.toString(),
      data: pair.block,
    })
  }

  return {nodes: resolved, blobs}
}

async function resolveNodes(
  nodes: HMBlockNode[],
  blockstore: MemoryBlockstore,
  cidMap: Map<string, string>,
  readFile: (path: string) => Uint8Array | Promise<Uint8Array>,
): Promise<HMBlockNode[]> {
  const result: HMBlockNode[] = []
  for (const node of nodes) {
    let resolvedBlock = node.block
    const link = getBlockLink(resolvedBlock)

    // Resolve file:// link if present
    if (link && link.startsWith(FILE_PROTOCOL)) {
      const filePath = link.slice(FILE_PROTOCOL.length)
      const ipfsUrl = await resolveFileToCid(filePath, blockstore, cidMap, readFile)
      resolvedBlock = setBlockLink(resolvedBlock, ipfsUrl)
    }

    // Recurse into children
    const resolvedChildren = node.children ? await resolveNodes(node.children, blockstore, cidMap, readFile) : undefined

    result.push({block: resolvedBlock, children: resolvedChildren})
  }
  return result
}

async function resolveFileToCid(
  filePath: string,
  blockstore: MemoryBlockstore,
  cidMap: Map<string, string>,
  readFile: (path: string) => Uint8Array | Promise<Uint8Array>,
): Promise<string> {
  // Return cached CID if we already processed this file
  const cached = cidMap.get(filePath)
  if (cached) return cached

  // Read the file via the provided callback
  const data = await readFile(filePath)

  // Import into UnixFS (produces DAG blocks in the blockstore)
  const results = unixFSImporter([{content: data}], blockstore)
  const result = await results.next()
  if (!result.value) {
    throw new Error(`Failed to process file for IPFS: ${filePath}`)
  }

  const ipfsUrl = `ipfs://${result.value.cid.toString()}`
  cidMap.set(filePath, ipfsUrl)
  return ipfsUrl
}

/**
 * Check whether any block in the tree has a file:// link.
 */
export function hasFileLinks(nodes: HMBlockNode[]): boolean {
  for (const node of nodes) {
    const link = getBlockLink(node.block)
    if (link && link.startsWith(FILE_PROTOCOL)) {
      return true
    }
    if (node.children && hasFileLinks(node.children)) {
      return true
    }
  }
  return false
}
