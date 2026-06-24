import {type HMBlockNode, type HMDocument, unpackHmId} from '@seed-hypermedia/client/hm-types'
import {Block, DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'

/** Result of planning embed cleanup for a deleted document. */
export type DocumentCardCleanupPlan = {
  changes: DocumentChange[]
  removedBlockIds: string[]
}

/** Result of planning a document card append. */
export type DocumentCardAppendPlan = {
  changes: DocumentChange[]
  addedBlockIds: string[]
}

/** Result of planning a document card link rewrite. */
export type DocumentCardRewritePlan = {
  changes: DocumentChange[]
  rewrittenBlockIds: string[]
}

type PlannedMove = {
  blockId: string
  parent: string
  leftSibling: string
}

type FinalSiblingEntry = {
  node: HMBlockNode
  originalParentId: string
}

function hmDocumentKey(link: string) {
  const id = unpackHmId(link)
  if (!id?.uid) return null
  return `${id.uid}/${(id.path || []).join('/')}`
}

/** Returns true when an HM link points at the given document, ignoring version and block refs. */
export function hmLinkTargetsDocument(link: string, documentId: string) {
  const linkKey = hmDocumentKey(link)
  const documentKey = hmDocumentKey(documentId)
  return !!linkKey && linkKey === documentKey
}

function isMatchingDeletedDocumentEmbed(node: HMBlockNode, deletedDocumentKey: string) {
  const block = node.block
  if (block?.type !== 'Embed') return false
  if (!block.link) return false
  return hmDocumentKey(block.link) === deletedDocumentKey
}

function isEmbedLinkToDocument(node: HMBlockNode, documentKey: string) {
  const block = node.block
  if (block?.type !== 'Embed') return false
  if (!block.link) return false
  return hmDocumentKey(block.link) === documentKey
}

function documentContainsLinkToDocument(nodes: HMBlockNode[], documentKey: string): boolean {
  return nodes.some(
    (node) =>
      isEmbedLinkToDocument(node, documentKey) || documentContainsLinkToDocument(node.children || [], documentKey),
  )
}

function queryIncludeTargetsParent(include: any, parentUid: string, parentPath: string[]) {
  if (!include || include.space !== parentUid) return false
  const includePath = String(include.path || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
  return includePath.join('/') === parentPath.join('/')
}

function hasSelfQueryBlock(nodes: HMBlockNode[], parentDocumentId: string) {
  const parent = unpackHmId(parentDocumentId)
  if (!parent?.uid) return false
  const parentUid = parent.uid
  const parentPath = parent.path || []

  function walk(blocks: HMBlockNode[]): boolean {
    return blocks.some((node) => {
      const block = node.block
      const includes = block?.type === 'Query' ? (block.attributes as any)?.query?.includes : undefined
      if (
        Array.isArray(includes) &&
        includes.some((include) => queryIncludeTargetsParent(include, parentUid, parentPath))
      ) {
        return true
      }
      return walk(node.children || [])
    })
  }

  return walk(nodes)
}

function collectMatchingEmbeds(nodes: HMBlockNode[], documentKey: string): HMBlockNode[] {
  return nodes.flatMap((node) => [
    ...(isEmbedLinkToDocument(node, documentKey) ? [node] : []),
    ...collectMatchingEmbeds(node.children || [], documentKey),
  ])
}

function collectRemovedBlockIds(nodes: HMBlockNode[], deletedDocumentKey: string): string[] {
  return nodes.flatMap((node) => [
    ...(isMatchingDeletedDocumentEmbed(node, deletedDocumentKey) ? [node.block.id] : []),
    ...collectRemovedBlockIds(node.children || [], deletedDocumentKey),
  ])
}

function expandFinalSiblings(
  node: HMBlockNode,
  originalParentId: string,
  deletedDocumentKey: string,
): FinalSiblingEntry[] {
  if (!isMatchingDeletedDocumentEmbed(node, deletedDocumentKey)) return [{node, originalParentId}]
  return (node.children || []).flatMap((child) => expandFinalSiblings(child, node.block.id, deletedDocumentKey))
}

function finalLeftSibling(entries: FinalSiblingEntry[], index: number, removedBlockIds: Set<string>) {
  for (let i = index - 1; i >= 0; i--) {
    const blockId = entries[i]?.node.block.id
    if (blockId && !removedBlockIds.has(blockId)) return blockId
  }
  return ''
}

function appendCleanupForSiblings(
  nodes: HMBlockNode[],
  parentBlockId: string,
  deletedDocumentKey: string,
  removedBlockIds: Set<string>,
  moves: PlannedMove[],
) {
  const finalSiblings = nodes.flatMap((node) => expandFinalSiblings(node, parentBlockId, deletedDocumentKey))

  finalSiblings.forEach((entry, index) => {
    if (entry.originalParentId === parentBlockId) return
    moves.push({
      blockId: entry.node.block.id,
      parent: parentBlockId,
      leftSibling: finalLeftSibling(finalSiblings, index, removedBlockIds),
    })
  })

  finalSiblings.forEach((entry) => {
    if (entry.node.children?.length) {
      appendCleanupForSiblings(entry.node.children, entry.node.block.id, deletedDocumentKey, removedBlockIds, moves)
    }
  })
}

/** Plans pure document changes that remove document embeds pointing at a deleted document. */
export function planDeletedDocumentCardEmbedCleanup(
  document: Pick<HMDocument, 'content'>,
  deletedDocumentId: string,
): DocumentCardCleanupPlan {
  const deletedDocumentKey = hmDocumentKey(deletedDocumentId)
  if (!deletedDocumentKey) return {changes: [], removedBlockIds: []}

  const removedBlockIds = collectRemovedBlockIds(document.content || [], deletedDocumentKey)
  if (!removedBlockIds.length) return {changes: [], removedBlockIds: []}

  const moves: PlannedMove[] = []
  appendCleanupForSiblings(document.content || [], '', deletedDocumentKey, new Set(removedBlockIds), moves)

  const changes = [
    ...moves.map(
      (move) =>
        new DocumentChange({
          op: {
            case: 'moveBlock',
            value: move,
          },
        }),
    ),
    ...removedBlockIds.map(
      (blockId) =>
        new DocumentChange({
          op: {
            case: 'deleteBlock',
            value: blockId,
          },
        }),
    ),
  ]

  return {changes, removedBlockIds}
}

/** Alias for planning deleted document embed removal changes. */
export const planDocumentCardRemoval = planDeletedDocumentCardEmbedCleanup

/** Plans pure document changes that append a Card embed for a child document to a parent document. */
export function planDocumentCardAppend(
  document: Pick<HMDocument, 'content'>,
  parentDocumentId: string,
  childDocumentId: string,
  newBlockId: string,
): DocumentCardAppendPlan {
  const childDocumentKey = hmDocumentKey(childDocumentId)
  if (!childDocumentKey || !newBlockId) return {changes: [], addedBlockIds: []}
  const content = document.content || []
  if (hasSelfQueryBlock(content, parentDocumentId)) return {changes: [], addedBlockIds: []}
  if (documentContainsLinkToDocument(content, childDocumentKey)) return {changes: [], addedBlockIds: []}

  const lastBlockId = content.at(-1)?.block?.id || ''
  const embedBlock = Block.fromJson({
    id: newBlockId,
    type: 'Embed',
    link: childDocumentId,
    attributes: {view: 'Card'},
  })

  return {
    changes: [
      new DocumentChange({
        op: {case: 'moveBlock', value: {blockId: newBlockId, parent: '', leftSibling: lastBlockId}},
      }),
      new DocumentChange({
        op: {case: 'replaceBlock', value: embedBlock},
      }),
    ],
    addedBlockIds: [newBlockId],
  }
}

/** Plans pure document changes that rewrite existing embed links from one document id to another. */
export function planDocumentCardRewrite(
  document: Pick<HMDocument, 'content'>,
  fromDocumentId: string,
  toDocumentId: string,
): DocumentCardRewritePlan {
  const fromDocumentKey = hmDocumentKey(fromDocumentId)
  const toDocumentKey = hmDocumentKey(toDocumentId)
  if (!fromDocumentKey || !toDocumentKey || fromDocumentKey === toDocumentKey) {
    return {changes: [], rewrittenBlockIds: []}
  }

  const content = document.content || []
  if (documentContainsLinkToDocument(content, toDocumentKey)) return {changes: [], rewrittenBlockIds: []}

  const matchingEmbeds = collectMatchingEmbeds(content, fromDocumentKey)
  if (!matchingEmbeds.length) return {changes: [], rewrittenBlockIds: []}

  return {
    changes: matchingEmbeds.map((node) => {
      return new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: Block.fromJson({
            ...(node.block as any),
            link: toDocumentId,
          }),
        },
      })
    }),
    rewrittenBlockIds: matchingEmbeds.map((node) => node.block.id),
  }
}
