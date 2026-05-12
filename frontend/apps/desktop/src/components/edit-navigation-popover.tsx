import React from 'react'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements, monitorForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {packHmId, SearchResult, unpackHmId, useSearch} from '@shm/shared'
import {useDirectory} from '@shm/shared/models/entity'
import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import '@shm/shared/styles/document.css'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {FormField} from '@shm/ui/forms'
import {SearchResultItem} from '@shm/ui/search'
import {Spinner} from '@shm/ui/spinner'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {ChevronDown, EllipsisVertical, Globe, Pencil, Plus, Search, Trash} from 'lucide-react'
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

function getDisplayValueForLink(link: string) {
  if (!link) return ''
  const unpackedLink = unpackHmId(link)
  return unpackedLink ? `/${unpackedLink.path?.join('/') || ''}` : link
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
      <PopoverTrigger className="no-window-drag">
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
          placeholder="My Link..."
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
  const [query, setQuery] = useState(getDisplayValueForLink(link))
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [activeSelection, setActiveSelection] = useState<{
    link: string
    title: string
  } | null>(null)
  const [isResolvingUrl, setIsResolvingUrl] = useState(false)
  const displayValue = getDisplayValueForLink(link)
  const isWebUrl = /^https?:\/\//.test(query.trim())
  const Icon = isWebUrl ? Globe : Search

  useEffect(() => {
    setQuery(displayValue)
  }, [displayValue])

  function closeAndReset() {
    setIsOpen(false)
    setFocusedIndex(0)
    setActiveSelection(null)
    setQuery(displayValue)
    setIsResolvingUrl(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          aria-label="Link"
          className={cn('pl-9', link ? 'text-primary' : 'text-muted-foreground')}
          value={query}
          placeholder="Search documents or paste URL"
          onFocus={() => {
            setIsOpen(true)
            setFocusedIndex(0)
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (
                document.activeElement instanceof HTMLElement &&
                document.activeElement.dataset.navLinkResult === 'true'
              ) {
                return
              }
              closeAndReset()
            }, 0)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
            setFocusedIndex(0)
          }}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              closeAndReset()
              return
            }

            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setFocusedIndex((prev) => prev - 1)
              return
            }

            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setFocusedIndex((prev) => prev + 1)
              return
            }

            if (e.key !== 'Enter') return

            const trimmedQuery = query.trim()
            if (!trimmedQuery) return

            e.preventDefault()

            if (/^https?:\/\//.test(trimmedQuery)) {
              onUpdate(trimmedQuery, trimmedQuery)
              setIsResolvingUrl(true)
              try {
                const resolved = await resolveHypermediaUrl(trimmedQuery)
                if (resolved) {
                  onUpdate(resolved.id, resolved.title || trimmedQuery)
                }
              } catch (error) {
                console.error(error)
              } finally {
                setIsResolvingUrl(false)
                setIsOpen(false)
                setActiveSelection(null)
              }
              return
            }

            if (activeSelection) {
              onUpdate(activeSelection.link, activeSelection.title)
              setQuery(getDisplayValueForLink(activeSelection.link))
              setIsOpen(false)
              setFocusedIndex(0)
              setActiveSelection(null)
            }
          }}
        />
      </div>
      {isOpen ? (
        <SearchUI
          query={query}
          focusedIndex={focusedIndex}
          isResolvingUrl={isResolvingUrl}
          onActiveResultChange={setActiveSelection}
          onFocusedIndexChange={setFocusedIndex}
          onValue={(nextLink, title) => {
            onUpdate(nextLink, title)
            setQuery(getDisplayValueForLink(nextLink))
            setIsOpen(false)
            setFocusedIndex(0)
            setActiveSelection(null)
            setIsResolvingUrl(false)
          }}
          homeId={homeId}
          filterPresets={filterPresets}
        />
      ) : null}
    </div>
  )
}

function SearchUI({
  query,
  focusedIndex,
  isResolvingUrl,
  onActiveResultChange,
  onFocusedIndexChange,
  onValue,
  homeId,
  filterPresets,
}: {
  query: string
  focusedIndex: number
  isResolvingUrl: boolean
  onActiveResultChange: (result: {link: string; title: string} | null) => void
  onFocusedIndexChange: (index: number | ((prev: number) => number)) => void
  onValue: (link: string, title: string) => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const trimmedQuery = query.trim()
  const isWebUrl = /^https?:\/\//.test(trimmedQuery)
  const isSearching = !!trimmedQuery.length
  const search = useSearch(query, {enabled: isSearching && !isWebUrl})
  const dirList = useDirectory(homeId, {mode: 'Children'})
  const results: SearchResult[] = (
    isSearching
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
                onFocusedIndexChange(index)
              },
              onMouseEnter: () => {
                onFocusedIndexChange(index)
              },
              onSelect: () => onValue(packHmId(item.id), item.title || ''),
              subtitle: 'Document',
              searchQuery: item.searchQuery,
              versionTime: item.versionTime || '',
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
              onFocusedIndexChange(index)
            },
            onMouseEnter: () => {
              onFocusedIndexChange(index)
            },
          }
        }) ?? []
  ).filter((item) => filterPresets({link: item.key}))

  const normalizedFocusedIndex =
    results.length > 0 ? ((focusedIndex % results.length) + results.length) % results.length : 0

  useEffect(() => {
    const activeItem = results[normalizedFocusedIndex]
    onActiveResultChange(activeItem ? {link: activeItem.key, title: activeItem.title || ''} : null)
  }, [normalizedFocusedIndex, onActiveResultChange, results])

  return (
    <div className="z-50 max-h-[50vh] overflow-y-auto rounded-md border border-black/8 bg-white shadow-sm dark:border-white/10 dark:bg-black">
      {isResolvingUrl ? (
        <div className="flex justify-center p-3">
          <Spinner />
        </div>
      ) : null}
      {!isResolvingUrl && isWebUrl ? (
        <div className="text-muted-foreground px-3 py-2 text-sm">Press Enter to use this URL.</div>
      ) : null}
      {!isResolvingUrl && !results.length && !isWebUrl ? (
        <div className="text-muted-foreground px-3 py-2 text-sm">
          {isSearching ? 'No documents found.' : 'No documents available.'}
        </div>
      ) : null}
      {!isResolvingUrl &&
        results.map((item, itemIndex) => {
          const isSelected = normalizedFocusedIndex === itemIndex

          return (
            <div
              key={item.key}
              data-nav-link-result="true"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
            >
              <SearchResultItem
                item={{
                  ...item,
                  path: item.path || [],
                  onSelect: () => {
                    onValue(item.key, item.title || '')
                  },
                  onFocus: () => onFocusedIndexChange(itemIndex),
                  onMouseEnter: () => onFocusedIndexChange(itemIndex),
                }}
                selected={isSelected}
              />
            </div>
          )
        })}
    </div>
  )
}
