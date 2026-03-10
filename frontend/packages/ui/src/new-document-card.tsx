import {Plus} from 'lucide-react'
import {cn} from './utils'

export interface NewDocumentCardProps {
  onCreateDraft: () => void
}

export function NewDocumentCard({onCreateDraft}: NewDocumentCardProps) {
  return (
    <button
      onClick={onCreateDraft}
      className={cn(
        'flex min-h-[200px] flex-1 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed',
        'border-muted-foreground/25 bg-white transition-colors duration-200',
        'hover:border-muted-foreground/50 hover:bg-muted/30',
        'dark:hover:bg-muted/20 dark:bg-black',
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <Plus className="text-muted-foreground size-8" />
        <span className="text-muted-foreground text-sm font-medium">New Document</span>
      </div>
    </button>
  )
}
