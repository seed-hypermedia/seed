import {PlainMessage, Timestamp} from '@bufbuild/protobuf'
import {
  HMBlockNode,
  HMDocument,
  HMDocumentListItem,
  HMMetadata,
} from './hm-types'
import {UnpackedHypermediaId, unpackHmId} from './utils'

// HMBlockNodes are recursive values. we want the output to have the same shape, but limit the total number of blocks
// the first blocks will be included up until the totalBlock value is reached
export function clipContentBlocks(
  content: HMBlockNode[] | undefined,
  totalBlocks: number,
): HMBlockNode[] | null {
  if (!content) return null
  const output: HMBlockNode[] = []
  let blocksRemaining: number = totalBlocks
  function walk(currentNode: HMBlockNode, outputNode: HMBlockNode[]): void {
    if (blocksRemaining <= 0) {
      return
    }
    let newNode: HMBlockNode = {
      block: currentNode.block,
      children: currentNode.children ? [] : undefined,
    }
    outputNode.push(newNode)
    blocksRemaining--
    if (currentNode.children && newNode.children) {
      for (let child of currentNode.children) {
        walk(child, newNode.children)
      }
    }
  }
  for (let root of content) {
    walk(root, output)
  }
  return output
}

export function getDocumentTitle(document?: HMDocument | null) {
  if (!document) {
    return null
  }

  return document.metadata?.name || document.account! + document.path!
}

export function getMetadataName(metadata?: HMDocument['metadata'] | null) {
  return metadata?.name || 'Untitled Document'
}

export function getAccountName(profile: HMDocument | null | undefined) {
  return profile?.metadata?.name || profile?.account
}

export function sortNewsEntries(
  items: HMDocumentListItem[] | undefined,
  sort: HMMetadata['seedExperimentalHomeOrder'],
) {
  if (!items) return []
  if (sort === 'CreatedFirst') {
    return [...items].sort(createTimeSort)
  }
  return [...items].sort(lastUpdateSort)
}

function lastUpdateSort(
  a: {updateTime?: PlainMessage<Timestamp>},
  b: {updateTime?: PlainMessage<Timestamp>},
) {
  return lastUpdateOfEntry(b) - lastUpdateOfEntry(a)
}

function lastUpdateOfEntry(entry: {updateTime?: PlainMessage<Timestamp>}) {
  return entry.updateTime?.seconds ? Number(entry.updateTime?.seconds) : 0
}

function createTimeSort(
  a: {createTime?: PlainMessage<Timestamp>},
  b: {createTime?: PlainMessage<Timestamp>},
) {
  return createTimeOfEntry(b) - createTimeOfEntry(a)
}

function createTimeOfEntry(entry: {createTime?: PlainMessage<Timestamp>}) {
  return entry.createTime?.seconds ? Number(entry.createTime?.seconds) : 0
}

export type RefDefinition = {
  blockId: string
  link: string
  refId: UnpackedHypermediaId
}

export function extractRefs(
  children: HMBlockNode[],
  skipCards?: boolean,
): RefDefinition[] {
  let refs: RefDefinition[] = []
  function extractRefsFromBlock(block: HMBlockNode) {
    if (block.block?.type === 'Embed' && block.block.link) {
      if (block.block.attributes?.view === 'Card' && skipCards) return
      const refId = unpackHmId(block.block.link)
      if (refId)
        refs.push({
          blockId: block.block.id,
          link: block.block.link,
          refId,
        })
    }
    if (block.children) {
      block.children.forEach(extractRefsFromBlock)
    }
  }
  children.forEach(extractRefsFromBlock)
  return refs
}
