import {type HMBlockNode, type HMDocument, unpackHmId} from '@seed-hypermedia/client/hm-types'
import {DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'

/** Result of planning embed cleanup for a deleted document. */
export type DocumentCardCleanupPlan = {
  changes: DocumentChange[]
  removedBlockIds: string[]
}

export type DocumentCardCleanupOptions = {
  targetBlockId?: string
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

function isMatchingDeletedDocumentEmbed(
  node: HMBlockNode,
  deletedDocumentKey: string,
  options: DocumentCardCleanupOptions = {},
) {
  const block = node.block
  if (block?.type !== 'Embed') return false
  if (options.targetBlockId && block.id !== options.targetBlockId) return false
  if (!block.link) return false
  return hmDocumentKey(block.link) === deletedDocumentKey
}

function collectRemovedBlockIds(
  nodes: HMBlockNode[],
  deletedDocumentKey: string,
  options: DocumentCardCleanupOptions,
): string[] {
  return nodes.flatMap((node) => [
    ...(isMatchingDeletedDocumentEmbed(node, deletedDocumentKey, options) ? [node.block.id] : []),
    ...collectRemovedBlockIds(node.children || [], deletedDocumentKey, options),
  ])
}

function expandFinalSiblings(
  node: HMBlockNode,
  originalParentId: string,
  deletedDocumentKey: string,
  options: DocumentCardCleanupOptions,
): FinalSiblingEntry[] {
  if (!isMatchingDeletedDocumentEmbed(node, deletedDocumentKey, options)) return [{node, originalParentId}]
  return (node.children || []).flatMap((child) =>
    expandFinalSiblings(child, node.block.id, deletedDocumentKey, options),
  )
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
  options: DocumentCardCleanupOptions,
) {
  const finalSiblings = nodes.flatMap((node) => expandFinalSiblings(node, parentBlockId, deletedDocumentKey, options))

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
      appendCleanupForSiblings(
        entry.node.children,
        entry.node.block.id,
        deletedDocumentKey,
        removedBlockIds,
        moves,
        options,
      )
    }
  })
}

/** Plans pure document changes that remove document embeds pointing at a deleted document. */
export function planDeletedDocumentCardEmbedCleanup(
  document: Pick<HMDocument, 'content'>,
  deletedDocumentId: string,
  options: DocumentCardCleanupOptions = {},
): DocumentCardCleanupPlan {
  const deletedDocumentKey = hmDocumentKey(deletedDocumentId)
  if (!deletedDocumentKey) return {changes: [], removedBlockIds: []}

  const removedBlockIds = collectRemovedBlockIds(document.content || [], deletedDocumentKey, options)
  if (!removedBlockIds.length) return {changes: [], removedBlockIds: []}

  const moves: PlannedMove[] = []
  appendCleanupForSiblings(document.content || [], '', deletedDocumentKey, new Set(removedBlockIds), moves, options)

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
