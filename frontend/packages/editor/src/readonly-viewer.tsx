import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {BlockRange, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useEffect, useMemo} from 'react'
import {useBlockNote} from './blocknote'
import {BlockHoverActionsPositioner} from './blocknote/react/BlockHoverActions/BlockHoverActionsPositioner'
import {RangeSelectionPositioner} from './blocknote/react/RangeSelection/RangeSelectionPositioner'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
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
  /** Block whose whole node (or fragment, when combined with `blockRange`) should be visually highlighted. */
  focusBlockId?: string
  /** Codepoint range within `focusBlockId` to highlight instead of the whole block. */
  blockRange?: BlockRange
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
  focusBlockId,
  blockRange,
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

  const rangeStart = blockRange && 'start' in blockRange ? blockRange.start : null
  const rangeEnd = blockRange && 'end' in blockRange ? blockRange.end : null

  useEffect(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return

    if (focusBlockId && rangeStart != null && rangeEnd != null) {
      view.dispatch(
        view.state.tr.setMeta(blockHighlightPluginKey, {
          type: 'rangeFocus',
          blockId: focusBlockId,
          start: rangeStart,
          end: rangeEnd,
        }),
      )
    } else if (focusBlockId) {
      view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'focus', blockId: focusBlockId}))
    } else {
      view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'clear'}))
    }
  }, [editor, focusBlockId, rangeStart, rangeEnd])

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
      className={[className ?? '', 'hm-prose', commentStyle ? 'comment-editor is-comment' : '']
        .filter(Boolean)
        .join(' ')}
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
            <RangeSelectionPositioner editor={editor} onCopyFragmentLink={onCopyFragmentLink} onComment={onComment} />
          )}
        </>
      </ReadOnlyBlockNoteView>
    </div>
  )
}
