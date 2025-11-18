import {useListDirectory} from '@/models/documents'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {packHmId, SearchResult, unpackHmId, useSearch} from '@shm/shared'
import {HMNavigationItem, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import '@shm/shared/styles/document.css'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {FormField} from '@shm/ui/forms'
import {SearchResultItem} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {
  EllipsisVertical,
  Globe,
  Pencil,
  Plus,
  Search,
  Trash,
} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useEffect, useRef, useState} from 'react'

export function EditNavPopover({
  docNav,
  editDocNav,
  homeId,
}: {
  docNav: HMNavigationItem[]
  editDocNav: (navigation: HMNavigationItem[]) => void
  homeId?: UnpackedHypermediaId
}) {
  const popover = usePopoverState()
  return (
    <Popover {...popover}>
      <PopoverTrigger className="no-window-drag">
        <Button size="sm" variant="ghost">
          <Pencil className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[80vh] overflow-y-auto bg-white dark:bg-black">
        {/* <PopoverArrow borderWidth={1} borderColor="$borderColor" /> */}
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
  const [isDraggingOverId, setIsDraggingOverId] = useState<string | null>(null)

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
        const sourceIndex = docNav.findIndex(
          (item) => item.id === source.data.id,
        )
        // @ts-ignore
        const overIndex = docNav.findIndex((item) => item.id === over.data.id)

        if (sourceIndex === -1 || overIndex === -1) {
          return
        }

        const newItems = [...docNav]
        const [removed] = newItems.splice(sourceIndex, 1)
        // @ts-ignore
        newItems.splice(overIndex, 0, removed)
        onDocNav(newItems)
      },
    })

    return cleanup
  }, [docNav, onDocNav])

  return (
    <div className="flex flex-col gap-2" ref={containerRef}>
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
            initialOpen={item.text === '' && item.link === ''}
            isDraggingOver={isDraggingOverId === item.id}
          />
        )
      })}

      <div className="flex">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onDocNav([
              ...docNav,
              {
                id: nanoid(),
                type: 'Link',
                text: '',
                link: '',
              },
            ])
          }}
        >
          <Plus className="size-4" />
          Add Navigation Item
        </Button>
      </div>
    </div>
  )
}

