import type {BlockRange, HMBlockChildrenType, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {RenderResourceKind} from './render-resource-context'
import {createContext, useContext, type ReactNode} from 'react'

/** Shared contract for document, comment, and embedded read-only content. */
export interface ReadOnlyViewerProps {
  blocks: HMBlockNode[]
  resourceId?: UnpackedHypermediaId
  resourceKind?: RenderResourceKind
  rootChildrenType?: HMBlockChildrenType
  /** Compact fragments share their first line with the optional identity prefix. */
  presentation?: 'content' | 'fragment'
  inlinePrefix?: ReactNode
  /** Disable host positioners and use embedded node-view interactions. */
  embedded?: boolean
  /** Explicit depth supplied by legacy embed callers. Nested viewers also track depth through context. */
  depth?: number
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
  getBlockCommentCount?: (blockId: string) => number | undefined
  onCopyFragmentLink?: (blockId: string, rangeStart: number, rangeEnd: number) => void
  onComment?: (blockId: string, rangeStart: number, rangeEnd: number) => void
}

/** Renderer supplied by each application and the server render pipeline. */
export type ReadOnlyViewerComponent = React.ComponentType<ReadOnlyViewerProps>

const ReadOnlyViewerContext = createContext<ReadOnlyViewerComponent | undefined>(undefined)

/** Supplies the common renderer without a UI-to-editor package dependency. */
export const ReadOnlyViewerProvider = ReadOnlyViewerContext.Provider

/** Returns the read-only renderer supplied by the host application. */
export function useReadOnlyViewer(): ReadOnlyViewerComponent | undefined {
  return useContext(ReadOnlyViewerContext)
}
