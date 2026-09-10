import {
  type HMBlockNode,
  type HMDocument,
  type UnpackedHypermediaId,
  unpackHmId,
} from '@seed-hypermedia/client/hm-types'
import {Block, DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'
import {applyRebasePlan, classifyRebase} from './document-changes'

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
      targetBlockId?: string
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

/** Rebases an unpublished parent draft over the published document-card update. */
export function rebaseDocumentReferenceDraft(input: {
  base: HMBlockNode[]
  mine: HMBlockNode[]
  published: HMBlockNode[]
  mineTouchedIds?: string[]
}) {
  const baseRevisions = new Map<string, string | undefined>()
  const indexBase = (nodes: HMBlockNode[]) =>
    nodes.forEach((node) => {
      baseRevisions.set(node.block.id, (node.block as any).revision)
      indexBase(node.children || [])
    })
  indexBase(input.base)
  const newChangeCids = new Set<string>()
  const indexPublished = (nodes: HMBlockNode[]) =>
    nodes.forEach((node) => {
      const revision = (node.block as any).revision
      if (revision && revision !== baseRevisions.get(node.block.id)) newChangeCids.add(revision)
      indexPublished(node.children || [])
    })
  indexPublished(input.published)
  const classification = classifyRebase(
    input.base,
    input.mine,
    input.published,
    input.mineTouchedIds || [],
    newChangeCids,
  )
  return {
    content: classification.autoMergeable
      ? applyRebasePlan(input.mine, input.published, classification.plan)
      : input.mine,
    conflictedBlockIds: classification.conflictedBlockIds,
  }
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
  if (block?.type !== 'Embed' || block.attributes?.view !== 'Card') return false
  if (options.targetBlockId && block.id !== options.targetBlockId) return false
  if (!block.link) return false
  return hmDocumentKey(block.link) === deletedDocumentKey
}

function directBlockLinks(block: HMBlockNode['block']): string[] {
  return [
    ...('link' in block && block.link ? [block.link] : []),
    ...('annotations' in block ? block.annotations || [] : []).flatMap((annotation) =>
      (annotation.type === 'Link' || annotation.type === 'Embed') && annotation.link ? [annotation.link] : [],
    ),
  ]
}

function blockLinksToDocument(block: HMBlockNode['block'], documentKey: string) {
  return directBlockLinks(block).some((link) => hmDocumentKey(link) === documentKey)
}

function documentContainsLinkToDocument(nodes: HMBlockNode[], documentKey: string): boolean {
  return nodes.some(
    (node) =>
      blockLinksToDocument(node.block, documentKey) || documentContainsLinkToDocument(node.children || [], documentKey),
  )
}

/** Returns direct children that had a direct reference before an edit and have none afterward.
 * A surviving self-query covers the children. Removed query scopes are resolved by the publication inspector.
 * Callers must exclude system-maintenance edits.
 */
export function getDirectChildrenLosingReferences(
  parent: Pick<UnpackedHypermediaId, 'uid' | 'path'>,
  before: HMBlockNode[],
  after: HMBlockNode[],
): UnpackedHypermediaId[] {
  if (hasSelfQueryBlock(after, documentIdForPath(parent.uid, parent.path || []))) return []
  const parentPath = parent.path || []
  function collect(nodes: HMBlockNode[], references: Map<string, UnpackedHypermediaId>) {
    for (const node of nodes) {
      for (const link of directBlockLinks(node.block)) {
        const id = unpackHmId(link)
        const path = id?.path || []
        if (
          id?.uid !== parent.uid ||
          path.length !== parentPath.length + 1 ||
          !parentPath.every((segment, index) => path[index] === segment)
        )
          continue
        const documentId = documentIdForPath(id.uid, path)
        references.set(documentId, unpackHmId(documentId)!)
      }
      collect(node.children || [], references)
    }
  }
  const previous = new Map<string, UnpackedHypermediaId>()
  const current = new Map<string, UnpackedHypermediaId>()
  collect(before, previous)
  collect(after, current)
  return Array.from(previous).flatMap(([id, target]) => (current.has(id) ? [] : [target]))
}

function rewriteBlockLinks(block: HMBlockNode['block'], sourceKey: string, target: string): HMBlockNode['block'] {
  return {
    ...block,
    revision: undefined,
    ...('link' in block && block.link && hmDocumentKey(block.link) === sourceKey ? {link: target} : {}),
    ...('annotations' in block
      ? {
          annotations: block.annotations?.map((annotation) =>
            (annotation.type === 'Link' || annotation.type === 'Embed') &&
            annotation.link &&
            hmDocumentKey(annotation.link) === sourceKey
              ? {...annotation, link: target}
              : annotation,
          ),
        }
      : {}),
  } as HMBlockNode['block']
}

function queryIncludeTargetsParent(include: any, parentUid: string, parentPath: string[]) {
  if (!include || include.space !== parentUid) return false
  const includePath = String(include.path || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
  return includePath.join('/') === parentPath.join('/')
}

/** Whether content contains a query covering this parent's children, independent of display limits. */
export function hasSelfQueryBlock(nodes: HMBlockNode[], parentDocumentId: string) {
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

function collectMatchingReferences(nodes: HMBlockNode[], documentKey: string): HMBlockNode[] {
  return nodes.flatMap((node) => [
    ...(blockLinksToDocument(node.block, documentKey) ? [node] : []),
    ...collectMatchingReferences(node.children || [], documentKey),
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

/** Plans pure document changes that remove Card embeds pointing at a deleted document. */
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

/** Plans pure document changes that rewrite existing direct references from one document id to another. */
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

  const matchingEmbeds = collectMatchingReferences(content, fromDocumentKey)
  if (!matchingEmbeds.length) return {changes: [], rewrittenBlockIds: []}

  return {
    changes: matchingEmbeds.map((node) => {
      return new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: Block.fromJson({...rewriteBlockLinks(node.block, fromDocumentKey, toDocumentId), revision: ''} as any),
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
        if (
          isMatchingDeletedDocumentEmbed(node, sourceDocumentKey) &&
          (!input.targetBlockId || node.block.id === input.targetBlockId)
        ) {
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

  const changedBlockIds: string[] = []
  const rewrite = (nodes: HMBlockNode[]): HMBlockNode[] => {
    return nodes.map((node) => {
      const children = rewrite(node.children || [])
      if (blockLinksToDocument(node.block, sourceDocumentKey)) {
        if (node.block.id) changedBlockIds.push(node.block.id)
        return {
          ...node,
          block: rewriteBlockLinks(node.block, sourceDocumentKey, input.targetDocumentId),
          children,
        }
      }
      return {...node, children}
    })
  }

  return {content: rewrite(content), changedBlockIds}
}

type EditorDraftCardBlockLike = {
  id?: string
  type?: string
  props?: {draftId?: string; url?: string; view?: string; defaultOpen?: string}
  content?: unknown[]
  children?: EditorDraftCardBlockLike[]
  [key: string]: unknown
}

function isEditorDraftCardEmbed(block: EditorDraftCardBlockLike, draftId: string, targetBlockId?: string) {
  if (block.type !== 'embed') return false
  if (targetBlockId && block.id !== targetBlockId) return false
  return block.props?.draftId === draftId
}

function editorBlocksContainDraftCard(blocks: EditorDraftCardBlockLike[], draftId: string): boolean {
  return blocks.some((block) => {
    if (isEditorDraftCardEmbed(block, draftId)) return true
    return editorBlocksContainDraftCard(block.children || [], draftId)
  })
}

/** Removes editor draft-card embeds that reference an unpublished draft id. */
export function removeDraftCardFromEditorBlocks(
  blocks: EditorDraftCardBlockLike[],
  draftId: string,
  targetBlockId?: string,
): {content: EditorDraftCardBlockLike[]; removedBlockIds: string[]} {
  const removedBlockIds: string[] = []

  function expandBlock(block: EditorDraftCardBlockLike): EditorDraftCardBlockLike[] {
    const children = Array.isArray(block.children) ? block.children : []
    if (isEditorDraftCardEmbed(block, draftId, targetBlockId)) {
      if (block.id) removedBlockIds.push(block.id)
      return children.flatMap(expandBlock)
    }
    return [{...block, children: children.flatMap(expandBlock)}]
  }

  return {content: blocks.flatMap(expandBlock), removedBlockIds}
}

/** Appends an editor draft-card embed for an unpublished draft unless one already exists. */
export function appendDraftCardToEditorBlocks(
  blocks: EditorDraftCardBlockLike[],
  draftId: string,
  newBlockId: string,
): {content: EditorDraftCardBlockLike[]; addedBlockIds: string[]} {
  if (!draftId || !newBlockId || editorBlocksContainDraftCard(blocks, draftId)) {
    return {content: blocks, addedBlockIds: []}
  }
  return {
    content: [
      ...blocks,
      {
        id: newBlockId,
        type: 'embed',
        props: {url: '', draftId, view: 'Card', defaultOpen: 'false'},
        content: [],
        children: [],
      },
    ],
    addedBlockIds: [newBlockId],
  }
}

/** Proof captured before a primary operation, used to recover its follow-up without speculative parent writes. */
export type DocumentCleanupPrimaryProof = {
  documentId: string
  expectedVersion?: string
  expectedGenesis?: string
  expectedType: 'document' | 'redirect' | 'tombstone'
  targetDocumentId?: string
}

/** Verifies an interrupted primary operation; incomplete or changed evidence requires manual review. */
export async function verifyDocumentCleanupPrimary(
  client: Pick<import('../universal-client').UniversalClient, 'request'>,
  proof: DocumentCleanupPrimaryProof,
): Promise<void> {
  const id = unpackHmId(proof.documentId)
  if (!id) throw new Error('Primary operation needs review: invalid document ID')
  const resource = await client.request('Resource', {...id, version: null, latest: true})
  if (resource.type !== proof.expectedType) throw new Error('Primary operation needs review: outcome not confirmed')
  if (resource.type === 'document') {
    if (!proof.expectedVersion && !proof.expectedGenesis)
      throw new Error('Primary operation needs review: publication identity is unavailable')
    if (proof.expectedVersion && resource.document.version !== proof.expectedVersion)
      throw new Error('Primary operation needs review: publication version changed')
    if (proof.expectedGenesis && resource.document.genesis !== proof.expectedGenesis)
      throw new Error('Primary operation needs review: document identity changed')
  }
  if (resource.type === 'redirect') {
    if (!proof.targetDocumentId || resource.redirectTarget.id !== proof.targetDocumentId)
      throw new Error('Primary operation needs review: redirect destination changed')
    if (!proof.expectedGenesis)
      throw new Error('Primary operation needs review: original document identity is unavailable')
    const target = unpackHmId(proof.targetDocumentId)!
    const targetResource = await client.request('Resource', {...target, version: null, latest: true})
    if (targetResource.type !== 'document')
      throw new Error('Primary operation needs review: captured destination moved or is unavailable')
    if (targetResource.document.genesis !== proof.expectedGenesis)
      throw new Error('Primary operation needs review: moved document identity changed')
  }
}

/** Captures authored direct-child removals plus unresolved web destinations for asynchronous publish-time resolution. */
export function getRemovedChildReferenceTargets(
  parent: Pick<UnpackedHypermediaId, 'uid' | 'path'>,
  before: HMBlockNode[],
  after: HMBlockNode[],
): string[] {
  if (hasSelfQueryBlock(after, documentIdForPath(parent.uid, parent.path || []))) return []
  const remaining = new Set(getDocumentReferenceLinks(after))
  return Array.from(
    new Set([
      ...getDirectChildrenLosingReferences(parent, before, after).map((id) => id.id),
      ...getDocumentReferenceLinks(before).filter(
        (link) => /^https?:\/\//.test(link) && !unpackHmId(link) && !remaining.has(link),
      ),
    ]),
  )
}

/** Lists authored reference destinations recursively, excluding query results. */
export function getDocumentReferenceLinks(nodes: HMBlockNode[]): string[] {
  return nodes.flatMap((node) => [...directBlockLinks(node.block), ...getDocumentReferenceLinks(node.children || [])])
}
