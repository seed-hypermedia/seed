import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {ArrowLeft, Link, MessageSquare, MoreHorizontal, Trash2, Upload} from 'lucide-react'
import {KeyboardEvent, useState} from 'react'

export type MediaSelectionMenuProps = {
  /** Copy link action */
  onCopyLink?: () => void
  /** Comment on block action */
  onComment?: () => void
  /** Open the file picker for replacing the media with local upload */
  onReplaceFile: () => void
  /** Submit an external URL action */
  onSubmitUrl: (url: string) => void
  /** Remove the block from the editor */
  onDelete: () => void
  /** Current URL stored on the block */
  currentUrl: string
  /** Label for the URL menu item */
  urlMenuLabel: string
  /** Placeholder text for the URL input */
  urlInputPlaceholder?: string
  /** Label for the delete menu item */
  deleteLabel?: string
  /** Prefix used on data-testid attributes */
  testIdPrefix?: string
}

/** Floating selection toolbar for a selected media block */
function displayableUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('ipfs://') || url.startsWith('blob:') || url.startsWith('data:')) return ''
  return url
}

export function MediaSelectionMenu({
  onCopyLink,
  onComment,
  onReplaceFile,
  onSubmitUrl,
  onDelete,
  currentUrl,
  urlMenuLabel,
  urlInputPlaceholder,
  deleteLabel,
  testIdPrefix,
}: MediaSelectionMenuProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [mode, setMode] = useState<'main' | 'url'>('main')
  const [urlInput, setUrlInput] = useState(() => displayableUrl(currentUrl))

  const testId = (suffix: string) => (testIdPrefix ? `${testIdPrefix}-${suffix}` : suffix)

  const resetAndClose = () => {
    setDropdownOpen(false)
    // Defer the mode reset so the menu can fully close before the next open
    setTimeout(() => setMode('main'), 0)
  }

  const handleSubmit = () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    onSubmitUrl(trimmed)
    resetAndClose()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMode('main')
    }
  }

  return (
    <div
      className={cn(
        'bg-background border-border z-20 flex items-center gap-1 rounded-md border p-1 shadow-md',
        'dark:bg-neutral-900',
      )}
      data-testid={testId('selection-menu')}
      // Selection menu shouldn't bubble pointer events into the editor and
      // accidentally move the cursor or kill the block selection.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {onCopyLink && (
        <Tooltip content="Copy block link">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid={testId('copy-link')}
            className="hover:bg-black/10 dark:hover:bg-white/10"
            onClick={onCopyLink}
          >
            <Link className="size-4" />
          </Button>
        </Tooltip>
      )}
      {onComment && (
        <Tooltip content="Comment on block">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid={testId('comment')}
            className="hover:bg-black/10 dark:hover:bg-white/10"
            onClick={onComment}
          >
            <MessageSquare className="size-4" />
          </Button>
        </Tooltip>
      )}

      <DropdownMenu
        open={dropdownOpen}
        onOpenChange={(open) => {
          setDropdownOpen(open)
          if (!open) setTimeout(() => setMode('main'), 0)
          if (open) setUrlInput(displayableUrl(currentUrl))
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid={testId('more')}
            className="hover:bg-black/10 dark:hover:bg-white/10"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-64">
          {mode === 'main' ? (
            <>
              <DropdownMenuItem
                data-testid={testId('replace')}
                onSelect={() => {
                  onReplaceFile()
                  resetAndClose()
                }}
              >
                <Upload className="size-4" />
                <span>Replace</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid={testId('open-url-input')}
                onSelect={(e) => {
                  e.preventDefault()
                  setMode('url')
                }}
              >
                <Link className="size-4" />
                <span>{urlMenuLabel}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuItem
                data-testid={testId('delete')}
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  onDelete()
                  resetAndClose()
                }}
              >
                <Trash2 className="size-4" />
                <span>{deleteLabel ?? 'Delete'}</span>
              </DropdownMenuItem>
            </>
          ) : (
            <div className="flex flex-col gap-2 p-1" onKeyDown={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  data-testid={testId('url-back')}
                  className="size-7 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={() => setMode('main')}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {urlMenuLabel}
                </span>
              </div>
              <input
                type="url"
                autoFocus
                data-testid={testId('url-input')}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={urlInputPlaceholder ?? 'Paste a URL'}
                className={cn(
                  'border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm outline-none',
                  'focus:ring-ring focus:ring-2',
                )}
              />
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid={testId('url-cancel')}
                  onClick={() => setMode('main')}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  data-testid={testId('url-submit')}
                  onClick={handleSubmit}
                  disabled={!urlInput.trim()}
                >
                  Embed
                </Button>
              </div>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
