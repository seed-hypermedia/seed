import {Button} from '@shm/ui/button'
import {Plus} from 'lucide-react'
import {addBlockAtEnd} from './add-block-at-end'
import type {HyperMediaEditor} from './types'

/**
 * Renders the circular "+" button shown beneath the document.
 *
 * - In edit mode: inserts an empty block at the end and opens the slash menu.
 * - In read-only mode (`onEditStart` provided): triggers the read→edit
 *   transition. The caller is responsible for calling `addBlockAtEnd` after
 *   the editor becomes editable (see DocumentEditor's justEnteredEditing
 *   effect).
 */
export function AddBlockAtEndButton({editor, onEditStart}: {editor: HyperMediaEditor; onEditStart?: () => void}) {
  const isEditable = editor.isEditable
  return (
    <Button
      size="icon"
      variant="outline"
      className="text-muted-foreground hover:bg-primary mt-2 flex size-6 h-7 w-7 min-w-6 scale-95 items-center justify-center rounded-full transition-all hover:scale-110 hover:text-white active:scale-95"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!isEditable && onEditStart) {
          onEditStart()
          return
        }
        addBlockAtEnd(editor)
      }}
      title="Add a block"
      aria-label="Add a block at the end of the document"
    >
      <Plus className="size-4" />
    </Button>
  )
}
