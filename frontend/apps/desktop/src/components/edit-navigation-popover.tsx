import {useListDirectory} from '@/models/documents'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {zodResolver} from '@hookform/resolvers/zod'
import {hmId, unpackHmId, useSearch} from '@shm/shared'
import {HMNavigationItem, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {loadEntity, useEntity} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {Check} from '@shm/ui/icons'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {Pencil, Plus} from '@tamagui/lucide-icons'
import {EllipsisVertical, Globe, Search} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useEffect, useRef, useState} from 'react'
import {
  Control,
  FieldValues,
  Path,
  useController,
  useForm,
} from 'react-hook-form'
import {Button, Form, Text, XStack, YStack} from 'tamagui'
import {z} from 'zod'

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
      <PopoverContent className="bg-white dark:bg-black max-h-[80vh] overflow-y-auto">
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const cleanup = monitorForElements({
      onDragStart: ({source}) => {
        console.log('Drag started:', {source})
      },
      onDrop: ({source, location}) => {
        console.log('Drop event:', {source, location})
        if (!location.current.dropTargets.length) {
          console.log('No drop targets found')
          return
        }

        const over = location.current.dropTargets[0]
        console.log('Drop target:', over)

        const sourceIndex = docNav.findIndex(
          (item) => item.id === source.data.id,
        )
        const overIndex = docNav.findIndex((item) => item.id === over.data.id)
        console.log('Indices:', {sourceIndex, overIndex})

        if (sourceIndex === -1 || overIndex === -1) {
          console.log('Invalid indices')
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
        if (editingId === item.id) {
          return (
            <NavItemForm
              key={item.id}
              item={item}
              homeId={homeId}
              filterPresets={(item) => {
                return !docNav.find((i) => i.link === item.link)
              }}
              onSubmit={(updatedItem) => {
                const updatedDocNav: HMNavigationItem[] = docNav.map(
                  (navItem) =>
                    navItem.id === item.id
                      ? {
                          id: item.id,
                          type: 'Link',
                          text: updatedItem.label,
                          link: updatedItem.link,
                        }
                      : navItem,
                )
                onDocNav(updatedDocNav)
                setEditingId(null)
              }}
              onRemove={() => {
                const updatedDocNav = docNav.filter(
                  (navItem) => navItem.id !== item.id,
                )
                onDocNav(updatedDocNav)
                setEditingId(null)
              }}
              submitLabel="Done"
              onCancel={() => setEditingId(null)}
            />
          )
        }
        return (
          <DraggableNavItem
            key={item.id}
            item={item}
            onEdit={() => setEditingId(item.id)}
          />
        )
      })}
      {showAdd ? (
        <NavItemForm
          onSubmit={(newItem) => {
            const newNavItem: HMNavigationItem = {
              link: newItem.link,
              text: newItem.label,
              id: nanoid(10),
              type: 'Link' as const,
            }
            const newDocNav = [...docNav, newNavItem]
            onDocNav(newDocNav)
            setShowAdd(false)
          }}
          homeId={homeId}
          filterPresets={(item) => {
            return !docNav.find((i) => i.link === item.link)
          }}
          submitLabel="Add"
          onCancel={() => {
            setShowAdd(false)
          }}
        />
      ) : (
        <XStack>
          <Button
            size="$3"
            onPress={() => {
              setShowAdd(true)
            }}
            icon={Plus}
          >
            Add Navigation Item
          </Button>
        </XStack>
      )}
    </YStack>
  )
}

function DraggableNavItem({
  item,
  onEdit,
}: {
  item: HMNavigationItem
  onEdit: () => void
}) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!elementRef.current) {
      console.log('Element ref not ready')
      return
    }

    console.log('Setting up drag and drop for item:', item.id)

    const cleanup = combine(
      draggable({
        element: elementRef.current,
        getInitialData: () => {
          console.log('Getting initial data for:', item.id)
          return {id: item.id}
        },
      }),
      dropTargetForElements({
        element: elementRef.current,
        getData: () => {
          console.log('Getting drop target data for:', item.id)
          return {id: item.id}
        },
      }),
    )

    return () => {
      console.log('Cleaning up drag and drop for item:', item.id)
      cleanup()
    }
  }, [item.id])

  return (
    <XStack
      ref={elementRef}
      jc="space-between"
      ai="center"
      p="$2"
      borderRadius="$2"
      hoverStyle={{bg: '$color5'}}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'grab',
      }}
    >
      <XStack ai="center" gap="$2" flex={1}>
        <div
          className="p-1 cursor-grab active:cursor-grabbing rounded-1 hover:bg-color6"
          onMouseDown={(e) => {
            console.log('Mouse down on handle')
            e.preventDefault()
          }}
        >
          <EllipsisVertical size={16} />
        </div>
        <Text flex={1} userSelect="none">
          {item.text}
        </Text>
      </XStack>
      <Button
        size="$1"
        chromeless
        icon={Pencil}
        onPress={(e: any) => {
          e.stopPropagation()
          onEdit()
        }}
      />
    </XStack>
  )
}

