import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements, monitorForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import '@shm/shared/styles/document.css'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {FormField} from '@shm/ui/forms'
import {HMDocURLInput} from '@shm/ui/hm-doc-url-input'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {ChevronDown, EllipsisVertical, Pencil, Plus, Trash} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useEffect, useRef, useState} from 'react'

function createEmptyNavigationItem(): HMNavigationItem {
  return {
    id: nanoid(),
    type: 'Link',
    text: '',
    link: '',
  }
}

export function EditNavPopover({
  docNav,
  editDocNav,
  homeId,
}: {
  docNav: HMNavigationItem[]
  editDocNav: (navigation: HMNavigationItem[]) => void
  homeId?: UnpackedHypermediaId
}) {
  const popover = usePopoverState(false)
  const isEmpty = docNav.length === 0
  return (
    <Popover {...popover}>
      <PopoverTrigger asChild className="no-window-drag">
        {isEmpty ? (
          <Button size="sm" variant="ghost">
            <Plus className="size-4" />
            Add Navigation Item
          </Button>
        ) : (
          <Button size="sm" variant="ghost">
            <Pencil className="size-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="max-h-[80vh] w-[420px] overflow-y-auto rounded-xl border border-black/8 bg-white p-0 dark:border-white/10 dark:bg-black">
        <EditNavigation docNav={docNav} onDocNav={editDocNav} homeId={homeId} />
      </PopoverContent>
    </Popover>
  )
}

function EditNavigation({
  docNav,
  onDocNav,
  homeId,
}: {
  docNav: HMNavigationItem[]
  onDocNav: (navigation: HMNavigationItem[]) => void
  homeId?: UnpackedHypermediaId
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const didAutoAdd = useRef(false)
  const [isDraggingOverId, setIsDraggingOverId] = useState<string | null>(null)
  const firstBlankItemId = docNav.find((item) => !item.text && !item.link)?.id ?? null
  const [expandedItemId, setExpandedItemId] = useState<string | null>(firstBlankItemId)
  const [autoFocusItemId, setAutoFocusItemId] = useState<string | null>(firstBlankItemId)

  useEffect(() => {
    if (!didAutoAdd.current && docNav.length === 0) {
      didAutoAdd.current = true
      onDocNav([createEmptyNavigationItem()])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const cleanup = monitorForElements({
      onDrag: ({location}) => {
        const over = location.current.dropTargets[0]
        if (over) {
          setIsDraggingOverId(over.data.id as string)
        } else {
          setIsDraggingOverId(null)
        }
      },
      onDrop: ({source, location}) => {
        setIsDraggingOverId(null)
        if (!location.current.dropTargets.length) {
          return
        }

        const over = location.current.dropTargets[0]
        const sourceIndex = docNav.findIndex((item) => item.id === source.data.id)
        const overIndex = docNav.findIndex((item) => item.id === over.data.id)

        if (sourceIndex === -1 || overIndex === -1) {
          return
        }

        const newItems = [...docNav]
        const [removed] = newItems.splice(sourceIndex, 1)
        newItems.splice(overIndex, 0, removed)
        onDocNav(newItems)
      },
    })

    return cleanup
  }, [docNav, onDocNav])

  useEffect(() => {
    if (expandedItemId && docNav.some((item) => item.id === expandedItemId)) return
    setExpandedItemId(docNav.find((item) => !item.text && !item.link)?.id ?? null)
  }, [docNav, expandedItemId])

  return (
    <div className="flex flex-col" ref={containerRef}>
      <div className="border-b border-black/8 px-4 py-3 dark:border-white/10">
        <div className="text-sm font-medium">Navigation</div>
        <div className="text-muted-foreground mt-1 text-xs">Choose the links shown in the top bar.</div>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {docNav.map((item) => {
          return (
            <DraggableNavItem
              key={item.id}
              item={item}
              homeId={homeId}
              filterPresets={(item) => {
                return !docNav.find((i) => i.link === item.link)
              }}
              onUpdate={(result) => {
                onDocNav(docNav.map((i) => (i.id === item.id ? result : i)))
              }}
              onRemove={() => {
                onDocNav(docNav.filter((i) => i.id !== item.id))
              }}
              isDraggingOver={isDraggingOverId === item.id}
              isExpanded={expandedItemId === item.id}
              onToggleExpanded={() => {
                setExpandedItemId((current) => (current === item.id ? null : item.id))
              }}
              autoFocusLabel={autoFocusItemId === item.id}
            />
          )
        })}

        {docNav.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground mt-1 justify-start px-2"
            onClick={() => {
              const newItem = createEmptyNavigationItem()
              setExpandedItemId(newItem.id)
              setAutoFocusItemId(newItem.id)
              onDocNav([...docNav, newItem])
            }}
          >
            <Plus className="size-4" />
            Add Navigation Item
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function DraggableNavItem({
  item,
  filterPresets,
  onUpdate,
  onRemove,
  homeId,
  isDraggingOver,
  isExpanded,
  onToggleExpanded,
  autoFocusLabel,
}: {
  item: HMNavigationItem
  filterPresets: (item: {link: string}) => boolean
  onUpdate: (item: HMNavigationItem) => void
  onRemove: () => void
  homeId?: UnpackedHypermediaId
  isDraggingOver: boolean
  isExpanded: boolean
  onToggleExpanded: () => void
  autoFocusLabel: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<HTMLDivElement>(null)
  const isIncomplete = !item.text.trim() || !item.link.trim()

  useEffect(() => {
    if (!dragHandleRef.current || !cardRef.current) return

    const cleanup = combine(
      draggable({
        element: dragHandleRef.current,
        getInitialData: () => {
          return {id: item.id}
        },
      }),
      dropTargetForElements({
        element: cardRef.current,
        getData: () => {
          return {id: item.id}
        },
      }),
    )

    return () => {
      cleanup()
    }
  }, [item.id])

  return (
    <div
      ref={cardRef}
      className={cn(
        'overflow-hidden rounded-lg border border-black/8 bg-white transition-colors dark:border-white/10 dark:bg-black',
        isDraggingOver && 'ring-primary/60 ring-2',
        isExpanded && 'border-primary/30 bg-muted/20',
      )}
    >
      <div
        className={cn(
          'hover:bg-muted/60 flex items-center gap-3 px-3 py-2.5 transition-colors',
          isExpanded && 'bg-muted/40',
        )}
        ref={dragHandleRef}
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: 'grab',
        }}
      >
        <div className="text-muted-foreground hover:text-foreground cursor-grab p-1 active:cursor-grabbing">
          <EllipsisVertical size={16} />
        </div>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onToggleExpanded}>
          <span
            className={cn('truncate text-sm font-medium select-none', item.text === '' ? 'text-muted-foreground' : '')}
          >
            {item.text || 'Untitled item'}
          </span>
          {isIncomplete ? (
            <span className="rounded-full border border-amber-300/60 bg-amber-100/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
              Incomplete
            </span>
          ) : null}
          <ChevronDown
            className={cn('text-muted-foreground ml-auto size-4 transition-transform', isExpanded && 'rotate-180')}
          />
        </button>
      </div>
      {isExpanded ? (
        <div className="border-t border-black/8 px-3 pt-2.5 pb-3 dark:border-white/10">
          <NavItemForm
            item={item}
            homeId={homeId}
            onUpdate={(result) => {
              onUpdate(result)
            }}
            onRemove={onRemove}
            filterPresets={filterPresets}
            autoFocusLabel={autoFocusLabel}
          />
        </div>
      ) : null}
    </div>
  )
}

function NavItemForm({
  item,
  onUpdate,
  onRemove,
  homeId,
  filterPresets,
  autoFocusLabel = false,
}: {
  item: HMNavigationItem
  onUpdate: (result: HMNavigationItem) => void
  onRemove?: () => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
  autoFocusLabel?: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <FormField name="link" label="Link">
        <HMDocURLInput
          link={item.link}
          onUpdate={(link, title) => onUpdate({...item, link, text: title})}
          homeId={homeId}
          filterPresets={filterPresets}
        />
      </FormField>
      <FormField name="label" label="Label">
        <Input
          autoFocus={autoFocusLabel}
          value={item?.text}
          id="label"
          onChange={(e) => onUpdate({...item, text: e.target.value})}
          placeholder="My Link…"
        />
      </FormField>
      <div className="flex justify-end pt-1">
        {onRemove && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive px-2"
            onClick={() => {
              onRemove()
            }}
          >
            <Trash className="mr-1 size-4" />
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
