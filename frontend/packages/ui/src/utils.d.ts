import {HMBlock, HMBlockNode, HMDocument} from '@shm/shared/hm-types'
import {type ClassValue} from 'clsx'
import {LegacyRef, MutableRefObject, RefCallback} from 'react'
export declare function cn(...inputs: ClassValue[]): string
export declare function mergeRefs<T = unknown>(
  refs: Array<MutableRefObject<T> | LegacyRef<T> | undefined>,
): RefCallback<T> | undefined
export declare function getDocumentCardImage(
  document: HMDocument,
): string | null
export declare function findFirstBlock(
  content: HMBlockNode[],
  test: (block: HMBlock) => boolean,
): HMBlock | null
