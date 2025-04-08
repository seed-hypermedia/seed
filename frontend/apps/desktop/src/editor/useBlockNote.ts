import {HMBlockSchema} from '@/editor/schema'
import {
  BlockNoteEditorOptions,
  DefaultBlockSchema,
} from '@shm/editor/blocknote/core'
import {DependencyList, useMemo, useRef} from 'react'
import {BlockNoteEditor} from './BlockNoteEditor'

const initEditor = <BSchema extends HMBlockSchema>(
  options: BlockNoteEditorOptions<BSchema>,
) => new BlockNoteEditor<BSchema>(options)

/**
 * Main hook for importing a BlockNote editor into a React project
 */
export const useBlockNote = <
  BSchema extends HMBlockSchema = DefaultBlockSchema,
>(
  options: BlockNoteEditorOptions<BSchema>,
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
