import {PlainMessage, Timestamp} from '@bufbuild/protobuf'
import {Contact} from './client'
import {
  HMBlockNode,
  HMBlockQuery,
  HMDocument,
  HMDocumentInfo,
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
    return 'Error: document not found'
  }

  return document.metadata?.name || document.account! + document.path!
}

export function getContactMetadata(
  accountUid: string,
  metadata: HMDocument['metadata'] | null | undefined,
  contacts?: PlainMessage<Contact>[] | null,
) {
  const contact = contacts?.find((c) => c.subject === accountUid)
  if (contact) {
    return {...(metadata || {}), name: contact.name}
  }
  return {...(metadata || {}), name: metadata?.name || 'Untitled Contact'}
}

export function getMetadataName(metadata?: HMDocument['metadata'] | null) {
  return metadata?.name || 'Untitled Document'
}

export function getAccountName(document: HMDocument | null | undefined) {
  if (!document) return ''
  if (document.metadata.name) return document.metadata.name
  if (document.account) return `${document.account.slice(0, -6)}`
  return '?'
}

export function sortNewsEntries(
  items: HMDocumentInfo[] | undefined,
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

function displayPublishTimeSort(a: HMDocumentInfo, b: HMDocumentInfo) {
  return displayPublishTimeOfEntry(b) - displayPublishTimeOfEntry(a)
}

function displayPublishTimeOfEntry(entry: HMDocumentInfo): number {
  const dateStr = entry.metadata.displayPublishTime
  if (dateStr) {
    const timestamp = Date.parse(dateStr)
    if (!isNaN(timestamp)) return timestamp
  }

  return entry.updateTime?.seconds ? Number(entry.updateTime.seconds) * 1000 : 0
}

function titleOfEntry(entry: HMDocumentInfo) {
  return entry.metadata.name
}

function titleSort(ea: HMDocumentInfo, eb: HMDocumentInfo) {
  const a = titleOfEntry(ea)
  const b = titleOfEntry(eb)
  if (a < b) return 1
  if (a > b) return -1
  return 0
}

export function queryBlockSortedItems({
  entries,
  sort,
}: {
  entries: Array<HMDocumentInfo>
  sort: NonNullable<HMBlockQuery['attributes']['query']['sort']>
}) {
  let res: Array<HMDocumentInfo> = []
  if (!entries) return res

  if (sort.length !== 1) return res

  const sortTerm = sort[0].term

  if (sortTerm == 'Title') {
    res = [...entries].sort(titleSort)
  }

  if (sortTerm == 'CreateTime') {
    res = [...entries].sort(createTimeSort)
  }

  if (sortTerm == 'UpdateTime') {
    res = [...entries].sort(lastUpdateSort)
  }

  if (sortTerm === 'DisplayTime') {
    res = [...entries].sort(displayPublishTimeSort)
  }

  // if (sortTerm == 'Path') {
  //   // TODO
  //   return entries
  // }

  return sort[0].reverse ? [...res].reverse() : res
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

export function extractQueryBlocks(children: HMBlockNode[]): HMBlockQuery[] {
  let queries: HMBlockQuery[] = []
  function extractQueriesFromBlock(block: HMBlockNode) {
    if (block.block?.type === 'Query') {
      queries.push(block.block)
    }
    if (block.children) {
      block.children.forEach(extractQueriesFromBlock)
    }
  }
  children.forEach(extractQueriesFromBlock)
  return queries
}

export function plainTextOfContent(content?: HMBlockNode[]): string {
  let textContent = ''
  content?.forEach((bn) => {
    if (bn.block?.text) {
      textContent += bn.block?.text + ' '
    }
  })
  return textContent
}
