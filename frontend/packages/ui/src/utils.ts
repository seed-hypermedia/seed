import {HMBlock, HMBlockNode, HMDocument} from '@shm/shared/hm-types'
import {clsx, type ClassValue} from 'clsx'
import {LegacyRef, MutableRefObject, RefCallback} from 'react'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function mergeRefs<T = unknown>(
  refs: Array<MutableRefObject<T> | LegacyRef<T> | undefined>,
): RefCallback<T> | undefined {
  return (value: T | null) => {
    refs.filter(Boolean).forEach((ref) => {
      if (typeof ref == 'function') {
        ref(value)
      } else if (ref != null) {
        ;(ref as MutableRefObject<T | null>).current = value
      }
    })
  }
}

export function getDocumentCardImage(document: HMDocument): string | null {
  const coverImage = document.metadata.cover
  if (coverImage) return coverImage
  const firstImageBlock = findFirstBlock(
    document.content,
    (block) => block.type === 'Image' && !!block.link,
  )
  if (firstImageBlock) return firstImageBlock.link || null
  return null
}

export function findFirstBlock(
  content: HMBlockNode[],
  test: (block: HMBlock) => boolean,
): HMBlock | null {
  let found: HMBlock | null = null
  let index = 0
  while (!found && index < content.length) {
    const blockNode = content[index]
    if (test(blockNode.block)) {
      found = blockNode.block
      break
    }
    const foundChild =
      blockNode.children && findFirstBlock(blockNode.children, test)
    if (foundChild) {
      found = foundChild
      break
    }
    index++
  }
  return found
}
