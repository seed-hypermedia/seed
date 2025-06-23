import {DocumentChange} from '@shm/shared'
import {HMBlockNode, HMNavigationItem} from '@shm/shared/hm-types'
import {isBlocksEqual} from './blocks'

export function getNavigationChanges(
  navigation: HMNavigationItem[] | undefined,
  oldNavigationBlockNode: HMBlockNode | null | undefined,
) {
  const ops: DocumentChange[] = []

  // Case 1: No old navigation block exists
  if (!oldNavigationBlockNode) {
    if (navigation !== undefined) {
      // Create navigation group
      ops.push(
        new DocumentChange({
          op: {
            case: 'replaceBlock',
            value: {id: 'navigation', type: 'Group'},
          },
        }),
      )

      // Create and position navigation items
      let leftSibling = ''
      navigation.forEach((item) => {
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
        ops.push(
          new DocumentChange({
            op: {
              case: 'moveBlock',
              value: {blockId: item.id, parent: 'navigation', leftSibling},
            },
          }),
        )
        leftSibling = item.id
      })
    }
    return ops
  }

  // Case 2: Update existing navigation
  const oldChildren = oldNavigationBlockNode.children || []
  const newItems = navigation || []

  // Delete items that no longer exist
  const newItemIds = new Set(newItems.map((item) => item.id))
  oldChildren.forEach((child) => {
    if (!newItemIds.has(child.block.id)) {
      ops.push(
        new DocumentChange({
          op: {case: 'deleteBlock', value: child.block.id},
        }),
      )
    }
  })

  // Create/update items in new order
  let leftSibling = ''
  newItems.forEach((item) => {
    const oldBlock = oldChildren.find((child) => child.block.id === item.id)
      ?.block
    const newBlock = {
      id: item.id,
      type: 'Link' as const,
      link: item.link,
      text: item.text,
    }

    // Create or update block if needed
    if (!oldBlock || !isBlocksEqual(oldBlock, newBlock)) {
      ops.push(
        new DocumentChange({
          op: {case: 'replaceBlock', value: newBlock},
        }),
      )
    }

    // Move to correct position
    ops.push(
      new DocumentChange({
        op: {
          case: 'moveBlock',
          value: {blockId: item.id, parent: 'navigation', leftSibling},
        },
      }),
    )
    leftSibling = item.id
  })

  return ops
}
