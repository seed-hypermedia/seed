import {MainWrapper} from '@/components/main-wrapper'
import {LinkThumbnail, Thumbnail} from '@/components/thumbnail'
import {
  FilterItem,
  LibraryData,
  LibraryDependentData,
  LibraryQueryState,
  useLibrary,
} from '@/models/library'
import {usePopoverState} from '@/use-popover-state'
import {DocumentRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {formattedDate, getMetadataTitle} from '@shm/shared'
import {
  Button,
  Checkbox,
  Container,
  Footer,
  Popover,
  Search,
  Separator,
  SizableText,
  Tooltip,
  View,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {
  ArrowDownUp,
  Check,
  LayoutGrid,
  List,
  Pencil,
  Settings2,
  Star,
  X,
} from '@tamagui/lucide-icons'
import {ComponentProps, useState} from 'react'

const defaultSort: LibraryQueryState['sort'] = 'lastUpdate'

export default function LibraryPage() {
  const [queryState, setQueryState] = useState<LibraryQueryState>({
    sort: defaultSort,
    display: 'list',
    filterString: '',
    filter: {},
  })
  const library = useLibrary(queryState)
  // console.log('lib', library)
  return (
    <>
      <MainWrapper>
        <Container>
          <LibraryQueryBar
            queryState={queryState}
            setQueryState={setQueryState}
          />
          {queryState.display == 'list' ? (
            <LibraryList library={library} />
          ) : queryState.display == 'cards' ? (
            <LibraryCards library={library} />
          ) : null}
        </Container>
      </MainWrapper>
      <Footer />
    </>
  )
}

function LibraryQueryBar({
  queryState,
  setQueryState,
}: {
  queryState: LibraryQueryState
  setQueryState: React.Dispatch<React.SetStateAction<LibraryQueryState>>
}) {
  return (
    <XStack gap="$2" w="100%">
      <Tooltip
        content={`Show items as ${
          queryState.display == 'cards' ? 'list' : 'cards'
        }`}
      >
        <Button
          onPress={() => {
            setQueryState((v) => ({
              ...v,
              display: v.display == 'cards' ? 'list' : 'cards',
            }))
          }}
          size="$2"
          icon={queryState.display == 'cards' ? LayoutGrid : List}
        />
      </Tooltip>
      <SortControl
        sort={queryState.sort}
        onSort={(sort) => {
          setQueryState((v) => ({
            ...v,
            sort,
          }))
        }}
      />
      <FilterControl
        filter={queryState.filter}
        onFilter={(filter) => {
          setQueryState((v) => ({
            ...v,
            filter,
          }))
        }}
      />
      <LibrarySearch />
    </XStack>
  )
}

const sortOptions: Readonly<
  {label: string; value: LibraryQueryState['sort']}[]
> = [
  {label: 'Last Update', value: 'lastUpdate'},
  {label: 'Alphabetical', value: 'alphabetical'},
] as const

function SortControl({
  sort,
  onSort,
}: {
  sort: LibraryQueryState['sort']
  onSort: (sort: LibraryQueryState['sort']) => void
}) {
  const popoverState = usePopoverState()
  function select(sort: LibraryQueryState['sort']) {
    return () => {
      onSort(sort)
      popoverState.onOpenChange(false)
    }
  }
  const activeOption = sortOptions.find((option) => option.value === sort)
  const isDefault = sort === defaultSort
  return (
    <Popover {...popoverState} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button
          size="$2"
          icon={ArrowDownUp}
          bg={isDefault ? undefined : '$blue5'}
          hoverStyle={{
            bg: isDefault ? undefined : '$blue6',
            borderColor: isDefault ? undefined : '$blue6',
          }}
        >
          {activeOption && !isDefault ? (
            <XStack>
              <SizableText>{activeOption.label}</SizableText>
              <TagXButton onPress={() => onSort(defaultSort)} />
            </XStack>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Content {...commonPopoverProps}>
        <YGroup separator={<Separator />}>
          {sortOptions.map((option) => (
            <Button
              onPress={select(option.value)}
              key={option.value}
              iconAfter={sort === option.value ? Check : null}
              justifyContent="flex-start"
            >
              {option.label}
            </Button>
          ))}
        </YGroup>
      </Popover.Content>
    </Popover>
  )
}

function TagXButton({onPress}: {onPress: () => void}) {
  return (
    <Button
      size="$1"
      chromeless
      bg="$colorTransparent"
      onPress={(e: MouseEvent) => {
        e.stopPropagation()
        onPress()
      }}
      icon={X}
    />
  )
}
const filterOptions: Readonly<
  {
    label: string
    value: FilterItem
    icon: React.ComponentType | null
  }[]
> = [
  {label: 'Drafts', value: 'drafts', icon: null},
  {label: 'Subscribed', value: 'subscribed', icon: null},
  {label: 'Favorites', value: 'favorites', icon: Star},
] as const

function FilterControl({
  filter,
  onFilter,
}: {
  filter: LibraryQueryState['filter']
  onFilter: (filter: LibraryQueryState['filter']) => void
}) {
  const popoverState = usePopoverState()
  const activeFilters = Object.entries(filter)
    .filter(([key, value]) => value)
    .map(([key, value]) => {
      return filterOptions.find((option) => option.value === key)
    })
    .filter((f) => !!f)
  const isEmptyFilter = activeFilters.length === 0
  return (
    <Popover {...popoverState} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button
          size="$2"
          icon={Settings2}
          bg={isEmptyFilter ? undefined : '$blue5'}
          hoverStyle={{
            bg: isEmptyFilter ? undefined : '$blue6',
            borderColor: isEmptyFilter ? undefined : '$blue6',
          }}
        >
          {activeFilters.map((activeFilter) => (
            <XStack key={activeFilter.value}>
              <SizableText>{activeFilter.label}</SizableText>
              <TagXButton
                onPress={() =>
                  onFilter({...filter, [activeFilter.value]: false})
                }
              />
            </XStack>
          ))}
        </Button>
      </Popover.Trigger>
      <Popover.Content {...commonPopoverProps}>
        <YGroup separator={<Separator />}>
          {filterOptions.map((option) => (
            <Button
              onPress={() => {
                onFilter({[option.value]: true})
                popoverState.onOpenChange(false)
              }}
              key={option.value}
              paddingLeft={option.icon ? undefined : '$9'}
              icon={option.icon}
              justifyContent="space-between"
            >
              <SizableText>{option.label}</SizableText>
              <Checkbox
                id="link-latest"
                size="$2"
                checked={!!filter[option.value]}
                onPress={(e: MouseEvent) => {
                  e.stopPropagation()
                }}
                onCheckedChange={(newValue) => {
                  onFilter({...filter, [option.value]: !!newValue})
                }}
              >
                <Checkbox.Indicator>
                  <Check />
                </Checkbox.Indicator>
              </Checkbox>
            </Button>
          ))}
        </YGroup>
      </Popover.Content>
    </Popover>
  )
}

const commonPopoverProps: ComponentProps<typeof Popover.Content> = {
  padding: 0,
  elevation: '$2',
  animation: [
    'fast',
    {
      opacity: {
        overshootClamping: true,
      },
    },
  ],
  enterStyle: {y: -10, opacity: 0},
  exitStyle: {y: -10, opacity: 0},
  elevate: true,
}

function LibrarySearch() {
  return <Button size="$2" icon={Search} />
}

function LibraryCards({library}: {library: LibraryData}) {
  return null
}

function LibraryList({library}: {library: LibraryData}) {
  return (
    <YStack marginVertical="$4">
      {library.map((entry) => {
        return <LibraryListItem key={entry.id.id} entry={entry} />
      })}
    </YStack>
  )
}

function LibraryListItem({entry}: {entry: LibraryData[0]}) {
  const navigate = useNavigate()
  const metadata = entry.document?.metadata || entry.draft?.metadata
  const isUnpublished = !!entry.draft && !entry.document
  return (
    <Button
      onPress={() => {
        if (isUnpublished) navigate({key: 'draft', id: entry.id})
        else navigate({key: 'document', id: entry.id})
      }}
      height={60}
      jc="space-between"
    >
      <XStack gap="$3" ai="center">
        <Thumbnail
          size={36}
          id={entry.id}
          metadata={entry.document?.metadata || entry.draft?.metadata}
        />
        <YStack>
          <XStack ai="center" gap="$3" paddingLeft={4}>
            <SizableText fontWeight="bold">
              {getMetadataTitle(metadata)}
            </SizableText>
            {isUnpublished && (
              <View
                bg="$yellow3"
                borderRadius="$1"
                paddingHorizontal="$2"
                paddingVertical="$1"
              >
                <SizableText size="$2" color="$yellow12">
                  Unpublished
                </SizableText>
              </View>
            )}
          </XStack>
          {entry.location.length ? (
            <LibraryEntryLocation
              location={entry.location}
              onNavigate={navigate}
            />
          ) : null}
        </YStack>
      </XStack>
      <XStack gap="$3">
        {entry.hasDraft && !isUnpublished ? (
          <Button
            theme="yellow"
            icon={Pencil}
            size="$2"
            onPress={(e: MouseEvent) => {
              e.stopPropagation()
              navigate({key: 'draft', id: entry.id})
            }}
          >
            Resume Editing
          </Button>
        ) : (
          <LibraryEntryTime entry={entry} />
        )}
        <XStack>
          {entry.authors.map((author) => (
            <LinkThumbnail
              key={author.id.id}
              id={author.id}
              metadata={author.metadata}
              size={24}
            />
          ))}
        </XStack>
      </XStack>
    </Button>
  )
}

function LibraryEntryTime({entry}: {entry: LibraryData[0]}) {
  if (entry.document?.updateTime) {
    return <SizableText>{formattedDate(entry.document.updateTime)}</SizableText>
  }
  if (entry.draft?.lastUpdateTime) {
    return (
      <SizableText>
        {formattedDate(new Date(entry.draft.lastUpdateTime))}
      </SizableText>
    )
  }
  return null
}

function LibraryEntryLocation({
  location,
  onNavigate,
}: {
  location: LibraryDependentData[]
  onNavigate: (route: DocumentRoute) => void
}) {
  return (
    <XStack>
      {location.map(({id, metadata}) => (
        <Button
          key={id.id}
          size="$1"
          onPress={(e: MouseEvent) => {
            e.stopPropagation()
            onNavigate({key: 'document', id})
          }}
        >
          {metadata
            ? getMetadataTitle(metadata)
            : id.path?.at(-1) || 'Untitled'}
        </Button>
      ))}
    </XStack>
  )
}
