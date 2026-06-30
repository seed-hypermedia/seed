import {
  type HMBlockNode,
  type HMDocument,
  type UnpackedHypermediaId,
  unpackHmId,
} from '@seed-hypermedia/client/hm-types'
import {Block, DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'

/** Result of planning embed cleanup for a deleted document. */
export type DocumentCardCleanupPlan = {
  changes: DocumentChange[]
  removedBlockIds: string[]
}

/** Options for planning document card cleanup. */
export type DocumentCardCleanupOptions = {
  targetBlockId?: string
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

/** Operation needed to keep document cards accurate after a document move. */
export type DocumentCardMoveCleanupOperation =
  | {
      operation: 'remove'
      parentDocumentId: string
      sourceDocumentId: string
    }
  | {
      operation: 'add'
      parentDocumentId: string
      targetDocumentId: string
    }
  | {
      operation: 'rewrite'
      parentDocumentId: string
      sourceDocumentId: string
      targetDocumentId: string
    }

/** Input for applying a card cleanup operation to draft block-node content. */
export type DocumentCardCleanupOperationInput =
  | {
      operation: 'remove'
      sourceDocumentId?: string
      deletedDocumentId?: string
    }
  | {
      operation: 'add'
      parentDocumentId: string
      targetDocumentId: string
      newBlockId: string
    }
  | {
      operation: 'rewrite'
      sourceDocumentId: string
      targetDocumentId: string
    }

/** Result of applying a card cleanup operation to draft block-node content. */
export type DocumentCardCleanupContentResult = {
  content: HMBlockNode[]
  changedBlockIds: string[]
}

function documentIdForPath(uid: string, path: string[]) {
  return `hm://${uid}${path.length ? `/${path.join('/')}` : ''}`
}

function getMoveParentId(id: Pick<UnpackedHypermediaId, 'uid' | 'path'>) {
  const path = id.path || []
  if (!path.length) return null
  return documentIdForPath(id.uid, path.slice(0, -1))
}

/** Plans card cleanup operations needed after a document moves from one path to another. */
export function planDocumentCardMoveOperations(
  from: Pick<UnpackedHypermediaId, 'uid' | 'path' | 'id'>,
  to: Pick<UnpackedHypermediaId, 'uid' | 'path' | 'id'>,
): DocumentCardMoveCleanupOperation[] {
  const oldParentId = getMoveParentId(from)
  const newParentId = getMoveParentId(to)
  if (!oldParentId || !newParentId) return []

  if (oldParentId === newParentId) {
    return [
      {
        operation: 'rewrite',
        parentDocumentId: oldParentId,
        sourceDocumentId: from.id,
        targetDocumentId: to.id,
      },
    ]
  }

  return [
    {
      operation: 'remove',
      parentDocumentId: oldParentId,
      sourceDocumentId: from.id,
    },
    {
      operation: 'add',
      parentDocumentId: newParentId,
      targetDocumentId: to.id,
    },
  ]
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

/** Applies a document card cleanup operation directly to draft block-node content. */
export function applyDocumentCardCleanupToBlockNodes(
  content: HMBlockNode[],
  input: DocumentCardCleanupOperationInput,
): DocumentCardCleanupContentResult {
  if (input.operation === 'remove') {
    const sourceDocumentId = input.sourceDocumentId || input.deletedDocumentId
    const sourceDocumentKey = sourceDocumentId ? hmDocumentKey(sourceDocumentId) : null
    if (!sourceDocumentKey) return {content, changedBlockIds: []}

    const changedBlockIds: string[] = []
    const removeMatching = (nodes: HMBlockNode[]): HMBlockNode[] => {
      return nodes.flatMap((node) => {
        if (isEmbedLinkToDocument(node, sourceDocumentKey)) {
          if (node.block.id) changedBlockIds.push(node.block.id)
          return removeMatching(node.children || [])
        }
        return [{...node, children: removeMatching(node.children || [])}]
      })
    }

    return {content: removeMatching(content), changedBlockIds}
  }

  if (input.operation === 'add') {
    const targetDocumentKey = hmDocumentKey(input.targetDocumentId)
    if (!targetDocumentKey || !input.newBlockId) return {content, changedBlockIds: []}
    if (hasSelfQueryBlock(content, input.parentDocumentId)) return {content, changedBlockIds: []}
    if (documentContainsLinkToDocument(content, targetDocumentKey)) return {content, changedBlockIds: []}

    return {
      content: [
        ...content,
        {
          block: {
            id: input.newBlockId,
            type: 'Embed',
            link: input.targetDocumentId,
            attributes: {view: 'Card'},
          } as HMBlockNode['block'],
          children: [],
        },
      ],
      changedBlockIds: [input.newBlockId],
    }
  }

  const sourceDocumentKey = hmDocumentKey(input.sourceDocumentId)
  const targetDocumentKey = hmDocumentKey(input.targetDocumentId)
  if (!sourceDocumentKey || !targetDocumentKey || sourceDocumentKey === targetDocumentKey) {
    return {content, changedBlockIds: []}
  }
  if (documentContainsLinkToDocument(content, targetDocumentKey)) return {content, changedBlockIds: []}

  const changedBlockIds: string[] = []
  const rewrite = (nodes: HMBlockNode[]): HMBlockNode[] => {
    return nodes.map((node) => {
      const children = rewrite(node.children || [])
      if (isEmbedLinkToDocument(node, sourceDocumentKey)) {
        if (node.block.id) changedBlockIds.push(node.block.id)
        return {
          ...node,
          block: {
            ...(node.block as any),
            link: input.targetDocumentId,
          },
          children,
        }
      }
      return {...node, children}
    })
  }

  return {content: rewrite(content), changedBlockIds}
}
