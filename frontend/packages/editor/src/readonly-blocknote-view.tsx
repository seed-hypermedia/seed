import {BlockNoteEditor, BlockSchema} from './blocknote/core'
import {EditorContent} from '@tiptap/react'
import {HTMLAttributes, ReactNode} from 'react'

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
    <EditorContent editor={editor._tiptapEditor || null} className={className} {...rest}>
      {children ?? <></>}
    </EditorContent>
  )
}
