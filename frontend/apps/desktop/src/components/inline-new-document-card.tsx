import {useDeleteDraft, useUpdateDraftMetadata} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {HMListedDraft} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {DraftBadge} from '@shm/ui/draft-badge'
import {toast} from '@shm/ui/toast'
import {ImageIcon, MoreVertical, Pencil, Trash2} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'

export function InlineNewDocumentCard({draft, autoFocus}: {draft: HMListedDraft; autoFocus?: boolean}) {
  const navigate = useNavigate()
  const deleteDraft = useDeleteDraft()
  const updateMetadata = useUpdateDraftMetadata()
  const [title, setTitle] = useState(draft.metadata?.name || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  // Sync external changes
  useEffect(() => {
    setTitle(draft.metadata?.name || '')
  }, [draft.metadata?.name])

  const saveName = useCallback(
    (name: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        updateMetadata.mutate(
          {draftId: draft.id, metadata: {name}},
          {
            onError: () => {
              toast.error('Failed to save draft title')
            },
          },
        )
      }, 500)
    },
    [draft.id, updateMetadata],
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const openDraft = useCallback(() => {
    // Cancel any pending debounced save to prevent duplicate mutations
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = undefined
    }
    // Flush save then navigate
    updateMetadata.mutate(
      {draftId: draft.id, metadata: {name: title}},
      {
        onSuccess: () => navigate({key: 'draft', id: draft.id}),
        onError: () => {
          toast.error('Failed to save draft title')
          navigate({key: 'draft', id: draft.id})
        },
      },
    )
  }, [navigate, draft.id, title, updateMetadata])

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
    <div className="@container flex min-h-[200px] flex-1 overflow-hidden rounded-lg border-2 border-dashed border-yellow-400/50 bg-white shadow-sm transition-colors duration-300 dark:bg-black">
      <div className="flex max-w-full flex-1 flex-col @md:flex-row">
        {/* Image placeholder */}
        <div
          className="relative flex h-40 w-full shrink-0 cursor-pointer items-center justify-center bg-gray-50 @md:h-auto @md:w-1/2 dark:bg-gray-900"
          onClick={openDraft}
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
                placeholder="Untitled document"
                className="text-foreground block w-full border-none bg-transparent font-sans text-lg leading-tight font-bold outline-none placeholder:text-gray-400"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <DraftBadge />
            </div>
          </div>
          <div className="flex items-center justify-between py-3 pr-2 pl-4">
            <Button variant="ghost" size="sm" onClick={openDraft} className="gap-1">
              <Pencil className="size-3" />
              Edit
            </Button>
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
                <DropdownMenuItem className="text-destructive" onClick={() => deleteDraft.mutate(draft.id)}>
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
