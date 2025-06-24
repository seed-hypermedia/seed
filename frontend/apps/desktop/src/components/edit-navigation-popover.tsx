import {useListDirectory} from '@/models/documents'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {hmId, unpackHmId, useSearch} from '@shm/shared'
import {HMNavigationItem, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import '@shm/shared/styles/document.css'
import {Input} from '@shm/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {FormField} from '@shm/ui/forms'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {Pencil, Plus} from '@tamagui/lucide-icons'
import {EllipsisVertical, Globe, Search, Trash} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useEffect, useRef, useState} from 'react'
import {Button, XStack, YStack} from 'tamagui'

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
        <Button onPress={() => {}} size="$2" icon={Pencil} opacity={1} />
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

  return (
    <YStack gap="$2" ref={containerRef}>
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

      <XStack>
        <Button
          size="$3"
          onPress={() => {
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
          icon={Plus}
        >
          Add Navigation Item
        </Button>
      </XStack>
    </YStack>
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
    <XStack
      ref={elementRef}
      jc="space-between"
      ai="center"
      p="$2"
      borderRadius="$2"
      hoverStyle={{bg: '$color5'}}
      bg={isDraggingOver ? '$color6' : undefined}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'grab',
      }}
    >
      <XStack
        ai="center"
        gap="$2"
        flex={1}
        onPress={() => {
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
      </XStack>
      <Popover {...popoverState}>
        <PopoverTrigger asChild>
          <Button
            size="$1"
            chromeless
            icon={Pencil}
            onPress={(e: any) => {
              e.stopPropagation()
            }}
          />
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
    </XStack>
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

      <YStack gap="$2">
        <Separator />

        <XStack justifyContent="flex-end">
          {onRemove && (
            <Tooltip content="Remove Navigation Item">
              <Button
                size="$3"
                icon={<Trash size={16} />}
                chromeless
                onPress={() => {
                  onRemove()
                }}
              />
            </Tooltip>
          )}
        </XStack>
      </YStack>
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
  const entity = useEntity(id)
  let label = link || 'URL or Search Documents'
  let fontClass = 'text-muted-foreground'
  if (link === entity.data?.id.id && entity.data?.document?.metadata.name) {
    fontClass = 'text-primary'
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
              'border-color8 text-md bg-secondary align-center line-clamp-1 w-full overflow-hidden rounded-sm border-1 p-1 px-3 text-clip',
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
  const dirList = useListDirectory(homeId, {mode: 'Children'})
  const isSearching = !!query.length
  const Icon = isWebUrl ? Globe : Search
  const results: {
    link: string
    label: string
  }[] = isSearching
    ? search.data?.entities.map((e) => ({
        link: e.id.id,
        label: e.title,
      })) || []
    : dirList.data
        ?.map((d) => ({
          link: hmId('d', d.account, {path: d.path}).id,
          label: d.metadata.name || '?',
        }))
        .filter(filterPresets) || []

  return (
    <div className="z-50 max-h-[50vh] overflow-y-auto">
      <div className="border-color8 relative border-b-1 p-1">
        <Input
          autoFocus
          className="w-full rounded-sm p-2 pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.match(/^https?:\/\//)) {
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
      {results.map((e) => {
        return (
          <div
            key={e.link}
            onClick={() => {
              onValue(e.link, e.label)
              onClose()
            }}
            className="hover:bg-secondary px-3 py-2"
          >
            {e.label}
          </div>
        )
      })}
    </div>
  )
}