const NavItemFormSchema = z.object({
  label: z.string(),
  link: z.string(),
})

function NavItemForm({
  item,
  onSubmit,
  onCancel,
  onRemove,
  submitLabel,
  homeId,
  filterPresets,
}: {
  item?: HMNavigationItem
  onSubmit: (result: z.infer<typeof NavItemFormSchema>) => void
  onCancel: () => void
  onRemove?: () => void
  submitLabel: string
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const {
    control,
    handleSubmit,
    setFocus,
    watch,
    setValue,
    formState: {errors},
  } = useForm<z.infer<typeof NavItemFormSchema>>({
    resolver: zodResolver(NavItemFormSchema),
    defaultValues: {
      label: item?.text || '',
      link: item?.link || '',
    },
  })

  watch((data, {name}) => {
    if (name === 'link' && data.link?.startsWith('hm://')) {
      setValue('label', '')
      const id = unpackHmId(data.link)
      if (id?.type === 'd') {
        loadEntity(id).then((entity) => {
          if (entity?.document?.metadata.name) {
            setValue('label', entity.document.metadata.name)
          }
        })
      }
    }
  })

  return (
    <Form
      onSubmit={handleSubmit((result) => {
        onSubmit(result)
      })}
      gap="$4"
      padding="$4"
      borderWidth={1}
      borderColor="$color8"
      borderRadius="$3"
    >
      <FormField name="link" label="Link" errors={errors}>
        <HMDocURLInput
          control={control}
          homeId={homeId}
          name="link"
          filterPresets={filterPresets}
        />
      </FormField>
      <FormField name="label" label="Menu Item Label" errors={errors}>
        <FormInput control={control} name="label" placeholder="My Link..." />
      </FormField>
      <XStack gap="$2" jc="space-between">
        {onRemove && (
          <Button size="$2" theme="red" onPress={onRemove}>
            Remove
          </Button>
        )}
        <XStack gap="$2" flex={1} jc="flex-end">
          <Button size="$2" onPress={onCancel}>
            Cancel
          </Button>
          <Form.Trigger asChild>
            <Button size="$2" theme="green" icon={Check}>
              {submitLabel}
            </Button>
          </Form.Trigger>
        </XStack>
      </XStack>
    </Form>
  )
}

function HMDocURLInput<Fields extends FieldValues>({
  control,
  name,
  homeId,
  filterPresets,
}: {
  control: Control<Fields>
  name: Path<Fields>
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const c = useController({control, name})
  const id = unpackHmId(c.field.value)
  const entity = useEntity(id)
  let label = c.field.value || 'URL or Search Documents'
  let fontClass = 'text-muted-foreground'
  if (
    c.field.value === entity.data?.id.id &&
    entity.data?.document?.metadata.name
  ) {
    fontClass = 'text-brand-5'
    label = entity.data.document.metadata.name
  } else if (c.field.value) {
    label = c.field.value
  }
  const {onChange, ...inputProps} = c.field
  const popoverState = usePopoverState()
  return (
    <>
      <Popover {...popoverState}>
        <PopoverTrigger asChild>
          <div
            className={cn(
              'border-1 border-color8 rounded-sm p-1 px-3 text-md bg-secondary w-full align-center line-clamp-1 text-clip overflow-hidden',
              fontClass,
            )}
          >
            <span>{label}</span>
          </div>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <SearchUI
            onValue={onChange}
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
  onValue: (value: string) => void
  onClose: () => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const [query, setQuery] = useState('')
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
    <div className="max-h-[50vh] overflow-y-auto">
      <div className="p-1 relative border-b-1 border-color8">
        <input
          autoFocus
          className="p-2 w-full rounded-sm pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.match(/^https?:\/\//)) {
              onValue(query)
              onClose()
            }
          }}
        ></input>
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2" size={20} />
      </div>
      {results.map((e) => {
        return (
          <div
            key={e.link}
            onClick={() => {
              onValue(e.link)
              onClose()
            }}
            className="px-3 py-2 hover:bg-secondary"
          >
            {e.label}
          </div>
        )
      })}
    </div>
  )
}
