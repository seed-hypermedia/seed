import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {applyDocumentCardCleanupToBlockNodes} from './document-card-cleanup'
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
        nodes.map((node) => {
          let block = node.block
          if (block.id === job.cardBlockId && block.type === 'Embed') {
            const attributes = {...block.attributes}
            delete (attributes as Record<string, unknown>).draftId
            block = {...block, attributes, link: targetDocumentId, revision: undefined}
          }
          return {...node, block, children: resolve(node.children || [])}
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
  const baseMap = createBlocksMap(base, '')
  const mineMap = createBlocksMap(nextMine, '')
  const correctedBaseMap = createBlocksMap(transform(base), '')
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
  const resultMap = createBlocksMap(content, '')
  const mineTouchedIds = Array.from(new Set([...Object.keys(resultMap), ...Object.keys(publishedMap)])).filter((id) => {
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
  return {content, mineTouchedIds}
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
