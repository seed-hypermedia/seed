import {HMListedDraft} from '@shm/shared/hm-types'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {DraftBadge} from './draft-badge'
import {FileText, MoreVertical, Pencil, Trash2} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'

export interface InlineDraftListItemProps {
  draft: HMListedDraft
  autoFocus?: boolean
  onOpenDraft: (draftId: string) => void
  onDeleteDraft: (draftId: string) => void
  onUpdateDraftName: (draftId: string, name: string) => void
}

export function InlineDraftListItem({
  draft,
  autoFocus,
  onOpenDraft,
  onDeleteDraft,
  onUpdateDraftName,
}: InlineDraftListItemProps) {
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
      onClick={(e) => e.stopPropagation()}
      className="group/item flex w-full items-center rounded border-2 border-dashed border-yellow-400/50 bg-white px-4 py-2 shadow-sm dark:bg-black"
    >
      <FileText className="text-muted-foreground mr-3 size-7 shrink-0" />
      <div className="flex flex-1 items-center gap-3 overflow-hidden">
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleKeyDown}
            placeholder="Untitled document"
            className="text-foreground w-full border-none bg-transparent font-sans text-sm font-bold outline-none placeholder:text-gray-400"
          />
          <DraftBadge />
        </div>
        <div className="flex items-center gap-1">
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
  )
}
