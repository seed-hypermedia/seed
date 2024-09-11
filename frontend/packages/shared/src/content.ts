import {HMBlockNode, HMDocument} from './hm-types'

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
    return null
  }

  return document?.metadata?.name || document?.account! + document?.path!
}

export function getMetadataName(metadata?: HMDocument['metadata'] | null) {
  return metadata?.name || 'Untitled Document'
}

export function getAccountName(profile: HMDocument | null | undefined) {
  return profile?.metadata?.name || profile?.account
}
