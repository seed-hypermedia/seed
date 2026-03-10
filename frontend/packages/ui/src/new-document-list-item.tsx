import {Plus} from 'lucide-react'
import {SizableText} from './text'
import {cn} from './utils'

export interface NewDocumentListItemProps {
  onCreateDraft: () => void
}

export function NewDocumentListItem({onCreateDraft}: NewDocumentListItemProps) {
  return (
    <button
      onClick={onCreateDraft}
      className={cn(
        'flex w-full items-center rounded border-2 border-dashed',
        'border-muted-foreground/25 bg-white px-4 py-2 transition-colors duration-200',
        'hover:border-muted-foreground/50 hover:bg-muted/30',
        'dark:hover:bg-muted/20 dark:bg-black',
        'cursor-pointer',
      )}
    >
      <Plus className="text-muted-foreground mr-3 size-7 shrink-0" />
      <SizableText size="sm" className="text-muted-foreground font-medium">
        New Document
      </SizableText>
    </button>
  )
}
