import {useAppContext} from '@/app-context'
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
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {DocumentRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDate,
  getDocumentTitle,
  getMetadataName,
  HMBlockNode,
  toHMBlock,
} from '@shm/shared'
import {
  Button,
  Checkbox,
  Container,
  Input,
  Popover,
  Separator,
  SizableText,
  SizeTokens,
  Text,
  toast,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {
  Archive,
  ArrowDownUp,
  Check,
  Download,
  Pencil,
  Search,
  Settings2,
  Square,
  Star,
  User2,
  X,
} from '@tamagui/lucide-icons'
import {ComponentProps, useMemo, useRef, useState} from 'react'

const defaultSort: LibraryQueryState['sort'] = 'lastUpdate'

export default function LibraryPage() {
  const [queryState, setQueryState] = useState<LibraryQueryState>({
    sort: defaultSort,
    display: 'list',
    filterString: '',
    filter: {},
  })
  const [exportMode, setExportMode] = useState(false)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(
    new Set(),
  )
  const [allSelected, setAllSelected] = useState(false)

  const library = useLibrary(queryState)

  const filteredLibrary = useMemo(() => {
    return exportMode ? library.filter((entry) => !entry.draft) : library
  }, [exportMode, library])

  const filteredDocumentIds = useMemo(() => {
    return filteredLibrary.map((entry) => entry.id.id)
  }, [filteredLibrary])
  const {exportDocuments} = useAppContext()

  const toggleDocumentSelection = (id: string) => {
    setSelectedDocuments((prevSelected) => {
      const newSelected = new Set(prevSelected)
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }

      // Check if all documents are selected and update `allSelected` state
      setAllSelected(
        filteredDocumentIds.every((docId) => newSelected.has(docId)),
      )

      return newSelected
    })
  }

  const handleSelectAllChange = (checked: boolean) => {
    setAllSelected(checked)
    if (checked) {
      setSelectedDocuments(new Set(filteredDocumentIds))
    } else {
      setSelectedDocuments(new Set())
    }
  }

  const submitExportDocuments = async () => {
    if (selectedDocuments.size == 0) {
      toast.error('No documents selected')
      return
    }

    const selectedDocs = library.filter((entry) =>
      selectedDocuments.has(entry.id.id),
    )

    const documentsToExport = await Promise.all(
      selectedDocs.map(async (doc) => {
        const blocks: HMBlockNode[] | undefined = doc.document?.content
        const editorBlocks = toHMBlock(blocks)
        const markdown = await convertBlocksToMarkdown(editorBlocks)
        return {
          title: getDocumentTitle(doc.document),
          markdown,
        }
      }),
    )

    exportDocuments(documentsToExport)
  }

  return (
    <>
      <MainWrapper>
        <Container>
          <LibraryQueryBar
            queryState={queryState}
            setQueryState={setQueryState}
            exportMode={exportMode}
            setExportMode={setExportMode}
          />
          {queryState.display == 'list' ? (
            <LibraryList
              library={filteredLibrary}
              exportMode={exportMode}
              toggleDocumentSelection={toggleDocumentSelection}
              selectedDocuments={selectedDocuments}
            />
          ) : queryState.display == 'cards' ? (
            <LibraryCards library={filteredLibrary} />
          ) : null}
          {exportMode && (
            <>
              {/* <XStack
                marginBottom="$5"
                w="100%"
                maxWidth={900}
                group="item"
                justifyContent="flex-start"
              >
                <Checkbox
                  size="$3"
                  borderColor="$color12"
                  checked={allSelected}
                  onCheckedChange={(checked: boolean) =>
                    handleSelectAllChange(checked)
                  }
                >
                  <Checkbox.Indicator>
                    <Check />
                  </Checkbox.Indicator>
                </Checkbox>
                <SizableText
                  fontSize="$4"
                  fontWeight="800"
                  textAlign="left"
                  marginLeft="$3"
                >
                  Select All
                </SizableText>
              </XStack> */}
              <Button
                size="$2"
                onPress={() => handleSelectAllChange(!allSelected)}
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
              <Button size="$2" onPress={submitExportDocuments}>
                {`Submit Export (${selectedDocuments.size} documents)`}
              </Button>
            </>
          )}
        </Container>
      </MainWrapper>
      <Footer />
    </>
  )
}

