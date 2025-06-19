import {QuerySearch} from '@/editor/query-block'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {zodResolver} from '@hookform/resolvers/zod'
import {packHmId, unpackHmId} from '@shm/shared'
import {HMNavigationItem} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
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
import {Pencil, Plus} from '@tamagui/lucide-icons'
import {EllipsisVertical} from 'lucide-react'
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
}: {
  docNav: HMNavigationItem[]
  editDocNav: (navigation: HMNavigationItem[]) => void
}) {
  const popover = usePopoverState()
  return (
    <Popover {...popover}>
      <PopoverTrigger className="no-window-drag">
        <Button onPress={() => {}} size="$2" icon={Pencil} opacity={1} />
      </PopoverTrigger>
      <PopoverContent className="bg-white dark:bg-black max-h-[80vh] overflow-y-auto">
        {/* <PopoverArrow borderWidth={1} borderColor="$borderColor" /> */}
        <EditNavigation docNav={docNav} onDocNav={editDocNav} />
      </PopoverContent>
    </Popover>
  )
}

function EditNavigation({
  docNav,
  onDocNav,
}: {
  docNav: HMNavigationItem[]
  onDocNav: (navigation: HMNavigationItem[]) => void
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
              onSubmit={(updatedItem) => {
                const updatedDocNav: HMNavigationItem[] = docNav.map(
                  (navItem) =>
                    navItem.id === item.id
                      ? {id: item.id, type: 'Link', ...updatedItem}
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
            const newNavItem = {
              ...newItem,
              id: nanoid(10),
              type: 'Link' as const,
            }
            const newDocNav = [...docNav, newNavItem]
            onDocNav(newDocNav)
            setShowAdd(false)
          }}
          submitLabel="Add"
          onCancel={() => {
            setShowAdd(false)
          }}
        />
      ) : (
        <Button
          onPress={() => {
            setShowAdd(true)
          }}
          icon={Plus}
        >
          Add
        </Button>
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
  text: z.string(),
  link: z.string(),
})

function NavItemForm({
  item,
  onSubmit,
  onCancel,
  onRemove,
  submitLabel,
}: {
  item?: HMNavigationItem
  onSubmit: (result: z.infer<typeof NavItemFormSchema>) => void
  onCancel: () => void
  onRemove?: () => void
  submitLabel: string
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
      text: item?.text || '',
      link: item?.link || '',
    },
  })

  watch((data, {name}) => {
    if (name === 'link' && data.link?.startsWith('hm://')) {
      setValue('text', '')
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
        <FormInput
          control={control}
          name="link"
          placeholder="https://example.com"
        />
        {/* <HMDocURLInput control={control} name="link" /> */}
      </FormField>
      <FormField name="text" label="Menu Item Label" errors={errors}>
        <FormInput control={control} name="text" placeholder="My Link..." />
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
}: {
  control: Control<Fields>
  name: Path<Fields>
}) {
  const c = useController({control, name})
  const id = unpackHmId(c.field.value)
  const entity = useEntity(id)
  return (
    <QuerySearch
      selectedDocName={
        c.field.value
          ? id
            ? entity.data?.document?.metadata.name || `?${id?.uid.slice(-8)}`
            : c.field.value
          : null
      }
      allowWebURL
      onSelect={(data) => {
        console.log('SELECT', data)
        if (data.id) c.field.onChange(packHmId(data.id))
        else if (data.webUrl) c.field.onChange(data.webUrl)
      }}
    />
  )
}
