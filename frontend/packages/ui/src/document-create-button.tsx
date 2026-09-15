import {ChevronDown, FilePlus2, FolderPlus, Grid3X3, Import, Plus} from 'lucide-react'
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
  onImport,
}: {
  hidden?: boolean
  disabled?: boolean
  showSubdocument?: boolean
  importLabel?: string
  onCreate: (kind: 'document' | 'collection' | 'subdocument') => void
  onImport: () => void
}) {
  if (hidden) return null

  return (
    <div className="border-border bg-background flex items-center overflow-hidden rounded-md border shadow-xs">
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
            className="border-border h-8 w-7 min-w-7 rounded-none border-l px-0"
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
