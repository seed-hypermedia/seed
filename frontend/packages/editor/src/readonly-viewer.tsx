import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {BlockRange, HMBlockChildrenType, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  hypermediaUrlToHref,
  RenderResourceProvider,
  type RenderResourceKind,
  useOpenUrl,
  useUniversalAppContext,
} from '@shm/shared'
import {useCallback, useEffect, useMemo} from 'react'
import {useBlockNote} from './blocknote'
import {BlockHoverActionsPositioner} from './blocknote/react/BlockHoverActions/BlockHoverActionsPositioner'
import {PredictionConeDebugOverlay} from './blocknote/react/BlockHoverActions/PredictionConeDebugOverlay'
import {RangeSelectionPositioner} from './blocknote/react/RangeSelection/RangeSelectionPositioner'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import {ReadOnlyBlockNoteView} from './readonly-blocknote-view'
import type {HMBlockSchema} from './schema'
import {hmBlockSchema} from './schema'

export interface ReadOnlyViewerProps {
  blocks: HMBlockNode[]
  resourceId?: UnpackedHypermediaId
  resourceKind?: RenderResourceKind
  rootChildrenType?: HMBlockChildrenType
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

export function ReadOnlyViewer({
  blocks,
  resourceId,
  resourceKind = 'document',
  rootChildrenType,
  textUnit,
  layoutUnit,
  className,
  commentStyle,
  focusBlockId,
  blockRange,
  onCopyBlockLink,
  onStartComment,
  getBlockCommentCount,
  onCopyFragmentLink,
  onComment,
}: ReadOnlyViewerProps) {
  const openUrl = useOpenUrl()
  const {hmUrlHref, openRouteNewWindow, origin, originHomeId, experiments} = useUniversalAppContext()
  const renderHref = useCallback(
    (url: string) =>
      hypermediaUrlToHref(url, {
        hmUrlHref,
        origin,
        originHomeId,
      }) || url,
    [hmUrlHref, origin, originHomeId],
  )
  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const}]
  }, [blocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      renderType: 'viewer',
      blockSchema: hmBlockSchema,
      linkExtensionOptions: {
        openUrl,
        renderHref,
        handleModifiedClicks: !!openRouteNewWindow,
      } as any,
      // @ts-expect-error - EditorBlock/PartialBlock type mismatch
      initialContent,
      rootChildrenType: rootChildrenType || 'Group',
    },
    [initialContent, openUrl, renderHref, rootChildrenType],
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
    <RenderResourceProvider resource={resourceId ? {kind: resourceKind, id: resourceId} : null}>
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
                getCommentCount={getBlockCommentCount}
              />
            )}
            {hasRangeSelection && (
              <RangeSelectionPositioner editor={editor} onCopyFragmentLink={onCopyFragmentLink} onComment={onComment} />
            )}
            {experiments?.developerTools && <PredictionConeDebugOverlay editor={editor} />}
          </>
        </ReadOnlyBlockNoteView>
      </div>
    </RenderResourceProvider>
  )
}
