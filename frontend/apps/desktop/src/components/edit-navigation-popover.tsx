import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {zodResolver} from '@hookform/resolvers/zod'
import {HMNavigationItem} from '@shm/shared/hm-types'
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
import {useState} from 'react'
import {useForm} from 'react-hook-form'
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
      <PopoverContent className="bg-white dark:bg-black">
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
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handleDragStart(event: any) {
    setActiveId(event.active.id)
  }

  function handleDragEnd(event: any) {
    const {active, over} = event

    if (active.id !== over?.id) {
      const oldIndex = docNav.findIndex((item) => item.id === active.id)
      const newIndex = docNav.findIndex((item) => item.id === over.id)
      const newItems = arrayMove(docNav, oldIndex, newIndex)
      onDocNav(newItems)
    }

    setActiveId(null)
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  const activeItem = activeId
    ? docNav.find((item) => item.id === activeId)
    : null

  return (
    <YStack gap="$2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={docNav} strategy={verticalListSortingStrategy}>
          {docNav.map((item) => {
            if (editingId === item.id) {
              return (
                <NavItemForm
                  key={item.id}
                  item={item}
                  onSubmit={(updatedItem) => {
                    const updatedDocNav = docNav.map((navItem) =>
                      navItem.id === item.id
                        ? {...navItem, ...updatedItem}
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
              <SortableNavItem
                key={item.id}
                item={item}
                onEdit={() => setEditingId(item.id)}
              />
            )
          })}
        </SortableContext>
        <DragOverlay>
          {activeItem ? <DragOverlayItem item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>
      {showAdd ? (
        <NavItemForm
          onSubmit={(newItem) => {
            const newNavItem = {
              ...newItem,
              id: nanoid(),
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

function SortableNavItem({
  item,
  onEdit,
}: {
  item: HMNavigationItem
  onEdit: () => void
}) {
  const {attributes, listeners, setNodeRef, transform, transition, isDragging} =
    useSortable({id: item.id})

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <XStack
      ref={setNodeRef}
      style={{
        ...style,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      jc="space-between"
      ai="center"
      p="$2"
      borderRadius="$2"
      hoverStyle={{bg: '$color5'}}
    >
      <XStack ai="center" gap="$2" flex={1}>
        <div
          {...attributes}
          {...listeners}
          className="p-1 cursor-grab active:cursor-grabbing rounded-1 hover:bg-color6"
          onMouseDown={(e) => {
            // Prevent text selection
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

function DragOverlayItem({item}: {item: HMNavigationItem}) {
  return (
    <XStack
      jc="space-between"
      ai="center"
      p="$2"
      borderRadius="$2"
      bg="$color5"
      borderWidth={1}
      borderColor="$color8"
      opacity={0.9}
    >
      <XStack ai="center" gap="$2" flex={1}>
        <EllipsisVertical size={16} />
        <Text flex={1} userSelect="none">
          {item.text}
        </Text>
      </XStack>
      <Button size="$1" chromeless icon={Pencil} disabled />
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
    formState: {errors},
  } = useForm<z.infer<typeof NavItemFormSchema>>({
    resolver: zodResolver(NavItemFormSchema),
    defaultValues: {
      text: item?.text || '',
      link: item?.link || '',
    },
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
      <FormField name="text" label="Label" errors={errors}>
        <FormInput control={control} name="text" placeholder="Nav Item Label" />
      </FormField>
      <FormField name="link" label="Link" errors={errors}>
        <FormInput
          control={control}
          name="link"
          placeholder="https://example.com"
        />
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
