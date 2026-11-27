import {Blocks, Bot, ChevronDown, FilePlus2, FolderPlus, Grid3X3, Import, Plus, Wrench} from 'lucide-react'
import type {ReactNode} from 'react'
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
  onCreateApp,
  onCreateTool,
  onImport,
  options,
}: {
  hidden?: boolean
  disabled?: boolean
  showSubdocument?: boolean
  importLabel?: string
  onCreate: (kind: 'document' | 'collection' | 'subdocument') => void
  /** Opens agent creation at the same destination; omitted when no app environment is available. */
  onCreateAgent?: () => void
  /** Opens app creation at the same destination. */
  onCreateApp?: () => void
  /** Opens the creation of a tool that stands on its own at the same destination. */
  onCreateTool?: () => void
  onImport: () => void
  /**
   * Replaces the document kinds for a location that makes something else (an app makes tools):
   * New runs the first option and the menu lists them all.
   */
  options?: {key: string; label: string; icon: ReactNode; onSelect: () => void}[]
}) {
  if (hidden) return null
  const primary = options ? options[0]?.onSelect : () => onCreate('document')

  return (
    <div className="bg-background flex items-center overflow-hidden rounded-md border border-neutral-500 shadow-xs">
      <Button
        type="button"
        size="sm"
        disabled={disabled || !primary}
        aria-label="New"
        className="h-8 gap-1.5 rounded-none pr-3 pl-2.5 has-[>svg]:pr-3 has-[>svg]:pl-2.5"
        onClick={primary}
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">New</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            disabled={disabled}
            aria-label="Choose what to create"
            className="h-8 w-7 min-w-7 rounded-none border-l border-neutral-500 px-0 has-[>svg]:px-0"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {options ? (
            options.map((option) => (
              <DropdownMenuItem key={option.key} onSelect={option.onSelect}>
                {option.icon}
                {option.label}
              </DropdownMenuItem>
            ))
          ) : (
            <>
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
              {onCreateApp ? (
                <DropdownMenuItem onSelect={onCreateApp}>
                  <Blocks className="size-4" />
                  App
                </DropdownMenuItem>
              ) : null}
              {onCreateTool ? (
                <DropdownMenuItem onSelect={onCreateTool}>
                  <Wrench className="size-4" />
                  Tool
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onImport}>
                <Import className="size-4" />
                {importLabel}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