function DraggableNavItem({
  item,
  filterPresets,
  onUpdate,
  onRemove,
  initialOpen,
  homeId,
  isDraggingOver,
}: {
  item: HMNavigationItem
  filterPresets: (item: {link: string}) => boolean
  onUpdate: (item: HMNavigationItem) => void
  onRemove: () => void
  initialOpen: boolean
  homeId?: UnpackedHypermediaId
  isDraggingOver: boolean
}) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!elementRef.current) {
      console.error('Element ref not ready')
      return
    }

    const cleanup = combine(
      draggable({
        element: elementRef.current,
        getInitialData: () => {
          return {id: item.id}
        },
      }),
      dropTargetForElements({
        element: elementRef.current,
        getData: () => {
          return {id: item.id}
        },
      }),
    )

    return () => {
      cleanup()
    }
  }, [item.id])

  const popoverState = usePopoverState(initialOpen)

  return (
    <div
      className={cn(
        'hover:bg-muted flex items-center justify-between rounded-md p-2',
        isDraggingOver && 'bg-muted ring-primary/60 ring-2',
      )}
      ref={elementRef}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'grab',
      }}
    >
      <div
        className="flex flex-1 items-center gap-2"
        onClick={() => {
          popoverState.onOpenChange(!popoverState.open)
        }}
      >
        <div className="rounded-1 hover:bg-color6 cursor-grab p-1 active:cursor-grabbing">
          <EllipsisVertical size={16} />
        </div>
        <span
          className={cn(
            'select-none',
            item.text === '' ? 'text-muted-foreground' : '',
          )}
        >
          {item.text || 'Untitled Document'}
        </span>
      </div>
      <Popover {...popoverState}>
        <PopoverTrigger>
          <Button size="sm" variant="ghost">
            <Pencil className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <NavItemForm
            item={item}
            homeId={homeId}
            onUpdate={(result) => {
              onUpdate(result)
            }}
            onRemove={onRemove}
            filterPresets={filterPresets}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function NavItemForm({
  item,
  onUpdate,
  onRemove,
  homeId,
  filterPresets,
}: {
  item: HMNavigationItem
  onUpdate: (result: HMNavigationItem) => void
  onRemove?: () => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <FormField name="link" label="Link">
        <HMDocURLInput
          link={item.link}
          onUpdate={(link, title) => onUpdate({...item, link, text: title})}
          homeId={homeId}
          filterPresets={filterPresets}
        />
      </FormField>
      <FormField name="label" label="Menu Item Label">
        <Input
          value={item?.text}
          id="label"
          onChange={(e) => onUpdate({...item, text: e.target.value})}
          placeholder="My Link..."
        />
      </FormField>

      <div className="flex flex-col gap-2">
        <Separator />

        <div className="flex justify-end">
          {onRemove && (
            <Tooltip content="Remove Navigation Item">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  onRemove()
                }}
              >
                <Trash className="size-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

function HMDocURLInput({
  link,
  onUpdate,
  homeId,
  filterPresets,
}: {
  link: string
  onUpdate: (link: string, title: string) => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const id = unpackHmId(link)
  const entity = useResource(id)
  let label = link || 'URL or Search Documents'
  let fontClass = 'text-muted-foreground'
  // @ts-expect-error
  if (link === entity.data?.id.id && entity.data?.document?.metadata.name) {
    fontClass = 'text-primary'
    // @ts-expect-error
    label = entity.data.document.metadata.name
  } else if (link) {
    label = link
  }
  const popoverState = usePopoverState()
  return (
    <>
      <Popover {...popoverState}>
        <PopoverTrigger asChild>
          <div
            className={cn(
              'border-color8 text-md bg-accent text-accent-foreground align-center line-clamp-1 w-full overflow-hidden rounded-sm border-1 p-1 px-3 text-clip',
              fontClass,
            )}
          >
            <span>{label}</span>
          </div>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <SearchUI
            onValue={onUpdate}
            homeId={homeId}
            onClose={() => popoverState.onOpenChange(false)}
            filterPresets={filterPresets}
          />
        </PopoverContent>
      </Popover>
    </>
  )
}

function SearchUI({
  onValue,
  onClose,
  homeId,
  filterPresets,
}: {
  onValue: (link: string, title: string) => void
  onClose: () => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isWebUrl = query.match(/^https?:\/\//)
  const search = useSearch(query, {enabled: !!query})
  const [focusedIndex, setFocusedIndex] = useState(0)
  const dirList = useListDirectory(homeId, {mode: 'Children'})
  const isSearching = !!query.length
  const Icon = isWebUrl ? Globe : Search
  const results: SearchResult[] = isSearching
    ? search?.data?.entities
        ?.sort((a, b) => Number(!!b.id.latest) - Number(!!a.id.latest))
        ?.map((item, index) => {
          const title = item.title || item.id.uid
          return {
            key: packHmId(item.id),
            title,
            path: item.parentNames,
            icon: item.icon,
            onFocus: () => {
              setFocusedIndex(index)
            },
            onMouseEnter: () => {
              setFocusedIndex(index)
            },
            onSelect: () => onValue(packHmId(item.id), item.title || ''),
            subtitle: 'Document',
            searchQuery: item.searchQuery,
            versionTime: item.versionTime
              ? item.versionTime.toDate().toLocaleString()
              : '',
          }
        })
        .filter(Boolean) ?? []
    : dirList.data?.map((d, index) => {
        const id = d.id.id
        return {
          key: id,
          title: d.metadata.name || '',
          path: d.path,
          icon: d.metadata.icon,
          onSelect: () => onValue(id, d.metadata.name || ''),
          subtitle: 'Document',
          searchQuery: query,
          onFocus: () => {
            setFocusedIndex(index)
          },
          onMouseEnter: () => {
            setFocusedIndex(index)
          },
        }
      }) ?? []

  return (
    <div className="z-50 max-h-[50vh] overflow-y-auto">
      <div className="border-color8 relative border-b-1 p-1">
        <Input
          autoFocus
          className="w-full rounded-sm p-2 pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }

            if (e.key === 'Enter') {
              if (query.match(/^https?:\/\//)) {
                onValue(query, '')
                setIsLoading(true)
                resolveHypermediaUrl(query)
                  .then((resolved) => {
                    if (resolved) {
                      onValue(resolved.id, resolved.title || '')
                    }
                    setIsLoading(false)
                    onClose()
                  })
                  .catch((e) => {
                    console.error(e)
                    onClose()
                  })
              } else {
                const selectedEntity = results[focusedIndex]
                if (selectedEntity) {
                  onValue(selectedEntity.key, selectedEntity.title || '')
                  onClose()
                }
              }
            }

            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setFocusedIndex(
                (prev) => (prev - 1 + results.length) % results.length,
              )
            }

            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setFocusedIndex((prev) => (prev + 1) % results.length)
            }
          }}
        />
        <Icon className="absolute top-1/2 left-3 -translate-y-1/2" size={20} />
      </div>
      {isLoading && (
        <div className="flex justify-center p-2">
          <Spinner />
        </div>
      )}
      {results.map((item, itemIndex) => {
        const isSelected = focusedIndex === itemIndex

        return (
          <SearchResultItem
            item={{
              ...item,
              path: item.path || [],
              onSelect: () => {
                onValue(item.key, item.title || '')
              },
              onFocus: () => setFocusedIndex(itemIndex),
              onMouseEnter: () => setFocusedIndex(itemIndex),
            }}
            selected={isSelected}
          />
        )
      })}
    </div>
  )
}
