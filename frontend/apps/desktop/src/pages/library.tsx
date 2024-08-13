import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
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
import {formattedDate, getMetadataName} from '@shm/shared'
import {
  Button,
  Checkbox,
  Container,
  Input,
  Popover,
  Search,
  Separator,
  SizableText,
  SizeTokens,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {
  Archive,
  ArrowDownUp,
  Check,
  Pencil,
  Settings2,
  Square,
  Star,
  User2,
  X,
} from '@tamagui/lucide-icons'
import {ComponentProps, useRef, useState} from 'react'

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
      {/* <Tooltip
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
      </Tooltip> */}
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
      <LibrarySearch
        search={queryState.filterString}
        onSearch={(filterString: string) => {
          setQueryState((v) => ({
            ...v,
            filterString,
          }))
        }}
      />
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
              <SizableText size="$2">{activeOption.label}</SizableText>
              <TagXButton onPress={() => onSort(defaultSort)} />
            </XStack>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Content {...commonPopoverProps}>
        <YGroup separator={<Separator />}>
          {sortOptions.map((option) => (
            <Button
              size="$2"
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
      // bg="$colorTransparent"
      hoverStyle={{
        bg: '$colorTransparent',
        borderColor: '$colorTransparent',
      }}
      onPress={(e: MouseEvent) => {
        e.stopPropagation()
        onPress()
      }}
      icon={X}
    />
  )
}

const roleFilterOptions: Readonly<{label: string; value: FilterItem}[]> = [
  {label: 'Owner', value: 'owner'},
  {label: 'Editor', value: 'editor'},
  {label: 'Writer', value: 'writer'},
] as const

const allRoleFilterOptions = roleFilterOptions.map((option) => option.value)

const filterOptions: Readonly<
  {
    label: string
    value: FilterItem
    icon: React.FC<{size: SizeTokens}> | null
  }[]
> = [
  {label: 'Drafts', value: 'drafts', icon: Pencil},
  {label: 'Subscribed', value: 'subscribed', icon: Archive},
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
  const activeRoleFilters = Object.entries(filter)
    .filter(([key, value]) => value)
    .map(([key, value]) => {
      return roleFilterOptions.find((option) => option.value === key)
    })
    .filter((f) => !!f)
  const isEmptyFilter =
    activeFilters.length === 0 && activeRoleFilters.length === 0
  const allEditorialRolesSelected = allRoleFilterOptions.every(
    (role) => filter[role],
  )
  return (
    <Popover {...popoverState} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button
          size="$2"
          paddingVertical={0}
          icon={Settings2}
          bg={isEmptyFilter ? undefined : '$blue5'}
          hoverStyle={{
            bg: isEmptyFilter ? undefined : '$blue6',
            borderColor: isEmptyFilter ? undefined : '$blue6',
          }}
        >
          {allEditorialRolesSelected ? (
            <SelectedFilterTag
              label="Editorial Role"
              onX={() => {
                onFilter({
                  ...filter,
                  ...Object.fromEntries(
                    allRoleFilterOptions.map((role) => [role, false]),
                  ),
                })
              }}
            />
          ) : (
            activeRoleFilters.map((activeFilter) => (
              <SelectedFilterTag
                label={activeFilter.label}
                key={activeFilter.value}
                onX={() => onFilter({...filter, [activeFilter.value]: false})}
              />
            ))
          )}
          {activeFilters.map((activeFilter) => (
            <SelectedFilterTag
              label={activeFilter.label}
              key={activeFilter.value}
              onX={() => onFilter({...filter, [activeFilter.value]: false})}
            />
          ))}
        </Button>
      </Popover.Trigger>
      <Popover.Content {...commonPopoverProps}>
        <YGroup separator={<Separator />}>
          <RoleFilterOption
            option={{label: 'Editorial Role', icon: User2}}
            checked={allEditorialRolesSelected}
            onCheckedChange={(newValue) => {
              onFilter({
                ...filter,
                ...Object.fromEntries(
                  allRoleFilterOptions.map((role) => [role, !!newValue]),
                ),
              })
            }}
            onPress={() => {
              onFilter({
                ...Object.fromEntries(
                  allRoleFilterOptions.map((role) => [role, true]),
                ),
              })
              popoverState.onOpenChange(false)
            }}
          />
          {roleFilterOptions.map((option) => (
            <RoleFilterOption
              key={option.value}
              option={option}
              checked={!!filter[option.value]}
              onCheckedChange={(newValue) => {
                onFilter({...filter, [option.value]: !!newValue})
              }}
              onPress={() => {
                onFilter({[option.value]: true})
                popoverState.onOpenChange(false)
              }}
            />
          ))}
          {filterOptions.map((option) => (
            <RoleFilterOption
              key={option.value}
              option={option}
              checked={!!filter[option.value]}
              onCheckedChange={(newValue) => {
                onFilter({...filter, [option.value]: !!newValue})
              }}
              onPress={() => {
                onFilter({[option.value]: true})
                popoverState.onOpenChange(false)
              }}
            />
          ))}
        </YGroup>
      </Popover.Content>
    </Popover>
  )
}

function SelectedFilterTag({label, onX}: {label: string; onX: () => void}) {
  return (
    <XStack ai="center">
      <SizableText size="$1">{label}</SizableText>
      <TagXButton onPress={onX} />
    </XStack>
  )
}

function RoleFilterOption({
  option,
  onCheckedChange,
  onPress,
  checked,
}: {
  option: {
    label: string
    value?: FilterItem
    icon?: React.FC<{size: SizeTokens}> | null
  }
  onCheckedChange: (newValue: boolean) => void
  onPress: () => void
  checked: boolean
}) {
  return (
    <Button
      onPress={onPress}
      key={option.value}
      size="$2"
      justifyContent="space-between"
      icon={
        option.icon ? (
          <option.icon size={12} />
        ) : (
          <Square color="$colorTransparent" size={12} />
        )
      }
      iconAfter={
        <Checkbox
          id="link-latest"
          size="$2"
          checked={checked}
          onPress={(e: MouseEvent) => {
            e.stopPropagation()
          }}
          onCheckedChange={onCheckedChange}
        >
          <Checkbox.Indicator>
            <Check />
          </Checkbox.Indicator>
        </Checkbox>
      }
    >
      <SizableText f={1} size="$1">
        {option.label}
      </SizableText>
    </Button>
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

function LibrarySearch({
  search,
  onSearch,
}: {
  search: string
  onSearch: (search: string) => void
}) {
  const [isOpened, setIsOpened] = useState(!!search)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <XStack
      borderWidth={2}
      ai="center"
      borderColor={isOpened ? '$color5' : '$colorTransparent'}
      borderRadius="$2"
      animation="fast"
      onKeyUp={(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setIsOpened(false)
          onSearch('')
        }
      }}
    >
      <Button
        size="$2"
        borderColor="$colorTransparent"
        outlineColor="$colorTransparent"
        icon={Search}
        onPress={() => {
          if (search === '' && isOpened) {
            setIsOpened(false)
          } else {
            setIsOpened(true)
            setTimeout(() => inputRef.current?.focus(), 10)
          }
        }}
        bg="$colorTransparent"
        hoverStyle={{borderColor: isOpened ? '$colorTransparent' : undefined}}
      />
      {isOpened ? (
        <>
          <Input
            borderWidth={0}
            outline="none"
            unstyled
            placeholder="Filter Library..."
            value={search}
            size="$2"
            onChangeText={onSearch}
            ref={inputRef}
            width={250}
          />
          <Button
            size="$2"
            chromeless
            bg="$colorTransparent"
            onPress={(e: MouseEvent) => {
              e.stopPropagation()
              onSearch('')
              setIsOpened(false)
            }}
            icon={X}
            hoverStyle={{
              bg: '$color4',
            }}
          />
        </>
      ) : null}
    </XStack>
  )
}

function LibraryCards({library}: {library: LibraryData}) {
  return null
}

function LibraryList({library}: {library: LibraryData}) {
  return (
    <YStack paddingVertical="$4" marginHorizontal={-8}>
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
  const isFavorite = !isUnpublished && entry.isFavorite
  return (
    <Button
      size="$4"
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: '$color5',
      }}
      paddingHorizontal={16}
      paddingVertical="$1"
      onPress={() => {
        if (isUnpublished) navigate({key: 'draft', id: entry.id})
        else navigate({key: 'document', id: entry.id})
      }}
      h={60}
      icon={
        <Thumbnail
          size={42}
          id={entry.id}
          metadata={entry.document?.metadata || entry.draft?.metadata}
        />
      }
    >
      <XStack gap="$3" ai="center" f={1} paddingVertical="$2">
        <YStack f={1} gap="$1.5">
          <XStack ai="center" gap="$2" paddingLeft={4}>
            <SizableText
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {getMetadataName(metadata)}
            </SizableText>
            {isUnpublished && (
              <SizableText
                size="$1"
                color="$yellow11"
                paddingHorizontal="$2"
                paddingVertical="$1"
                bg="$yellow3"
                borderRadius="$1"
                borderColor="$yellow10"
                borderWidth={1}
              >
                Unpublished
              </SizableText>
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
      <XStack gap="$3" ai="center">
        {isUnpublished ? null : (
          <FavoriteButton id={entry.id} hideUntilItemHover />
        )}
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
              size={20}
            />
          ))}
        </XStack>
      </XStack>
    </Button>
  )
}

