import {PlainMessage} from '@bufbuild/protobuf'
import {Contact} from './client'
import {
  HMAnnotation,
  HMBlock,
  HMBlockChildrenType,
  HMBlockImage,
  HMBlockNode,
  HMBlockQuery,
  HMDocument,
  HMDocumentInfo,
  HMMetadata,
} from './hm-types'
import {entityQueryPathToHmIdPath, normalizeDate, unpackHmId} from './utils'

// Check if a block has meaningful content
export function hasBlockContent(block: HMBlockNode): boolean {
  const blockData = block.block

  // Check for children first
  if (block.children && block.children.length > 0) {
    return true
  }

  // Check based on block type
  switch (blockData.type) {
    case 'Paragraph':
    case 'Heading':
    case 'Code':
    case 'Math':
      // Text-based blocks: check if text is not empty
      return !!blockData.text && blockData.text.trim().length > 0

    case 'Image':
    case 'Video':
    case 'File':
    case 'Button':
    case 'Embed':
    case 'WebEmbed':
    case 'Nostr':
      // Link-based blocks: these always have content if they have a link
      return !!blockData.link

    case 'Query':
      // Query blocks always have content
      return true

    case 'Group':
    case 'Link':
      // Group and Link blocks are structural, check text if available
      return !!(
        'text' in blockData &&
        blockData.text &&
        blockData.text.trim().length > 0
      )

    default:
      return false
  }
}

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

  return (
    document.metadata?.name ||
    entityQueryPathToHmIdPath(document.path)?.at(-1) ||
    ''
  )
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

function lastUpdateSort(a: HMDocumentInfo, b: HMDocumentInfo) {
  return lastUpdateOfEntry(b) - lastUpdateOfEntry(a)
}

function lastUpdateOfEntry(entry: HMDocumentInfo) {
  return normalizeDate(entry.updateTime)?.getTime() || 0
}

function createTimeSort(a: HMDocumentInfo, b: HMDocumentInfo) {
  return createTimeOfEntry(b) - createTimeOfEntry(a)
}

function createTimeOfEntry(entry: HMDocumentInfo) {
  return normalizeDate(entry.createTime)?.getTime() || 0
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
  return normalizeDate(entry.updateTime)?.getTime() || 0
}

function titleOfEntry(entry: HMDocumentInfo) {
  return entry.metadata.name
}

function titleSort(ea: HMDocumentInfo, eb: HMDocumentInfo) {
  const a = titleOfEntry(ea) || ''
  const b = titleOfEntry(eb) || ''
  return a.localeCompare(b, undefined, {sensitivity: 'base'})
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

  const sortTerm = sort?.[0]?.term

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

  return sort?.[0]?.reverse ? [...res].reverse() : res
}

export type RefDefinition = {
  blockId: string
  link: string
  refId: any
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
    // @ts-expect-error
    ;(block.block as any).annotations?.forEach((annotation) => {
      if (annotation.type === 'Embed') {
        refs.push({
          blockId: block.block.id,
          link: annotation.link,
          refId: unpackHmId(annotation.link),
        })
      }
    })
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
    if ((bn.block as any)?.text) {
      textContent += (bn.block as any)?.text + ' '
    }
  })
  return textContent
}

export function getDocumentImage(document: HMDocument): string | null {
  const coverImage = document.metadata.cover
  if (coverImage) return coverImage
  const firstImageBlock = findFirstBlock<HMBlockImage>(
    document.content,
    (block): block is HMBlockImage =>
      block.type === 'Image' && !!(block as any).link,
  )
  if (firstImageBlock) return firstImageBlock.link || null
  return null
}

export function findFirstBlock<ResultBlockType extends HMBlock>(
  content: HMBlockNode[],
  test: (block: HMBlock) => block is ResultBlockType,
): ResultBlockType | null {
  let found: ResultBlockType | null = null
  let index = 0
  while (!found && index < content.length) {
    const blockNode = content[index]
    // @ts-ignore
    if (test(blockNode.block)) {
      // @ts-ignore
      found = blockNode.block
      break
    }
    const foundChild =
      // @ts-ignore
      blockNode.children && findFirstBlock(blockNode.children, test)
    if (foundChild) {
      found = foundChild
      break
    }
    index++
  }
  return found
}

export function getChildrenType(
  block: HMBlock | undefined | null,
): HMBlockChildrenType | undefined {
  if (!block) return undefined
  if (block.type === 'Paragraph') return block.attributes?.childrenType
  if (block.type === 'Heading') return block.attributes?.childrenType
  if (block.type === 'Embed') return block.attributes?.childrenType
  if (block.type === 'Video') return block.attributes?.childrenType
  if (block.type === 'File') return block.attributes?.childrenType
  if (block.type === 'Image') return block.attributes?.childrenType
  if (block.type === 'Query') return block.attributes?.childrenType
  if (block.type === 'Math') return block.attributes?.childrenType
  if (block.type === 'Code') return block.attributes?.childrenType
  if (block.type === 'Button') return block.attributes?.childrenType
  return undefined
}

export function getAnnotations(block: HMBlock): HMAnnotation[] | undefined {
  if (block.type === 'Embed') return block.annotations || []
  if (block.type === 'Video') return block.annotations || []
  if (block.type === 'File') return block.annotations || []
  if (block.type === 'Image') return block.annotations || []
  if (block.type === 'Query') return block.annotations || []
  if (block.type === 'Math') return block.annotations || []
  if (block.type === 'Code') return block.annotations || []
  if (block.type === 'Button') return block.annotations || []
  return undefined
}
