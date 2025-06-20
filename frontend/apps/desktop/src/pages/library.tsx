import {templates} from '@/app-templates'
import {MainWrapper} from '@/components/main-wrapper'
import {CreateAccountBanner} from '@/components/onboarding'
import {useMarkAsRead} from '@/models/documents'

import {useExportDocuments} from '@/models/export-documents'
import {
  LibraryItem,
  LibrarySite,
  useLibrary,
  useSiteLibrary,
} from '@/models/library'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName} from '@shm/shared/content'
import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMBreadcrumb,
  HMDocumentInfo,
  HMLibraryDocument,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {DocumentRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {LibraryEntryUpdateSummary} from '@shm/ui/activity'
import {Checkbox} from '@shm/ui/components/checkbox'
import {Container, PanelContainer} from '@shm/ui/container'
import {FacePile} from '@shm/ui/face-pile'
import {HMIcon} from '@shm/ui/hm-icon'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {useIsDark} from '@shm/ui/use-is-dark'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileOutput,
  ListFilter,
  MessageSquare,
  X,
} from '@tamagui/lucide-icons'
import {ComponentProps, createContext, useContext, useState} from 'react'
import {GestureResponderEvent} from 'react-native'
import {
  Button,
  Popover,
  SizableText,
  View,
  XStack,
  YGroup,
  YStack,
} from 'tamagui'

