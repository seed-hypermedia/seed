import {HMBlockSchema} from '@/editor/schema'
import {
  BlockNoteEditor,
  BlockNoteEditorOptions,
  defaultBlockSchema,
  DefaultBlockSchema,
} from '@shm/editor/blocknote/core'
import {getDefaultReactSlashMenuItems} from '@shm/editor/blocknote/react/SlashMenu/defaultReactSlashMenuItems'
import {DependencyList, useMemo, useRef} from 'react'

const initEditor = <BSchema extends HMBlockSchema>(
  options: Partial<BlockNoteEditorOptions<BSchema>>,
) =>
  new BlockNoteEditor<BSchema>({
    slashMenuItems: getDefaultReactSlashMenuItems<BSchema | DefaultBlockSchema>(
      options.blockSchema || defaultBlockSchema,
    ),
    ...options,
  })

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
