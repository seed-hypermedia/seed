import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext} from 'react'

export type ReadOnlyViewerComponent = React.ComponentType<{
  blocks: HMBlockNode[]
  resourceId?: UnpackedHypermediaId
  textUnit?: number
  layoutUnit?: number
  className?: string
  commentStyle?: boolean
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
