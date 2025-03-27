import { useAppContext } from '@/app-context'
import { MainWrapper } from '@/components/main-wrapper'

import { LibraryListItem } from '@/components/list-item'
import { EditorBlock } from '@/editor'
import {
  FilterItem,
  LibraryData,
  LibraryQueryState,
  useClassicLibrary,
} from '@/models/library'
import { convertBlocksToMarkdown } from '@/utils/blocks-to-markdown'
import { hmBlocksToEditorContent } from '@shm/shared/client/hmblock-to-editorblock'
import { getDocumentTitle } from '@shm/shared/content'
import { HMBlockNode } from '@shm/shared/hm-types'
import { Button } from '@shm/ui/button'
import { Container } from '@shm/ui/container'
import { ListItemSkeleton } from '@shm/ui/entity-card'
import {
  Archive,
  ArrowDownUp,
  Check,
  FileOutput,
  Pencil,
  Search,
  Settings2,
  Star,
  X,
} from '@shm/ui/icons'
import { toast } from '@shm/ui/toast'
import { usePopoverState } from '@shm/ui/use-popover-state'
import { ComponentProps, useMemo, useRef, useState } from 'react'
import {
  Checkbox,
  Dialog,
  DialogContent,
  Input,
  Popover,
  SizableText,
  SizeTokens,
  Square,
  Text,
  XStack,
  YGroup,
  YStack,
} from 'tamagui'
import LibraryPage from './library2'

const defaultSort: LibraryQueryState['sort'] = 'lastUpdate'

export default function MainLibraryPage() {
  return <LibraryPage />
}

