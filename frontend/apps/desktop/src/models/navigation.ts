import {DocumentChange} from '@shm/shared'
import {HMBlockNode, HMNavigationItem} from '@shm/shared/hm-types'
import {isBlocksEqual} from './blocks'

export function getNavigationChanges(
  navigation: HMNavigationItem[] | undefined,
  oldNavigationBlockNode: HMBlockNode | null | undefined,
) {
  const ops: DocumentChange[] = []
  if (!oldNavigationBlockNode && navigation) {
    ops.push(
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: {
            id: 'navigation',
            type: 'Group',
          },
        },
      }),
    )
  }
  console.log(
    '~~ will get navigation changes',
    navigation,
    oldNavigationBlockNode,
  )
  const newBlocks = Object.fromEntries(
    navigation?.map((item) => [item.id, item]) || [],
  )
  let newBlockWalkLeftSibling: string | undefined = undefined
  const newBlockLeftSiblings = Object.fromEntries(
    navigation?.map((item) => {
      const leftSibling = newBlockWalkLeftSibling
      newBlockWalkLeftSibling = item.id
      return [item.id, leftSibling]
    }) || [],
  )
  const changedBlockIds = new Set<string>()
  const blockIdsToRemove = new Set<string>()
  const blocksToMove = new Set<string>()
  let oldBlockWalkLeftSibling: string | undefined = undefined
  oldNavigationBlockNode?.children?.forEach((bn) => {
    blockIdsToRemove.add(bn.block.id)
    const newBlock = newBlocks[bn.block.id]
    if (!newBlock || !isBlocksEqual(bn.block, newBlock)) {
      changedBlockIds.add(bn.block.id)
    }
    if (newBlockLeftSiblings[bn.block.id] !== oldBlockWalkLeftSibling) {
      blocksToMove.add(bn.block.id)
    }
    oldBlockWalkLeftSibling = bn.block.id
  })
  navigation?.forEach((item) => {
    blockIdsToRemove.delete(item.id)
    if (changedBlockIds.has(item.id))
      ops.push(
        new DocumentChange({
          op: {
            case: 'replaceBlock',
            value: {
              id: item.id,
              type: 'Link',
              link: item.link,
              text: item.text,
            },
          },
        }),
      )
    if (blocksToMove.has(item.id))
      ops.push(
        new DocumentChange({
          op: {
            case: 'moveBlock',
            value: {
              blockId: item.id,
              parent: 'navigation',
              leftSibling: newBlockLeftSiblings[item.id],
            },
          },
        }),
      )
  })
  blockIdsToRemove.forEach((id) => {
    ops.push(
      new DocumentChange({
        op: {case: 'deleteBlock', value: id},
      }),
    )
  })
  console.log('~~ final navigation ops', ops)
  return ops
}
