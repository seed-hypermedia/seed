import type {BlockRange, HMBlockChildrenType, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {ReadOnlyViewer} from './readonly-viewer'

/** Compatibility adapter for callers that still pass an embed resource as `id`. */
export function EmbedEditorView({
  blocks,
  id,
  depth,
  focusBlockId,
  blockRange,
  rootChildrenType,
}: {
  blocks: HMBlockNode[]
  id: UnpackedHypermediaId
  depth?: number
  rootChildrenType?: HMBlockChildrenType
  /** Block id within the embedded content to focus-highlight. */
  focusBlockId?: string
  /** Codepoint range within `focusBlockId` to highlight instead of the whole block. */
  blockRange?: BlockRange | null
}) {
  return (
    <ReadOnlyViewer
      blocks={blocks}
      resourceId={id}
      depth={depth}
      embedded
      focusBlockId={focusBlockId}
      blockRange={blockRange ?? undefined}
      rootChildrenType={rootChildrenType}
    />
  )
}
