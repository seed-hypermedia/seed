import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {BlockRange, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {RenderResourceProvider} from '@shm/shared'
import {useEffect, useMemo} from 'react'
import {BlockNoteEditor, useBlockNote} from './blocknote'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import {BlockNoteView} from './blocknote/react/BlockNoteView'
import {hmBlockSchema, HMBlockSchema} from './schema'

export function useEmbedEditor(blocks: HMBlockNode[]): BlockNoteEditor<HMBlockSchema> {
  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const}]
  }, [blocks])

  return useBlockNote(
    {
      editable: false,
      renderType: 'embed',
      blockSchema: hmBlockSchema,
      // @ts-expect-error - EditorBlock/PartialBlock type mismatch
      initialContent,
    },
    [initialContent],
  )
}

const MAX_EMBED_DEPTH = 3

export function EmbedEditorView({
  blocks,
  id,
  depth = 1,
  focusBlockId,
  blockRange,
}: {
  blocks: HMBlockNode[]
  id: UnpackedHypermediaId
  depth?: number
  /** Block id within the embedded content to focus-highlight. */
  focusBlockId?: string
  /** Codepoint range within `focusBlockId` to highlight instead of the whole block. */
  blockRange?: BlockRange | null
}) {
  if (depth > MAX_EMBED_DEPTH) {
    return null
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
        <EmbedEditorInner blocks={blocks} focusBlockId={focusBlockId} blockRange={blockRange ?? undefined} />
      </div>
    </RenderResourceProvider>
  )
}

function EmbedEditorInner({
  blocks,
  focusBlockId,
  blockRange,
}: {
  blocks: HMBlockNode[]
  focusBlockId?: string
  blockRange?: BlockRange
}) {
  const editor = useEmbedEditor(blocks)

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
