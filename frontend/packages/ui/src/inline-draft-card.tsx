import {HMListedDraft} from '@shm/shared/hm-types'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {DraftBadge} from './draft-badge'
import {cn} from './utils'
import {ImageIcon, MoreVertical, Pencil, Trash2} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'

export interface InlineDraftCardProps {
  draft: HMListedDraft
  autoFocus?: boolean
  banner?: boolean
  onOpenDraft: (draftId: string) => void
  onDeleteDraft: (draftId: string) => void
  onUpdateDraftName: (draftId: string, name: string) => void
}

export function InlineDraftCard({
  draft,
  autoFocus,
  banner,
  onOpenDraft,
  onDeleteDraft,
  onUpdateDraftName,
}: InlineDraftCardProps) {
  const [title, setTitle] = useState(draft.metadata?.name || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!autoFocus || !containerRef.current) return
    containerRef.current.scrollIntoView({behavior: 'smooth', block: 'nearest'})
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 300)
    return () => clearTimeout(timer)
  }, [autoFocus])

  // Sync external changes
  useEffect(() => {
    setTitle(draft.metadata?.name || '')
  }, [draft.metadata?.name])

  const saveName = useCallback(
    (name: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        onUpdateDraftName(draft.id, name)
      }, 500)
    },
    [draft.id, onUpdateDraftName],
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const openDraft = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = undefined
    }
    onUpdateDraftName(draft.id, title)
    onOpenDraft(draft.id)
  }, [draft.id, title, onOpenDraft, onUpdateDraftName])

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setTitle(val)
    saveName(val)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      openDraft()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      inputRef.current?.blur()
    }
  }

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        e.stopPropagation()
        openDraft()
      }}
      className={cn(
        '@container flex min-h-[200px] flex-1 cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-yellow-400/50 bg-white shadow-sm transition-colors duration-300 dark:bg-black',
        banner && 'rounded-xl md:min-h-[240px] lg:min-h-[280px]',
      )}
    >
      <div className="flex max-w-full flex-1 flex-col @md:flex-row">
        {/* Image placeholder */}
        <div
          className={cn(
            'relative flex h-40 w-full shrink-0 items-center justify-center bg-gray-50 @md:h-auto @md:w-1/2 dark:bg-gray-900',
            banner && '@md:h-auto',
          )}
        >
          <ImageIcon className="text-muted-foreground size-12 opacity-30" />
        </div>
        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col justify-between">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={handleTitleChange}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                placeholder="Untitled document"
                className={cn(
                  'text-foreground block w-full border-none bg-transparent font-sans leading-tight font-bold outline-none placeholder:text-gray-400',
                  banner ? 'text-2xl' : 'text-lg',
                )}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <DraftBadge />
            </div>
          </div>
          <div className="flex items-center justify-end py-3 pr-2 pl-4" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="iconSm">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openDraft}>
                  <Pencil className="size-4" />
                  Open Draft
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => onDeleteDraft(draft.id)}>
                  <Trash2 className="size-4" />
                  Delete Draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}
