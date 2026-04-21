import type {BlockRange, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext} from 'react'

export type ReadOnlyViewerComponent = React.ComponentType<{
  blocks: HMBlockNode[]
  resourceId?: UnpackedHypermediaId
  textUnit?: number
  layoutUnit?: number
  className?: string
  commentStyle?: boolean
  /** Block whose whole node (or fragment, when combined with `blockRange`) should be visually highlighted. */
  focusBlockId?: string
  /** Codepoint range within `focusBlockId` to highlight instead of the whole block. */
  blockRange?: BlockRange
  onCopyBlockLink?: (blockId: string) => void
  onStartComment?: (blockId: string) => void
  onCopyFragmentLink?: (blockId: string, rangeStart: number, rangeEnd: number) => void
  onComment?: (blockId: string, rangeStart: number, rangeEnd: number) => void
}>

const ReadOnlyViewerContext = createContext<ReadOnlyViewerComponent | undefined>(undefined)

export const ReadOnlyViewerProvider = ReadOnlyViewerContext.Provider

export function useReadOnlyViewer(): ReadOnlyViewerComponent | undefined {
  return useContext(ReadOnlyViewerContext)
}
