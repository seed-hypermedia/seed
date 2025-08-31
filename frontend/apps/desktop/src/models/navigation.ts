import {DocumentChange} from '@shm/shared'
import {HMBlockNode, HMNavigationItem} from '@shm/shared/hm-types'
import {isBlocksEqual} from './blocks'

export function getNavigationChanges(
  navigation: HMNavigationItem[] | undefined,
  oldNavigationBlockNode: HMBlockNode | null | undefined,
) {
  console.log('🔍 DEBUG: getNavigationChanges called with:', {
    navigationProvided: !!navigation,
    navigationLength: navigation?.length || 0,
    navigationItems: navigation,
    oldNavigationBlockProvided: !!oldNavigationBlockNode,
    oldNavigationBlock: oldNavigationBlockNode,
  })

  const ops: DocumentChange[] = []

  // Special case: If navigation is undefined but there's existing navigation,
  // it means no navigation changes were intended, so preserve existing navigation
  if (navigation === undefined && oldNavigationBlockNode) {
    console.log(
      '🔍 DEBUG: No navigation changes intended, preserving existing navigation',
    )
    return ops
  }

  // Case 1: No old navigation block exists
  if (!oldNavigationBlockNode) {
    console.log('🔍 DEBUG: Case 1 - No old navigation block exists')
    if (navigation !== undefined) {
      console.log('🔍 DEBUG: Creating new navigation with items:', navigation)
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
    } else {
      console.log('🔍 DEBUG: No navigation provided, no changes generated')
    }
    console.log('🔍 DEBUG: Case 1 returning', ops.length, 'operations')
    return ops
  }

  // Case 2: Update existing navigation
  console.log('🔍 DEBUG: Case 2 - Update existing navigation')
  const oldChildren = oldNavigationBlockNode.children || []
  const newItems = navigation || []

  console.log('🔍 DEBUG: Comparing old vs new navigation:', {
    oldChildrenCount: oldChildren.length,
    oldChildren: oldChildren.map((c) => ({id: c.block.id, type: c.block.type})),
    newItemsCount: newItems.length,
    newItems: newItems,
  })

  // Delete items that no longer exist
  const newItemIds = new Set(newItems.map((item) => item.id))
  oldChildren.forEach((child) => {
    if (!newItemIds.has(child.block.id)) {
      console.log('🔍 DEBUG: Deleting navigation item:', child.block.id)
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

  console.log('🔍 DEBUG: Case 2 returning', ops.length, 'operations')
  return ops
}
