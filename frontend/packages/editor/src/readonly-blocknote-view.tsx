import {BlockNoteEditor, BlockSchema} from './blocknote/core'
import {EditorContent} from '@tiptap/react'
import {HTMLAttributes, ReactNode} from 'react'

let nextEditorViewKey = 0
const editorViewKeys = new WeakMap<object, number>()

/**
 * Stable per-instance key for an editor. Assigning a key to `EditorContent`
 * forces a remount when `useBlockNote` swaps in a new editor instance.
 *
 * Without it, @tiptap/react reuses the same `PureEditorContent` instance and its
 * `initialized` flag stays `true` from the previous editor, so the new editor's
 * `createNodeViews()` — called from `componentDidUpdate` — registers node views
 * through `flushSync`, which React rejects during a lifecycle method. Remounting
 * resets `initialized` to `false`, so registration happens synchronously instead.
 */
function getEditorViewKey(editor: object): number {
  let key = editorViewKeys.get(editor)
  if (key === undefined) {
    key = nextEditorViewKey++
    editorViewKeys.set(editor, key)
  }
  return key
}

/**
 * Minimal BlockNote view that renders EditorContent without MantineProvider.
 * Use for read-only viewer contexts (feed, comments, embeds) where no editing
 * UI is needed and Mantine context overhead should be avoided.
 */
export function ReadOnlyBlockNoteView<BSchema extends BlockSchema>({
  editor,
  children,
  className,
  ...rest
}: {
  editor: BlockNoteEditor<BSchema>
  children?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <EditorContent key={getEditorViewKey(editor)} editor={editor._tiptapEditor || null} className={className} {...rest}>
      {children ?? <></>}
    </EditorContent>
  )
}
