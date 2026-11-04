import {Bot, ChevronDown, FilePlus2, FolderPlus, Grid3X3, Import, Plus} from 'lucide-react'
import {Button} from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/dropdown-menu'

/** Split-button presentation for contextual document creation. */
export function DocumentCreateButton({
  hidden = false,
  disabled = false,
  showSubdocument = false,
  importLabel = 'Import',
  onCreate,
  onCreateAgent,
  onImport,
}: {
  hidden?: boolean
  disabled?: boolean
  showSubdocument?: boolean
  importLabel?: string
  onCreate: (kind: 'document' | 'collection' | 'subdocument') => void
  /** Opens agent creation at the same destination; omitted when no agent server is available. */
  onCreateAgent?: () => void
  onImport: () => void
}) {
  if (hidden) return null

  return (
    <div className="bg-background flex items-center overflow-hidden rounded-md border border-green-900 shadow-xs dark:border-green-700">
      <Button type="button" size="sm" disabled={disabled} className="rounded-none" onClick={() => onCreate('document')}>
        <Plus className="size-4" />
        New
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            disabled={disabled}
            aria-label="Choose what to create"
            className="h-8 w-7 min-w-7 rounded-none border-l border-green-900 px-0 dark:border-green-700"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onCreate('document')}>
            <FilePlus2 className="size-4" />
            Document
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate('collection')}>
            <Grid3X3 className="size-4" />
            Collection
          </DropdownMenuItem>
          {showSubdocument ? (
            <DropdownMenuItem onSelect={() => onCreate('subdocument')}>
              <FolderPlus className="size-4" />
              Subdocument
            </DropdownMenuItem>
          ) : null}
          {onCreateAgent ? (
            <DropdownMenuItem onSelect={onCreateAgent}>
              <Bot className="size-4" />
              Agent
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onImport}>
            <Import className="size-4" />
            {importLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