function ClassicLibraryPage() {
  const [queryState, setQueryState] = useState<LibraryQueryState>({
    sort: defaultSort,
    display: 'list',
    filterString: '',
    filter: {},
  })
  const [exportMode, setExportMode] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(
    new Set(),
  )
  const [allSelected, setAllSelected] = useState(false)

  const library = useClassicLibrary(queryState)

  const filteredLibrary = useMemo(() => {
    return exportMode
      ? library?.items.filter((entry) => !entry.draft)
      : library?.items
  }, [exportMode, library])

  const filteredDocumentIds = useMemo(() => {
    return filteredLibrary?.map((entry) => entry.id.id)
  }, [filteredLibrary])
  const {exportDocuments, openDirectory} = useAppContext()

  const handleExportButtonClick = () => {
    if (exportMode) {
      if (selectedDocuments.size == 0) setExportMode(false)
      else setIsDialogOpen(true)
    } else {
      setExportMode(true)
    }
  }

  const toggleDocumentSelection = (id: string) => {
    setSelectedDocuments((prevSelected) => {
      const newSelected = new Set(prevSelected)
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }

      // Check if all documents are selected and update `allSelected` state
      if (filteredDocumentIds)
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

    const selectedDocs = library?.items.filter((entry) =>
      selectedDocuments.has(entry.id.id),
    )

    const documentsToExport = await Promise.all(
      (selectedDocs || []).map(async (doc) => {
        const blocks: HMBlockNode[] | undefined = doc.document?.content
        const editorBlocks: EditorBlock[] = blocks
          ? hmBlocksToEditorContent(blocks)
          : []
        const markdown = await convertBlocksToMarkdown(
          editorBlocks,
          doc.document!,
        )
        return {
          title: getDocumentTitle(doc.document) || 'Untitled document',
          markdown,
        }
      }),
    )

    exportDocuments(documentsToExport)
      .then((res) => {
        const success = (
          <>
            <YStack gap="$1.5" maxWidth={700}>
              <SizableText wordWrap="break-word" textOverflow="break-word">
                Successfully exported documents to: <b>{`${res}`}</b>.
              </SizableText>
              <SizableText
                textDecorationLine="underline"
                textDecorationColor="currentColor"
                color="$brand5"
                tag={'a'}
                onPress={() => {
                  openDirectory(res)
                }}
              >
                Show directory
              </SizableText>
            </YStack>
          </>
        )
        toast.success('', {customContent: success})
      })
      .catch((err) => {
        toast.error(err)
      })
  }

  const isLibraryEmpty = library?.totalItemCount === 0
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>

          {filteredLibrary && library && (
            <>
              <LibraryQueryBar
                queryState={queryState}
                setQueryState={setQueryState}
                exportMode={exportMode}
                handleExportButtonClick={handleExportButtonClick}
                isLibraryEmpty={filteredLibrary.length == 0}
              />
              {queryState.display == 'list' ? (
                <LibraryList
                  library={{
                    items: filteredLibrary,
                    totalItemCount: filteredLibrary.length,
                  }}
                  exportMode={exportMode}
                  toggleDocumentSelection={toggleDocumentSelection}
                  selectedDocuments={selectedDocuments}
                  allSelected={allSelected}
                  handleSelectAllChange={handleSelectAllChange}
                />
              ) : queryState.display == 'cards' ? (
                <LibraryCards />
              ) : null}
              {exportMode && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <Dialog.Portal>
                    <Dialog.Overlay
                      height="100vh"
                      bg={'#00000088'}
                      width="100vw"
                      animation="fast"
                      opacity={0.8}
                      enterStyle={{opacity: 0}}
                      exitStyle={{opacity: 0}}
                    />
                    <DialogContent>
                      <YStack>
                        {selectedDocuments.size === 1 ? (
                          <XStack
                            maxWidth={290}
                            whiteSpace="normal"
                            overflow="hidden"
                            textOverflow="ellipsis"
                            style={{wordWrap: 'break-word'}}
                          >
                            <SizableText size="$3">
                              You are choosing to{' '}
                              <Text fontWeight="800">export</Text> the document
                              named{' '}
                              <Text fontWeight="800">
                                “
                                {library.items.find(
                                  (entry) =>
                                    entry.id.id ===
                                    Array.from(selectedDocuments)[0],
                                )?.document?.metadata?.name || 'Untitled'}
                                ”
                              </Text>
                              .
                            </SizableText>
                          </XStack>
                        ) : (
                          <SizableText size="$3">
                            You are choosing to{' '}
                            <Text fontWeight="800">
                              export ({selectedDocuments.size}) documents
                            </Text>
                            .
                          </SizableText>
                        )}
                        <SizableText size="$2" marginVertical="$4">
                          Do you want to continue with the export?
                        </SizableText>
                        <XStack width="100%" gap="$3" jc="space-between">
                          <Button
                            flex={1}
                            bc="$gray3"
                            onPress={() => {
                              setIsDialogOpen(false)
                              setExportMode(false)
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            flex={1}
                            bg="$brand12"
                            borderColor="$brand11"
                            hoverStyle={{
                              bg: '$brand11',
                              borderColor: '$brand10',
                            }}
                            onPress={() => {
                              setIsDialogOpen(false)
                              setExportMode(false)
                              submitExportDocuments()
                            }}
                          >
                            Export
                          </Button>
                        </XStack>
                      </YStack>
                    </DialogContent>
                  </Dialog.Portal>
                </Dialog>
              )}
            </>
          )}
        </Container>
      </MainWrapper>
    </XStack>
  )
}

function LibraryQueryBar({
  queryState,
  setQueryState,
  exportMode,
  handleExportButtonClick,
  isLibraryEmpty = true,
}: {
  queryState: LibraryQueryState
  setQueryState: React.Dispatch<React.SetStateAction<LibraryQueryState>>
  exportMode: boolean
  handleExportButtonClick: () => void
  isLibraryEmpty: boolean
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
      {isLibraryEmpty ? null : (
        <XStack position="absolute" right="$2" top="$1" gap="$2">
          <Button
            size="$2"
            onPress={handleExportButtonClick}
            icon={FileOutput}
            bg="$brand5"
            borderColor="$brand5"
            color="white"
            hoverStyle={{
              bg: '$brand6',
              borderColor: '$brand6',
            }}
          >
            Export
          </Button>
          {exportMode ? (
            <Button
              size="$2"
              theme="red"
              onPress={handleExportButtonClick}
              iconAfter={X}
            >
              Cancel
            </Button>
          ) : null}
        </XStack>
      )}
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
          bg={isDefault ? undefined : '$brand5'}
          hoverStyle={{
            bg: isDefault ? undefined : '$brand6',
            borderColor: isDefault ? undefined : '$brand6',
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
        <YGroup>
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
      color="white"
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
          bg={isEmptyFilter ? undefined : '$brand5'}
          color={isEmptyFilter ? undefined : 'white'}
          hoverStyle={{
            bg: isEmptyFilter ? undefined : '$brand6',
            borderColor: isEmptyFilter ? undefined : '$brand6',
          }}
        >
          {/* {allEditorialRolesSelected ? (
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
          )} */}
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
        <YGroup>
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
      <SizableText color="white" size="$1">
        {label}
      </SizableText>
      <TagXButton color="white" onPress={onX} />
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
          borderColor="$color8"
          hoverStyle={{
            borderColor: '$color9',
          }}
          checked={checked}
          onPress={(e: MouseEvent) => {
            e.stopPropagation()
          }}
          focusStyle={{borderColor: '$color10'}}
          onCheckedChange={onCheckedChange}
        >
          <Checkbox.Indicator borderColor="$color8">
            <Check color="$brand5" />
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

function LibraryCards() {
  return null
}

function LibraryList({
  library,
  exportMode,
  toggleDocumentSelection,
  selectedDocuments,
  allSelected,
  handleSelectAllChange,
}: {
  library: LibraryData
  exportMode: boolean
  toggleDocumentSelection: (id: string) => void
  selectedDocuments: Set<string>
  allSelected: boolean
  handleSelectAllChange: (checked: boolean) => void
}) {
  return (
    <YStack paddingVertical="$4" marginHorizontal={-8}>
      {exportMode && (
        <XStack
          paddingHorizontal={16}
          paddingVertical="$1"
          group="item"
          gap="$3"
          ai="center"
          f={1}
          h={60}
        >
          <Checkbox
            size="$3"
            checked={allSelected}
            onCheckedChange={handleSelectAllChange}
            borderColor="$color9"
            focusStyle={{
              borderColor: '$color9',
            }}
            hoverStyle={{
              borderColor: '$color9',
            }}
          >
            <Checkbox.Indicator>
              <Check color="$brand5" />
            </Checkbox.Indicator>
          </Checkbox>
          <SizableText fontSize="$4" fontWeight="800" textAlign="left">
            Select All
          </SizableText>
        </XStack>
      )}
      <YStack gap="$3">
        {library.items.length
          ? library.items.map((entry) => {
              const selected = selectedDocuments.has(entry.id.id)
              return (
                <LibraryListItem
                  key={entry.id.id}
                  entry={entry}
                  exportMode={exportMode}
                  selected={selected}
                  toggleDocumentSelection={toggleDocumentSelection}
                />
              )
            })
          : [...Array(5)].map((_, index) => <ListItemSkeleton key={index} />)}
      </YStack>
    </YStack>
  )
}
