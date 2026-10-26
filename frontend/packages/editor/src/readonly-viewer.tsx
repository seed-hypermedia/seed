import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {ReadOnlyViewerProps} from '@shm/shared/readonly-viewer-context'
import {getSSREmbedRenderer} from './ssr-embed-renderer'
import styles from './readonly-viewer.module.css'

import {hypermediaUrlToHref, RenderResourceProvider, useOpenUrl, useUniversalAppContext} from '@shm/shared'
import {createContext, useContext, useCallback, useEffect, useMemo} from 'react'
import {useImageUrl} from '@shm/ui/get-file-url'
import {useBlockNote} from './blocknote'
import {BlockHoverActionsPositioner} from './blocknote/react/BlockHoverActions/BlockHoverActionsPositioner'
import {PredictionConeDebugOverlay} from './blocknote/react/BlockHoverActions/PredictionConeDebugOverlay'
import {RangeSelectionPositioner} from './blocknote/react/RangeSelection/RangeSelectionPositioner'
import {ImageGalleryOverlay} from './blocknote/react/ImageGallery/ImageGalleryOverlay'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import {ReadOnlyBlockNoteView} from './readonly-blocknote-view'
import type {HMBlockSchema} from './schema'
import {hmBlockSchema} from './schema'

/** Shared read-only renderer properties. */
export type {ReadOnlyViewerProps} from '@shm/shared/readonly-viewer-context'

const EmbedDepthContext = createContext(0)

/** Renders read-only content with the same presentation on the client and server. */
export function ReadOnlyViewer(props: ReadOnlyViewerProps) {
  const parentDepth = useContext(EmbedDepthContext)
  const depth = props.depth ?? parentDepth + (props.embedded ? 1 : 0)
  const fragment = props.presentation === 'fragment'
  // Code fragments are inline text, not an interactive code-block scroller.
  const blocks = useMemo(
    () =>
      fragment
        ? props.blocks.map((node) =>
            node.block.type === 'Code'
              ? {
                  ...node,
                  block: {
                    ...node.block,
                    type: 'Paragraph' as const,
                    annotations: [
                      ...(node.block.annotations || []),
                      {type: 'Code' as const, starts: [0], ends: [Array.from(node.block.text || '').length]},
                    ],
                  },
                }
              : node,
          )
        : props.blocks,
    [fragment, props.blocks],
  )
  if (depth > 3) return null
  const ssrRenderer = typeof window === 'undefined' ? getSSREmbedRenderer() : null
  const html = ssrRenderer?.(blocks, props.rootChildrenType)
  if (typeof window === 'undefined' && !html) return null

  return (
    <EmbedDepthContext.Provider value={depth}>
      <RenderResourceProvider
        resource={props.resourceId ? {kind: props.resourceKind ?? 'document', id: props.resourceId} : null}
      >
        <div
          contentEditable={props.embedded ? false : undefined}
          suppressContentEditableWarning
          onDragStart={
            props.embedded
              ? (event) => {
                  event.stopPropagation()
                  event.preventDefault()
                }
              : undefined
          }
          style={
            {
              '--text-unit': `${props.textUnit ?? (fragment ? 12 : 18)}px`,
              '--layout-unit': `${props.layoutUnit ?? 24}px`,
              '--hm-prose-size': `${props.textUnit ?? (fragment ? 12 : props.commentStyle ? 16 : 18)}px`,
              '--hm-breakout': props.embedded ? '0px' : undefined,
            } as React.CSSProperties
          }
          className={[
            props.className,
            'hm-prose',
            styles.root,
            fragment ? styles.fragment : '',
            props.commentStyle ? 'comment-editor is-comment' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {fragment && props.inlinePrefix ? <>{props.inlinePrefix} </> : null}
          {html != null ? (
            <div className={styles.content} dangerouslySetInnerHTML={{__html: html}} />
          ) : (
            <ReadOnlyViewerContent {...props} blocks={blocks} />
          )}
        </div>
      </RenderResourceProvider>
    </EmbedDepthContext.Provider>
  )
}

function ReadOnlyViewerContent({
  blocks,
  rootChildrenType,
  embedded,
  focusBlockId,
  blockRange,
  onCopyBlockLink,
  onStartComment,
  getBlockCommentCount,
  onCopyFragmentLink,
  onComment,
}: ReadOnlyViewerProps) {
  const openUrl = useOpenUrl()
  const getImageUrl = useImageUrl()
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
      renderType: embedded ? 'embed' : 'viewer',
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
    [initialContent, openUrl, renderHref, openRouteNewWindow, rootChildrenType, embedded],
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
    <ReadOnlyBlockNoteView editor={editor} className={styles.content}>
      <ImageGalleryOverlay editor={editor} resolveImageUrl={getImageUrl} />
      {!embedded && hasHoverActions && (
        <BlockHoverActionsPositioner
          editor={editor}
          onCopyBlockLink={onCopyBlockLink}
          onStartComment={onStartComment}
          getCommentCount={getBlockCommentCount}
        />
      )}
      {!embedded && hasRangeSelection && (
        <RangeSelectionPositioner editor={editor} onCopyFragmentLink={onCopyFragmentLink} onComment={onComment} />
      )}
      {!embedded && experiments?.developerTools && experiments?.predictionConeDebug && (
        <PredictionConeDebugOverlay editor={editor} />
      )}
    </ReadOnlyBlockNoteView>
  )
}
