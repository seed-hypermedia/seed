import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext} from 'react'

export type ReadOnlyViewerComponent = React.ComponentType<{
  blocks: HMBlockNode[]
  resourceId?: UnpackedHypermediaId
  textUnit?: number
  layoutUnit?: number
  className?: string
}>

const ReadOnlyViewerContext = createContext<ReadOnlyViewerComponent | undefined>(undefined)

export const ReadOnlyViewerProvider = ReadOnlyViewerContext.Provider

export function useReadOnlyViewer(): ReadOnlyViewerComponent | undefined {
  return useContext(ReadOnlyViewerContext)
}
