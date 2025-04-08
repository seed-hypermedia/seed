import {
  BlockNoteEditor,
  BlockNoteEditorOptions,
  DefaultBlockSchema,
} from '@/blocknote/core'
import {HMBlockSchema} from '@/schema'
import {DependencyList, useMemo, useRef} from 'react'

const initEditor = <BSchema extends HMBlockSchema>(
  options: Partial<BlockNoteEditorOptions<BSchema>>,
) => new BlockNoteEditor<BSchema>(options)

/**
 * Main hook for importing a BlockNote editor into a React project
 */
export const useBlockNote = <
  BSchema extends HMBlockSchema = DefaultBlockSchema,
>(
  options: Partial<BlockNoteEditorOptions<BSchema>> = {},
  deps: DependencyList = [],
): BlockNoteEditor<BSchema> => {
  const editorRef = useRef<BlockNoteEditor<BSchema>>()

  return useMemo(() => {
    if (editorRef.current) {
      editorRef.current._tiptapEditor.destroy()
    }
    editorRef.current = initEditor(options)
    return editorRef.current
  }, deps) //eslint-disable-line react-hooks/exhaustive-deps
}
