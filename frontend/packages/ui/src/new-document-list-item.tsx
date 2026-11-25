import {Plus} from 'lucide-react'
import {cn} from './utils'

export interface NewDocumentListItemProps {
  onCreateDraft: () => void
}

/** Compact "New document" row shown first in a collection's List view. */
export function NewDocumentListItem({onCreateDraft}: NewDocumentListItemProps) {
  return (
    <button
      type="button"
      onClick={onCreateDraft}
      className={cn(
        'group border-border text-muted-foreground flex w-full cursor-pointer items-center gap-3 border-b bg-white px-4 py-3 text-left font-sans font-medium',
        'hover:bg-muted/30 hover:text-foreground transition-colors dark:bg-black',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
      )}
    >
      <span className="border-muted-foreground/30 group-hover:border-muted-foreground/60 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-[1.5px] border-dashed">
        <Plus className="size-4" />
      </span>
      New document
    </button>
  )
}
