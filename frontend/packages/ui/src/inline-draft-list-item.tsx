import {HMListedDraft} from '@seed-hypermedia/client/hm-types'
import {FileText, MoreVertical, MoreHorizontal, Forward, Pencil, Trash2} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Button} from './button'
import {DraftBadge} from './draft-badge'
import {OptionsDropdown} from './options-dropdown'
import {cn} from './utils'
import {TableCell, TableRow} from './components/table'

export interface InlineDraftListItemProps {
  draft: HMListedDraft
  autoFocus?: boolean
  /** Visible table columns; when set, renders a row with a separate actions cell. */
  tableColumns?: {id: string; size: number}[]
  onOpenDraft: (draftId: string) => void
  onDeleteDraft: (draftId: string) => void
  onMoveDraft?: (draftId: string) => void
  onUpdateDraftName: (draftId: string, name: string) => void
}

export function InlineDraftListItem({
  draft,
  autoFocus,
  tableColumns,
  onOpenDraft,
  onDeleteDraft,
  onMoveDraft,
  onUpdateDraftName,
}: InlineDraftListItemProps) {
  const inTable = !!tableColumns
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
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      openDraft()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      inputRef.current?.blur()
    }
  }

  const actions = (
    <div className={cn('flex items-center gap-1', inTable && 'justify-end')} onClick={(e) => e.stopPropagation()}>
      <OptionsDropdown
        align="end"
        button={
          <Button variant="ghost" size="iconSm" aria-label="Draft options">
            {inTable ? <MoreHorizontal className="size-4" /> : <MoreVertical className="size-4" />}
          </Button>
        }
        menuItems={[
          {
            key: 'open',
            label: 'Open Draft',
            icon: <Pencil className="size-4" />,
            onClick: openDraft,
          },
          ...(onMoveDraft
            ? [
                {
                  key: 'move',
                  label: 'Move',
                  icon: <Forward className="size-4" />,
                  onClick: () => onMoveDraft(draft.id),
                },
              ]
            : []),
          {
            key: 'delete',
            label: 'Delete Draft',
            icon: <Trash2 className="size-4" />,
            variant: 'destructive',
            onClick: () => onDeleteDraft(draft.id),
          },
        ]}
      />
    </div>
  )

  const content = (
    <div
      ref={containerRef}
      onClick={(e) => {
        e.stopPropagation()
        openDraft()
      }}
      className={cn(
        'group/item flex w-full cursor-pointer items-center',
        !inTable && 'rounded border-2 border-dashed border-yellow-400/50 bg-white px-4 py-2 shadow-sm dark:bg-black',
      )}
    >
      <FileText className={cn('text-muted-foreground shrink-0', inTable ? 'mr-2 size-4' : 'mr-3 size-7')} />
      <div className={cn('flex flex-1 items-center overflow-hidden', inTable ? 'gap-1' : 'gap-3')}>
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder="Untitled document"
            aria-label="Draft name"
            style={inTable ? {width: `${(title || 'Untitled document').length}ch`} : undefined}
            className={cn(
              'text-foreground border-none bg-transparent font-sans text-sm outline-none placeholder:text-gray-400',
              inTable ? 'max-w-full min-w-0 truncate font-medium' : 'w-full font-bold',
            )}
          />
          <DraftBadge className="shrink-0" />
        </div>
        {!inTable && actions}
      </div>
    </div>
  )

  if (tableColumns) {
    return (
      <TableRow>
        {tableColumns.map((column) => (
          <TableCell
            key={column.id}
            className={cn('overflow-hidden', column.id === 'title' && 'bg-background sticky left-0 z-10')}
            style={{width: column.size}}
          >
            {column.id === 'title' ? content : null}
          </TableCell>
        ))}
        <TableCell className="bg-background sticky right-0 z-10 w-12">{actions}</TableCell>
      </TableRow>
    )
  }
  return content
}