export default function LibraryPage() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const libraryRoute = route.key === 'library' ? route : undefined
  const displayMode = libraryRoute?.displayMode || 'subscribed'
  function setDisplayMode(mode: 'all' | 'subscribed' | 'favorites') {
    replace({
      key: 'library',
      ...(libraryRoute || {}),
      displayMode: mode,
    })
  }
  const grouping = libraryRoute?.grouping || 'site'
  const setGrouping = (grouping: 'site' | 'none') => {
    replace({
      key: 'library',
      ...(libraryRoute || {}),
      grouping,
    })
  }
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const exportDocuments = useExportDocuments()
  const library = useLibrary({
    grouping,
    displayMode,
  })
  const markAsRead = useMarkAsRead()

  // Filter out template items when in subscribed mode
  const filteredItems = library?.items?.filter((item) => {
    if (displayMode === 'subscribed') {
      const templateIds = Object.values(templates)
      if (item.type === 'site') {
        return !templateIds.includes(item.id)
      }
    }
    return true
  })

  const isLibraryEmpty = filteredItems && filteredItems.length === 0

  return (
    <XStack flex={1} height="100%">
      <PanelContainer>
        <MainWrapper scrollable>
          <Container justifyContent="center" centered>
            <CreateAccountBanner />
            <XStack marginBottom="$4">
              <DisplayModeTab
                label="Subscribed"
                value="subscribed"
                activeValue={displayMode}
                onDisplayMode={setDisplayMode}
              />
              <DisplayModeTab
                label="Favorites"
                value="favorites"
                activeValue={displayMode}
                onDisplayMode={setDisplayMode}
              />
              <DisplayModeTab
                label="All"
                value="all"
                activeValue={displayMode}
                onDisplayMode={setDisplayMode}
              />
            </XStack>
            <XStack jc="space-between" marginVertical="$2" marginBottom="$4">
              <XStack gap="$2">
                <GroupingControl
                  grouping={grouping}
                  onGroupingChange={setGrouping}
                />
              </XStack>
              {isLibraryEmpty ? null : (
                <XStack gap="$3" ai="center">
                  <Button
                    size="$2"
                    onPress={() => {
                      if (isSelecting) {
                        exportDocuments(selectedDocIds).then((res) => {
                          setIsSelecting(false)
                          setSelectedDocIds([])
                        })
                      } else {
                        setIsSelecting(true)
                      }
                    }}
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
                  {isSelecting ? (
                    <Button
                      size="$2"
                      theme="red"
                      onPress={() => {
                        setIsSelecting(false)
                        setSelectedDocIds([])
                      }}
                      iconAfter={X}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  <OptionsDropdown
                    menuItems={[
                      {
                        label: 'Mark all as read',
                        key: 'mark-all-as-read',
                        icon: CheckCheck,
                        onPress: () => {
                          markAsRead(
                            library.items
                              ?.map((item) => {
                                if (item.type === 'site') {
                                  return hmId('d', item.id)
                                }
                                return hmId('d', item.account, {
                                  path: item.path,
                                })
                              })
                              .filter(
                                (id) => id !== null,
                              ) as UnpackedHypermediaId[],
                          )
                        },
                      },
                    ]}
                  />
                </XStack>
              )}
            </XStack>
            <librarySelectionContext.Provider
              value={{
                isSelecting,
                selectedDocIds,
                onSelect: (id, isSelected) => {
                  setSelectedDocIds(
                    isSelected
                      ? [...selectedDocIds, id]
                      : selectedDocIds.filter((id) => id !== id),
                  )
                },
              }}
            >
              {filteredItems?.map((item: LibraryItem) => {
                if (item.type === 'site') {
                  return (
                    <LibrarySiteItem
                      key={item.id}
                      site={item}
                      accountsMetadata={library.accountsMetadata}
                    />
                  )
                }
                return (
                  <LibraryDocumentItem
                    key={`${item.account}-${item.path}`}
                    item={item}
                    accountsMetadata={library.accountsMetadata || {}}
                  />
                )
              })}
            </librarySelectionContext.Provider>
          </Container>
        </MainWrapper>
      </PanelContainer>
    </XStack>
  )
}

function DisplayModeTab({
  label,
  value,
  activeValue,
  onDisplayMode,
}: {
  label: string
  value: 'all' | 'subscribed' | 'favorites'
  activeValue: 'all' | 'subscribed' | 'favorites'
  onDisplayMode: (value: 'all' | 'subscribed' | 'favorites') => void
}) {
  const borderWidth = 4
  const activationColor = activeValue === value ? '$brand5' : undefined
  return (
    <Button
      onPress={() => onDisplayMode(value)}
      borderWidth={0}
      borderColor="$colorTransparent"
      borderRadius={0}
      borderBottomWidth={borderWidth}
      borderBottomColor={activationColor}
      chromeless
      hoverStyle={{
        // borderWidth: 0,
        bg: '$colorTransparent',
        borderColor: '$brand5',
        borderBottomWidth: borderWidth,
        borderBottomColor: activationColor,
      }}
      focusStyle={{
        bg: '$colorTransparent',
        borderColor: '$brand5',
        borderBottomWidth: borderWidth,
        borderBottomColor: activationColor,
      }}
    >
      {label}
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

const groupingOptions: Readonly<{label: string; value: 'site' | 'none'}[]> = [
  {label: 'All Documents', value: 'none'},
  {label: 'Group by Site', value: 'site'},
] as const

function GroupingControl({
  grouping,
  onGroupingChange,
}: {
  grouping: 'site' | 'none'
  onGroupingChange: (grouping: 'site' | 'none') => void
}) {
  const popoverState = usePopoverState()
  return (
    <Popover {...popoverState} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button size="$2" paddingVertical={0} bg="$color5" icon={ListFilter} />
      </Popover.Trigger>
      <Popover.Content {...commonPopoverProps}>
        <YGroup>
          {groupingOptions.map((option) => (
            <Button
              size="$2"
              onPress={() => onGroupingChange(option.value)}
              key={option.value}
              iconAfter={grouping === option.value ? Check : null}
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

const librarySelectionContext = createContext<{
  isSelecting: boolean
  selectedDocIds: string[]
  onSelect: (id: string, isSelected: boolean) => void
}>({
  isSelecting: false,
  selectedDocIds: [],
  onSelect: () => {},
})

function SelectionCollapseButton({
  isCollapsed,
  setIsCollapsed,
  docId,
}: {
  isCollapsed: boolean | null
  setIsCollapsed?: (isCollapsed: boolean) => void
  docId: string
}) {
  const {isSelecting, selectedDocIds, onSelect} = useContext(
    librarySelectionContext,
  )
  const isSelected = selectedDocIds.includes(docId)
  if (isSelecting) {
    return (
      <Checkbox
        checked={isSelected}
        onCheckedChange={(isSelected: boolean) => onSelect(docId, !!isSelected)}
        onClick={(e) => {
          e.stopPropagation()
        }}
      />
    )
  }
  if (isCollapsed === null) return <View width="$1" />
  return (
    <Button
      icon={isCollapsed ? ChevronRight : ChevronDown}
      onPress={(e: GestureResponderEvent) => {
        e.stopPropagation()
        setIsCollapsed?.(!isCollapsed)
      }}
      circular
      size="$1"
    />
  )
}

function LibrarySiteItem({
  site,
  accountsMetadata,
}: {
  site: LibrarySite
  accountsMetadata?: HMAccountsMetadata
}) {
  const route = useNavRoute()
  const libraryRoute = route.key === 'library' ? route : undefined
  const replace = useNavigate('replace')
  const expandedIds =
    (route.key === 'library' ? route.expandedIds : undefined) || []
  const isCollapsed = !expandedIds.includes(site.id)
  function setIsCollapsed(isCollapsed: boolean) {
    replace({
      key: 'library',
      ...(libraryRoute || {}),
      expandedIds: isCollapsed
        ? expandedIds?.filter((id) => id !== site.id)
        : [...expandedIds, site.id],
    })
  }
  const isDark = useIsDark()
  const navigate = useNavigate()
  const metadata = site?.metadata
  const id = hmId('d', site.id)
  const documents = useSiteLibrary(site.id, !isCollapsed)
  const homeDocument = documents.data?.find((doc) => !doc.path?.length)
  const siteDisplayActivitySummary =
    !isCollapsed && homeDocument
      ? homeDocument.activitySummary
      : site.activitySummary
  const latestComment = isCollapsed
    ? site.latestComment
    : homeDocument?.latestComment
  const isRead = !siteDisplayActivitySummary?.isUnread
  const readBackground = isDark ? '$backgroundStrong' : '$background'
  return (
    <>
      <Button
        group="item"
        borderWidth={0}
        hoverStyle={{
          bg: '$color5',
        }}
        bg={isRead ? '$colorTransparent' : readBackground}
        paddingHorizontal={16}
        paddingVertical="$2"
        onPress={() => {
          navigate({key: 'document', id})
        }}
        h="auto"
        ai="center"
        // this data attribute is used by the hypermedia highlight component
        data-docid={id.id}
      >
        <SelectionCollapseButton
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          docId={id.id}
        />
        <HMIcon id={id} metadata={metadata} />
        <YStack f={1}>
          <XStack gap="$3" ai="center">
            <SizableText
              textAlign="left"
              f={1}
              fontWeight={isRead ? undefined : 'bold'}
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {getMetadataName(metadata)}
            </SizableText>
            {siteDisplayActivitySummary && (
              <LibraryEntryCommentCount
                activitySummary={siteDisplayActivitySummary}
              />
            )}
          </XStack>
          {siteDisplayActivitySummary && (
            <LibraryEntryUpdateSummary
              accountsMetadata={accountsMetadata}
              latestComment={latestComment}
              activitySummary={siteDisplayActivitySummary}
            />
          )}
        </YStack>
      </Button>
      {isCollapsed ? null : (
        <YStack>
          {documents.data?.map((item) => {
            if (item.path?.length === 0) return null
            return (
              <LibraryDocumentItem
                key={item.path?.join('/') || ''}
                item={item}
                accountsMetadata={accountsMetadata || {}}
              />
            )
          })}
        </YStack>
      )}
    </>
  )
}

export function LibraryDocumentItem({
  item,
  indent,
  accountsMetadata,
}: {
  item: HMLibraryDocument
  indent?: boolean
  accountsMetadata: HMAccountsMetadata
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  const isDark = useIsDark()
  const readBackground = isDark ? '$backgroundStrong' : '$background'
  const id = hmId('d', item.account, {
    path: item.path,
  })
  const isRead = !item.activitySummary?.isUnread
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: '$color5',
      }}
      bg={isRead ? '$colorTransparent' : readBackground}
      // elevation="$1"
      paddingHorizontal={16}
      paddingVertical="$2"
      onPress={() => {
        navigate({key: 'document', id})
      }}
      h="auto"
      marginVertical={'$1'}
      ai="center"
      // this data attribute is used by the hypermedia highlight component
      data-docid={id.id}
    >
      <SelectionCollapseButton isCollapsed={null} docId={id.id} />
      <View width={32} />

      <YStack f={1}>
        <LibraryEntryBreadcrumbs
          breadcrumbs={item.breadcrumbs}
          onNavigate={navigate}
          id={id}
        />
        <XStack gap="$3" ai="center">
          <SizableText
            textAlign="left"
            f={1}
            fontWeight={isRead ? undefined : 'bold'}
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            overflow="hidden"
          >
            {getMetadataName(metadata)}
          </SizableText>
          {item.activitySummary && (
            <LibraryEntryCommentCount activitySummary={item.activitySummary} />
          )}
          <LibraryEntryAuthors
            item={item}
            accountsMetadata={accountsMetadata}
          />
        </XStack>
        {item.activitySummary && (
          <LibraryEntryUpdateSummary
            accountsMetadata={accountsMetadata}
            latestComment={item.latestComment}
            activitySummary={item.activitySummary}
          />
        )}
      </YStack>
    </Button>
  )
}

function LibraryEntryBreadcrumbs({
  breadcrumbs,
  onNavigate,
  id,
}: {
  breadcrumbs: HMBreadcrumb[]
  onNavigate: (route: DocumentRoute) => void
  id: UnpackedHypermediaId
}) {
  const displayCrumbs = breadcrumbs.slice(1).filter((crumb) => !!crumb.name)
  if (!displayCrumbs.length) return null
  return (
    <XStack>
      {displayCrumbs.map((breadcrumb, idx) => (
        <>
          <Button
            key={breadcrumb.name}
            color="$color10"
            fontWeight="400"
            size="$1"
            textProps={{
              hoverStyle: {
                color: '$color',
              },
            }}
            margin={0}
            marginRight="$1"
            paddingHorizontal={0}
            hoverStyle={{
              bg: '$colorTransparent',
            }}
            borderWidth={0}
            bg="$colorTransparent"
            onPress={(e: GestureResponderEvent) => {
              e.stopPropagation()
              onNavigate({
                key: 'document',
                id: {...id, path: entityQueryPathToHmIdPath(breadcrumb.path)},
              })
            }}
          >
            {breadcrumb.name}
          </Button>
          {idx === displayCrumbs.length - 1 ? null : (
            <SizableText
              size="$1"
              color="$color10"
              margin={0}
              marginRight="$1"
              key={`separator-${idx}`}
            >
              /
            </SizableText>
          )}
        </>
      ))}
    </XStack>
  )
}

function LibraryEntryCommentCount({
  activitySummary,
}: {
  activitySummary: HMActivitySummary
}) {
  const commentCount = activitySummary?.commentCount
  if (!commentCount) return null
  return (
    <XStack gap="$1" ai="center">
      <MessageSquare size={16} />
      <SizableText size="$1">{commentCount}</SizableText>
    </XStack>
  )
}

function LibraryEntryAuthors({
  item,
  accountsMetadata,
}: {
  item: HMDocumentInfo
  accountsMetadata: HMAccountsMetadata
}) {
  const {authors} = item
  return <FacePile accounts={authors} accountsMetadata={accountsMetadata} />
  // return <XStack>{authors.map((author) => <LinkIcon id={author.id} metadata={author.metadata} size={16} />)}</XStack>
}