function LibraryQueryBar({
  queryState,
  setQueryState,
  exportMode,
  setExportMode,
}: {
  queryState: LibraryQueryState
  setQueryState: React.Dispatch<React.SetStateAction<LibraryQueryState>>
  exportMode: boolean
  setExportMode: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    <XStack gap="$2" w="100%">
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
      <Button size="$2" onPress={() => setExportMode((prev) => !prev)}>
        {exportMode ? (
          <XStack ai="center" gap="$2">
            <SizableText size="$2">Cancel Export</SizableText>
            <X size={15} />
          </XStack>
        ) : (
          <XStack ai="center" gap="$2">
            <SizableText size="$2">Export Documents</SizableText>
            <Download size={15} />
          </XStack>
        )}
      </Button>
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

function LibraryList({
  library,
  exportMode,
  toggleDocumentSelection,
  selectedDocuments,
}: {
  library: LibraryData
  exportMode: boolean
  toggleDocumentSelection: (id: string) => void
  selectedDocuments: Set<string>
}) {
  return (
    <YStack paddingVertical="$4" marginHorizontal={-8}>
      {library.map((entry) => {
        const isSelected = selectedDocuments.has(entry.id.id)
        return (
          <LibraryListItem
            key={entry.id.id}
            entry={entry}
            exportMode={exportMode}
            isSelected={isSelected}
            toggleDocumentSelection={toggleDocumentSelection}
          />
        )
      })}
    </YStack>
  )
}

function LibraryListItem({
  entry,
  exportMode,
  isSelected,
  toggleDocumentSelection,
}: {
  entry: LibraryData[0]
  exportMode: boolean
  isSelected: boolean
  toggleDocumentSelection: (id: string) => void
}) {
  const navigate = useNavigate()
  const metadata = entry.document?.metadata || entry.draft?.metadata
  const isUnpublished = !!entry.draft && !entry.document
  const editors = useMemo(
    () =>
      entry.authors.length > 3 ? entry.authors.slice(0, 2) : entry.authors,
    [entry.authors],
  )

  const hoverColor = '$color5'
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: hoverColor,
      }}
      paddingHorizontal={16}
      paddingVertical="$1"
      onPress={() => {
        if (!exportMode) {
          if (isUnpublished) navigate({key: 'draft', id: entry.id})
          else navigate({key: 'document', id: entry.id})
        }
        // else {
        //   toggleDocumentSelection(entry.id.id)
        // }
      }}
      h={60}
      icon={
        entry.id.path?.length == 0 || entry.document?.metadata.thumbnail ? (
          <Thumbnail
            size={40}
            id={entry.id}
            metadata={entry.document?.metadata || entry.draft?.metadata}
          />
        ) : undefined
      }
    >
      <XStack gap="$2" ai="center" f={1} paddingVertical="$2">
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
        {entry.hasDraft && !isUnpublished && !exportMode ? (
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
        {exportMode ? (
          <Checkbox
            size="$3"
            borderColor="$color12"
            checked={isSelected}
            onCheckedChange={() => toggleDocumentSelection(entry.id.id)}
          >
            <Checkbox.Indicator>
              <Check />
            </Checkbox.Indicator>
          </Checkbox>
        ) : (
          <XStack>
            {editors.map((author, idx) => (
              <XStack
                zIndex={idx + 1}
                key={author.id.id}
                borderColor="$background"
                backgroundColor="$background"
                $group-item-hover={{
                  borderColor: hoverColor,
                  backgroundColor: hoverColor,
                }}
                borderWidth={2}
                borderRadius={100}
                overflow="hidden"
                marginLeft={-8}
                animation="fast"
              >
                <LinkThumbnail
                  key={author.id.id}
                  id={author.id}
                  metadata={author.metadata}
                  size={20}
                />
              </XStack>
            ))}
            {entry.authors.length > editors.length && editors.length != 0 ? (
              <XStack
                zIndex={editors.length}
                borderColor="$background"
                backgroundColor="$background"
                borderWidth={2}
                borderRadius={100}
                marginLeft={-8}
                animation="fast"
                width={24}
                height={24}
                ai="center"
                jc="center"
              >
                <Text
                  fontSize={10}
                  fontFamily="$body"
                  fontWeight="bold"
                  color="$color10"
                >
                  +{entry.authors.length - editors.length - 1}
                </Text>
              </XStack>
            ) : null}
          </XStack>
        )}
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
        fontWeight="400"
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
                  <SizableText
                    key={`slash-${id.id}`}
                    color="$color10"
                    size="$1"
                  >
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
