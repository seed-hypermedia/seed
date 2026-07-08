import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {BlockRange, HMBlockChildrenType, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hypermediaUrlToHref, RenderResourceProvider, useOpenUrl, useUniversalAppContext} from '@shm/shared'
import type {LinkExtensionOptions} from '@shm/shared/document-content-props'
import {useCallback, useEffect, useMemo} from 'react'
import {BlockNoteEditor, useBlockNote} from './blocknote'
import {getSSREmbedRenderer} from './ssr-embed-renderer'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import {BlockNoteView} from './blocknote/react/BlockNoteView'
import {hmBlockSchema, HMBlockSchema} from './schema'

export function useEmbedEditor(
  blocks: HMBlockNode[],
  linkExtensionOptions?: LinkExtensionOptions,
  rootChildrenType?: HMBlockChildrenType,
): BlockNoteEditor<HMBlockSchema> {
  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const}]
  }, [blocks])

  return useBlockNote(
    {
      editable: false,
      renderType: 'embed',
      blockSchema: hmBlockSchema,
      linkExtensionOptions,
      // @ts-expect-error - EditorBlock/PartialBlock type mismatch
      initialContent,
      rootChildrenType: rootChildrenType || 'Group',
    },
    [initialContent, linkExtensionOptions, rootChildrenType],
  )
}

const MAX_EMBED_DEPTH = 3

export function EmbedEditorView({
  blocks,
  id,
  depth = 1,
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
  if (depth > MAX_EMBED_DEPTH) {
    return null
  }

  // Server rendering cannot mount the nested editor (ProseMirror needs a
  // browser); the SSR pipeline registers a recursive renderer producing the
  // same markup this editor will build at mount.
  const ssrRenderer = typeof window === 'undefined' ? getSSREmbedRenderer() : null
  if (ssrRenderer) {
    const html = ssrRenderer(blocks, rootChildrenType)
    if (html === null) return null
    return (
      <RenderResourceProvider resource={{kind: 'document', id}}>
        <div contentEditable={false} dangerouslySetInnerHTML={{__html: html}} />
      </RenderResourceProvider>
    )
  }

  return (
    <RenderResourceProvider resource={{kind: 'document', id}}>
      <div
        contentEditable={false}
        suppressContentEditableWarning
        onDragStart={(e) => {
          // Prevent the nested editor from interfering with the outer editor's drag
          e.stopPropagation()
          e.preventDefault()
        }}
      >
        <EmbedEditorInner
          blocks={blocks}
          focusBlockId={focusBlockId}
          blockRange={blockRange ?? undefined}
          rootChildrenType={rootChildrenType}
        />
      </div>
    </RenderResourceProvider>
  )
}

function EmbedEditorInner({
  blocks,
  focusBlockId,
  blockRange,
  rootChildrenType,
}: {
  blocks: HMBlockNode[]
  focusBlockId?: string
  blockRange?: BlockRange
  rootChildrenType?: HMBlockChildrenType
}) {
  const openUrl = useOpenUrl()
  const {hmUrlHref, openRouteNewWindow, origin, originHomeId} = useUniversalAppContext()
  const renderHref = useCallback(
    (url: string) =>
      hypermediaUrlToHref(url, {
        hmUrlHref,
        origin,
        originHomeId,
      }) || url,
    [hmUrlHref, origin, originHomeId],
  )
  const linkExtensionOptions = useMemo(
    () => ({
      openUrl,
      renderHref,
      handleModifiedClicks: !!openRouteNewWindow,
    }),
    [openUrl, renderHref, openRouteNewWindow],
  )
  const editor = useEmbedEditor(blocks, linkExtensionOptions, rootChildrenType)

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

  return (
    <BlockNoteView editor={editor} className="hm-prose">
      {/* No positioners/controllers for embed editors */}
      <></>
    </BlockNoteView>
  )
}
