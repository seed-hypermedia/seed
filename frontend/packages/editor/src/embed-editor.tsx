import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {useMemo} from 'react'
import {BlockNoteEditor, useBlockNote} from './blocknote'
import {BlockNoteView} from './blocknote/react/BlockNoteView'
import {hmBlockSchema, HMBlockSchema} from './schema'

export function useEmbedEditor(blocks: HMBlockNode[]): BlockNoteEditor<HMBlockSchema> {
  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const, id: 'empty'}]
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

export function EmbedEditorView({blocks, depth = 1}: {blocks: HMBlockNode[]; depth?: number}) {
  if (depth > MAX_EMBED_DEPTH) {
    return null
  }

  return (
    <div
      contentEditable={false}
      suppressContentEditableWarning
      onDragStart={(e) => {
        // Prevent the nested editor from interfering with the outer editor's drag
        e.stopPropagation()
        e.preventDefault()
      }}
    >
      <EmbedEditorInner blocks={blocks} />
    </div>
  )
}

function EmbedEditorInner({blocks}: {blocks: HMBlockNode[]}) {
  const editor = useEmbedEditor(blocks)

  return (
    <BlockNoteView editor={editor} className="hm-prose">
      {/* No positioners/controllers for embed editors */}
      <></>
    </BlockNoteView>
  )
}
