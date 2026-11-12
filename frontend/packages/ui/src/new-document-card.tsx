import {Plus} from 'lucide-react'
import {cn} from './utils'

export interface NewDocumentCardProps {
  onCreateDraft: () => void
}

/** Thin full-width "New document" strip shown above a collection's Cards view, so it never takes a card slot. */
export function NewDocumentCard({onCreateDraft}: NewDocumentCardProps) {
  return (
    <button
      type="button"
      onClick={onCreateDraft}
      className={cn(
        'border-muted-foreground/25 text-muted-foreground flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed bg-white font-sans text-sm font-medium',
        'hover:border-muted-foreground/50 hover:bg-muted/30 hover:text-foreground transition-colors dark:bg-black',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <Plus className="size-4" />
      New document
    </button>
  )
}
