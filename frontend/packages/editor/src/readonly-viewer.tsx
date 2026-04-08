import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useMemo} from 'react'
import {useBlockNote} from './blocknote'
import {BlockHoverActionsPositioner} from './blocknote/react/BlockHoverActions/BlockHoverActionsPositioner'
import {RangeSelectionPositioner} from './blocknote/react/RangeSelection/RangeSelectionPositioner'
import {ReadOnlyBlockNoteView} from './readonly-blocknote-view'
import type {HMBlockSchema} from './schema'
import {hmBlockSchema} from './schema'

export interface ReadOnlyViewerProps {
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
}

export function ReadOnlyViewer({
  blocks,
  textUnit,
  layoutUnit,
  className,
  commentStyle,
  onCopyBlockLink,
  onStartComment,
  onCopyFragmentLink,
  onComment,
}: ReadOnlyViewerProps) {
  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const, id: 'empty'}]
  }, [blocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      renderType: 'viewer',
      blockSchema: hmBlockSchema,
      // @ts-expect-error - EditorBlock/PartialBlock type mismatch
      initialContent,
    },
    [initialContent],
  )

  const hasHoverActions = !!(onCopyBlockLink || onStartComment)
  const hasRangeSelection = !!(onCopyFragmentLink || onComment)

  return (
    <div
      style={
        {
          '--text-unit': `${textUnit ?? 18}px`,
          '--layout-unit': `${layoutUnit ?? 24}px`,
        } as React.CSSProperties
      }
      className={commentStyle ? `${className ?? ''} comment-editor`.trim() : className}
    >
      <ReadOnlyBlockNoteView editor={editor}>
        <>
          {hasHoverActions && (
            <BlockHoverActionsPositioner
              editor={editor}
              onCopyBlockLink={onCopyBlockLink}
              onStartComment={onStartComment}
            />
          )}
          {hasRangeSelection && (
            <RangeSelectionPositioner
              editor={editor}
              onCopyFragmentLink={onCopyFragmentLink}
              onComment={onComment}
            />
          )}
        </>
      </ReadOnlyBlockNoteView>
    </div>
  )
}
