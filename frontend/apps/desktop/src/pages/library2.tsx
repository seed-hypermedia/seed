import {GettingStarted} from '@/components/getting-started'
import {MainWrapper} from '@/components/main-wrapper'

import {useExportDocuments} from '@/models/export-documents'
import {
  LibraryDocument,
  LibraryItem,
  LibrarySite,
  useLibrary,
  useSiteLibrary,
} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocumentRoute,
  entityQueryPathToHmIdPath,
  formattedDate,
  getMetadataName,
  HMActivitySummary,
  HMBlockNode,
  HMBreadcrumb,
  HMComment,
  HMDocumentInfo,
  hmId,
  normalizeDate,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  Checkbox,
  Container,
  HMIcon,
  Popover,
  SizableText,
  usePopoverState,
  View,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {AccountsMetadata, FacePile} from '@shm/ui/src/face-pile'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileOutput,
  ListFilter,
  MessageSquare,
  X,
} from '@tamagui/lucide-icons'
import {ComponentProps, createContext, useContext, useState} from 'react'
import {GestureResponderEvent} from 'react-native'

export default function LibraryPage() {
  const [grouping, setGrouping] = useState<'site' | 'none'>('site')
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const exportDocuments = useExportDocuments()
  const library = useLibrary({
    grouping,
  })
  const isLibraryEmpty = library && library.items && library.items.length === 0
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>
          <XStack jc="space-between" marginVertical="$2" marginBottom="$4">
            <XStack gap="$2">
              <GroupingControl
                grouping={grouping}
                onGroupingChange={setGrouping}
              />
            </XStack>
            {isLibraryEmpty ? null : (
              <XStack gap="$2">
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
            {isLibraryEmpty ? <GettingStarted /> : null}
            {library?.items?.map((item: LibraryItem) => {
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
    </XStack>
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
        onCheckedChange={(isSelected) => onSelect(docId, !!isSelected)}
        size="$3"
        borderColor="$color8"
        hoverStyle={{
          borderColor: '$color9',
        }}
        onPress={(e: GestureResponderEvent) => {
          e.stopPropagation()
        }}
        focusStyle={{borderColor: '$color10'}}
      >
        <Checkbox.Indicator borderColor="$color8">
          <Check color="$brand5" />
        </Checkbox.Indicator>
      </Checkbox>
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
  accountsMetadata?: AccountsMetadata
}) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const navigate = useNavigate()
  const metadata = site?.metadata
  const id = hmId('d', site.id)
  const documents = useSiteLibrary(site.id, !isCollapsed)
  const homeDocument = documents.data?.find((doc) => doc.path === '')
  const siteDisplayActivitySummary =
    !isCollapsed && homeDocument
      ? homeDocument.activitySummary
      : site.activitySummary
  const latestComment = isCollapsed
    ? site.latestComment
    : homeDocument?.latestComment
  const isRead = !siteDisplayActivitySummary?.isUnread
  return (
    <>
      <Button
        group="item"
        borderWidth={0}
        hoverStyle={{
          bg: '$color5',
        }}
        bg={isRead ? '$colorTransparent' : '$backgroundStrong'}
        paddingHorizontal={16}
        paddingVertical="$2"
        onPress={() => {
          navigate({key: 'document', id})
        }}
        h="auto"
        ai="center"
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
            if (item.path === '') return null
            return (
              <LibraryDocumentItem
                key={item.path}
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
  margin,
  accountsMetadata,
}: {
  item: LibraryDocument
  margin?: boolean
  accountsMetadata: AccountsMetadata
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  const id = hmId('d', item.account, {
    path: entityQueryPathToHmIdPath(item.path),
  })
  const isRead = !item.activitySummary?.isUnread
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: '$color5',
      }}
      bg={isRead ? '$colorTransparent' : '$backgroundStrong'}
      // elevation="$1"
      paddingHorizontal={16}
      paddingVertical="$2"
      onPress={() => {
        navigate({key: 'document', id})
      }}
      h="auto"
      marginVertical={margin ? '$1' : undefined}
      ai="center"
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

function LibraryEntryTime({
  activitySummary,
}: {
  activitySummary: HMActivitySummary
}) {
  const latestChangeTime = normalizeDate(activitySummary?.latestChangeTime)
  const latestCommentTime = normalizeDate(activitySummary?.latestCommentTime)
  const displayTime =
    latestCommentTime &&
    latestChangeTime &&
    latestCommentTime > latestChangeTime
      ? latestCommentTime
      : latestChangeTime
  if (displayTime) {
    return (
      <SizableText flexShrink={0} numberOfLines={1} size="$1" color="$color9">
        ({formattedDate(displayTime)})
      </SizableText>
    )
  }
  return null
}

function LibraryEntryUpdateSummary({
  activitySummary,
  accountsMetadata,
  latestComment,
}: {
  activitySummary: HMActivitySummary
  accountsMetadata: AccountsMetadata | undefined
  latestComment: HMComment | undefined | null
}) {
  const latestChangeTime = normalizeDate(activitySummary?.latestChangeTime)
  const latestCommentTime = normalizeDate(activitySummary?.latestCommentTime)
  let summaryText = ''
  if (latestChangeTime) {
    summaryText = `Document Changed`
  }
  if (
    latestCommentTime &&
    latestChangeTime &&
    latestCommentTime > latestChangeTime
  ) {
    const author = latestComment?.author
      ? accountsMetadata?.[latestComment?.author]
      : undefined
    const authorName = author?.metadata?.name
    summaryText = `Comment`
    if (authorName && latestComment) {
      summaryText = `${authorName}: ${plainTextOfContent(
        latestComment.content,
      )}`
    }
  }
  return (
    <XStack gap="$2">
      <SizableText numberOfLines={1} size="$1" color="$color9">
        {summaryText}
      </SizableText>
      <LibraryEntryTime activitySummary={activitySummary} />
    </XStack>
  )
}

function plainTextOfContent(content: HMBlockNode[]): string {
  // todo, make this better
  return content.map((block) => block.block?.text).join(' ')
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
            <SizableText size="$1" color="$color10" margin={0} marginRight="$1">
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
  accountsMetadata: AccountsMetadata
}) {
  const {authors} = item
  return <FacePile accounts={authors} accountsMetadata={accountsMetadata} />
  // return <XStack>{authors.map((author) => <LinkIcon id={author.id} metadata={author.metadata} size={16} />)}</XStack>
}