function LibraryEntryTime({entry}: {entry: LibraryData[0]}) {
  if (entry.document?.updateTime) {
    return (
      <SizableText size="$1">
        {formattedDate(entry.document.updateTime)}
      </SizableText>
    )
  }
  if (entry.draft?.lastUpdateTime) {
    return (
      <SizableText size="$1">
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
  const [space, ...names] = location
  return (
    <XStack gap="$2" w="100%" overflow="hidden">
      <Button
        theme="purple"
        color="$purple8"
        fontWeight="600"
        size="$1"
        borderWidth={0}
        bg="$colorTransparent"
        hoverStyle={{
          color: '$purple11',
          bg: '$colorTransparent',
          textDecorationLine: 'underline',
        }}
        onPress={(e: MouseEvent) => {
          e.stopPropagation()
          onNavigate({key: 'document', id: space.id})
        }}
      >
        {getMetadataName(space.metadata)}
      </Button>

      {names.length ? (
        <>
          <SizableText size="$1" color="$color9">
            |
          </SizableText>
          <XStack ai="center" gap="$0.5">
            {names.map(({id, metadata}, idx) => (
              <>
                {idx != 0 ? (
                  <SizableText color="$color10" size="$1">
                    /
                  </SizableText>
                ) : null}
                <Button
                  key={id.id}
                  size="$1"
                  borderWidth={0}
                  bg="$colorTransparent"
                  color="$color10"
                  hoverStyle={{
                    bg: '$colorTransparent',
                    textDecorationLine: 'underline',
                  }}
                  onPress={(e: MouseEvent) => {
                    e.stopPropagation()
                    onNavigate({key: 'document', id})
                  }}
                >
                  {metadata
                    ? getMetadataName(metadata)
                    : id.path?.at(-1) || 'Untitled'}
                </Button>
              </>
            ))}
          </XStack>
        </>
      ) : null}
    </XStack>
  )
}
