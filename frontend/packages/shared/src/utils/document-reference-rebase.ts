import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {applyDocumentCardCleanupToBlockNodes, hmLinkTargetsDocument} from './document-card-cleanup'
import {applyRebasePlan, classifyRebase, createBlocksMap, isBlocksEqual} from './document-changes'

/** Reconciles only maintenance changes, preserving local deletions and refusing unrelated conflicts. */
export function rebaseDocumentReferenceDraft(
  job: {
    operation?: string
    sourceDocumentId?: string
    targetDocumentId?: string
    deletedDocumentId?: string
    targetBlockId?: string
    childDraftId?: string
    cardBlockId?: string
  },
  base: HMBlockNode[],
  mine: HMBlockNode[],
  published: HMBlockNode[],
) {
  const operation = job.operation || 'remove'
  const sourceDocumentId = job.sourceDocumentId || job.deletedDocumentId
  const targetDocumentId = job.targetDocumentId || sourceDocumentId
  const transform = (content: HMBlockNode[]) => {
    if (operation === 'add' && job.childDraftId && job.cardBlockId && targetDocumentId) {
      const resolve = (nodes: HMBlockNode[]): HMBlockNode[] =>
        nodes.flatMap((node) => {
          let block = node.block
          if (block.id === job.cardBlockId && block.type === 'Embed') {
            const attributes = {...block.attributes}
            delete (attributes as Record<string, unknown>).draftId
            block = {...block, attributes, link: targetDocumentId, revision: undefined}
          } else if (
            block.type === 'Embed' &&
            (block.attributes as Record<string, unknown> | undefined)?.draftId === job.childDraftId
          ) {
            // A duplicate draft card for the same child: drop it and lift its children in place.
            return resolve(node.children || [])
          }
          return [{...node, block, children: resolve(node.children || [])}]
        })
      return resolve(content)
    }
    if (operation === 'add' || operation === 'delete-child') return content
    return applyDocumentCardCleanupToBlockNodes(content, {
      operation,
      sourceDocumentId,
      targetDocumentId,
      targetBlockId: job.targetBlockId,
    } as Parameters<typeof applyDocumentCardCleanupToBlockNodes>[1]).content
  }
  const nextMine = transform(mine)
  const transformedBase = transform(base)
  const mineTouchedIdsFor = (result: HMBlockNode[]) => {
    const resultMap = createBlocksMap(result, '')
    const publishedMap = createBlocksMap(published, '')
    return Array.from(new Set([...Object.keys(resultMap), ...Object.keys(publishedMap)])).filter((id) => {
      const local = resultMap[id]
      const remote = publishedMap[id]
      return (
        !local ||
        !remote ||
        !isBlocksEqual(local.block, remote.block) ||
        local.parent !== remote.parent ||
        local.left !== remote.left
      )
    })
  }
  // Maintenance-only fast path: when the published tree differs from the
  // transformed baseline only by this job's card, keep the draft's own
  // structure instead of rebasing onto the published scaffold.
  const cardId = operation === 'add' ? job.cardBlockId : undefined
  const stripCard = (nodes: HMBlockNode[]): HMBlockNode[] => {
    if (!cardId) return nodes
    return nodes.flatMap((node) =>
      node.block.id === cardId ? [] : [{...node, children: stripCard(node.children || [])}],
    )
  }
  const sameBlockTrees = (a: HMBlockNode[], b: HMBlockNode[]) => {
    const mapA = createBlocksMap(a, '')
    const mapB = createBlocksMap(b, '')
    const idsA = Object.keys(mapA)
    if (idsA.length !== Object.keys(mapB).length) return false
    return idsA.every((id) => {
      const x = mapA[id]!
      const y = mapB[id]
      return !!y && x.parent === y.parent && x.left === y.left && isBlocksEqual(x.block, y.block)
    })
  }
  const containsId = (nodes: HMBlockNode[], id: string): boolean =>
    nodes.some((node) => node.block.id === id || containsId(node.children || [], id))
  const insertAfterId = (nodes: HMBlockNode[], id: string, newNode: HMBlockNode): HMBlockNode[] | undefined => {
    const index = nodes.findIndex((node) => node.block.id === id)
    if (index >= 0) return [...nodes.slice(0, index + 1), newNode, ...nodes.slice(index + 1)]
    for (let i = 0; i < nodes.length; i++) {
      const children = nodes[i]!.children
      if (!children?.length) continue
      const updated = insertAfterId(children, id, newNode)
      if (updated) return nodes.map((node, j) => (j === i ? {...node, children: updated} : node))
    }
    return undefined
  }
  const prependChildId = (nodes: HMBlockNode[], id: string, newNode: HMBlockNode): HMBlockNode[] =>
    nodes.map((node) =>
      node.block.id === id
        ? {...node, children: [newNode, ...(node.children || [])]}
        : {...node, children: prependChildId(node.children || [], id, newNode)},
    )
  if (sameBlockTrees(stripCard(published), stripCard(transformedBase))) {
    let content = nextMine
    if (cardId && targetDocumentId && !containsId(content, cardId) && !containsId(base, cardId)) {
      const referencesTarget = (nodes: HMBlockNode[]): boolean =>
        nodes.some((node) => {
          const link = 'link' in node.block ? (node.block as {link?: unknown}).link : undefined
          return (
            (typeof link === 'string' && hmLinkTargetsDocument(link, targetDocumentId)) ||
            referencesTarget(node.children || [])
          )
        })
      let publishedCard: HMBlockNode | undefined
      let publishedSiblings: HMBlockNode[] = []
      let cardIndex = -1
      let cardParent = ''
      const locateCard = (nodes: HMBlockNode[], parent: string) => {
        const index = nodes.findIndex((node) => node.block.id === cardId)
        if (index >= 0) {
          publishedCard = nodes[index]
          publishedSiblings = nodes
          cardIndex = index
          cardParent = parent
        }
        nodes.forEach((node) => locateCard(node.children || [], node.block.id))
      }
      locateCard(published, '')
      if (publishedCard && !referencesTarget(content)) {
        const newCard = {...publishedCard, block: {...publishedCard.block, revision: undefined}} as HMBlockNode
        const anchor = publishedSiblings
          .slice(0, cardIndex)
          .reverse()
          .find((node) => containsId(content, node.block.id))
        if (anchor) {
          content = insertAfterId(content, anchor.block.id, newCard) || content
        } else if (cardParent && containsId(content, cardParent)) {
          content = prependChildId(content, cardParent, newCard)
        } else {
          content = [newCard, ...content]
        }
      }
    }
    return {content, mineTouchedIds: mineTouchedIdsFor(content)}
  }
  const baseMap = createBlocksMap(base, '')
  const mineMap = createBlocksMap(nextMine, '')
  const correctedBaseMap = createBlocksMap(transformedBase, '')
  const publishedMap = createBlocksMap(published, '')
  const touched = new Set<string>()
  for (const id of Array.from(new Set([...Object.keys(baseMap), ...Object.keys(mineMap)]))) {
    const before = baseMap[id]
    const after = mineMap[id]
    if (
      !before ||
      !after ||
      !isBlocksEqual(before.block, after.block) ||
      before.parent !== after.parent ||
      before.left !== after.left
    ) {
      touched.add(id)
    }
  }
  const classification = classifyRebase(base, nextMine, published, touched, new Set())
  const picks: Record<string, 'mine' | 'theirs'> = {}
  for (const id of classification.conflictedBlockIds) {
    const expected = correctedBaseMap[id]
    const actual = publishedMap[id]
    // A local deletion must remain deleted, including when maintenance renamed its card.
    // Other conflicts are safe only when the remote block changed exclusively by this job.
    if (!mineMap[id] && !expected && !actual) {
      picks[id] = 'mine'
    } else if (mineMap[id] && actual && isBlocksEqual(mineMap[id]!.block, actual.block)) {
      picks[id] = 'mine'
    } else if (
      (!mineMap[id] && expected && actual && isBlocksEqual(expected.block, actual.block)) ||
      (expected &&
        actual &&
        isBlocksEqual(expected.block, actual.block) &&
        expected.parent === actual.parent &&
        expected.left === actual.left)
    ) {
      picks[id] = 'mine'
    } else {
      throw new Error('Parent draft has conflicting remote edits. Review and rebase the draft before retrying.')
    }
  }
  let content = applyRebasePlan(nextMine, published, classification.plan, picks)
  // Publishing cannot include a draft-only container. Keep the resolved placeholder at
  // its original local position even when the published card had to use a root anchor.
  if (operation === 'add' && job.childDraftId && job.cardBlockId) {
    let localSiblings: HMBlockNode[] | undefined
    let localParent = ''
    let card: HMBlockNode | undefined
    const locate = (nodes: HMBlockNode[], parent: string) => {
      if (nodes.some((node) => node.block.id === job.cardBlockId)) {
        localSiblings = nodes
        localParent = parent
      }
      nodes.forEach((node) => locate(node.children || [], node.block.id))
    }
    locate(nextMine, '')
    const detach = (nodes: HMBlockNode[]): HMBlockNode[] => {
      return nodes.flatMap((node) => {
        if (node.block.id === job.cardBlockId) {
          card = node
          return []
        }
        return [{...node, children: detach(node.children || [])}]
      })
    }
    if (localSiblings) {
      const detached = detach(content)
      let destination: HMBlockNode[] | undefined = localParent ? undefined : detached
      const findParent = (nodes: HMBlockNode[]) => {
        nodes.forEach((node) => {
          if (node.block.id === localParent) destination = node.children ||= []
          findParent(node.children || [])
        })
      }
      findParent(detached)
      if (card && destination) {
        const index = localSiblings.findIndex((node) => node.block.id === job.cardBlockId)
        const previous = localSiblings
          .slice(0, index)
          .reverse()
          .find((node) => destination!.some((item) => item.block.id === node.block.id))
        const insertAt = previous ? destination.findIndex((node) => node.block.id === previous.block.id) + 1 : 0
        destination.splice(insertAt, 0, card)
        content = detached
      }
    }
  }
  return {content, mineTouchedIds: mineTouchedIdsFor(content)}
}

/** Finds a card insertion anchor without publishing any draft-only ancestor or sibling. */
export function findPublishedCardPosition(published: HMBlockNode[], draft: HMBlockNode[], cardId: string) {
  const publishedMap = createBlocksMap(published, '')
  let position: {parent: string; leftSibling: string} | undefined
  function visit(nodes: HMBlockNode[], parent: string, fallback: {parent: string; leftSibling: string}) {
    const safeParent = !parent || publishedMap[parent] ? parent : fallback.parent
    let leftSibling = safeParent === parent ? '' : fallback.leftSibling
    for (const node of nodes) {
      if (node.block.id === cardId) position = {parent: safeParent, leftSibling}
      visit(node.children || [], node.block.id, {parent: safeParent, leftSibling})
      if (publishedMap[node.block.id]?.parent === safeParent) leftSibling = node.block.id
    }
  }
  visit(draft, '', {parent: '', leftSibling: ''})
  return position
}
