import {GettingStarted} from '@/components/getting-started'
import {MainWrapper} from '@/components/main-wrapper'
import {useAccounts} from '@/models/accounts'

import {useExportDocuments} from '@/models/export-documents'
import {
  LibraryDocument,
  LibrarySite,
  useLibrary,
  useSiteLibrary,
} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {
  ActivitySummary,
  BlockNode,
  Breadcrumb,
  DocumentInfo,
  DocumentRoute,
  entityQueryPathToHmIdPath,
  formattedDateMedium,
  getMetadataName,
  HMComment,
  hmId,
  normalizeDate,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  Checkbox,
  Container,
  HMIcon,
  SizableText,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {AccountsMetadata, FacePile} from '@shm/ui/src/face-pile'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileOutput,
  MessageSquare,
  X,
} from '@tamagui/lucide-icons'
import {createContext, useContext, useState} from 'react'
import {GestureResponderEvent} from 'react-native'

export default function LibraryPage() {
  const library = useLibrary()
  const accounts = useAccounts()
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const exportDocuments = useExportDocuments()
  const isLibraryEmpty = library && library.length === 0
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>
          <XStack jc="flex-end" marginVertical="$2" marginBottom="$4">
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
            {library?.map((site: LibrarySite) => (
              <LibrarySiteItem
                key={site.id}
                site={site}
                accountsMetadata={accounts.data?.accountsMetadata}
              />
            ))}
          </librarySelectionContext.Provider>
        </Container>
      </MainWrapper>
    </XStack>
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
  const homeDocument = documents.data?.find(
    (doc: LibraryDocument) => doc.path === '',
  )
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
        paddingVertical="$1"
        onPress={() => {
          navigate({key: 'document', id})
        }}
        h={68}
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
              <LibraryEntryTime activitySummary={siteDisplayActivitySummary} />
            )}
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
          {documents.data?.map((item: LibraryDocument) => {
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
      paddingVertical="$1"
      onPress={() => {
        navigate({key: 'document', id})
      }}
      h={68}
      marginVertical={margin ? '$1' : undefined}
      ai="center"
    >
      <SelectionCollapseButton isCollapsed={null} docId={id.id} />
      <HMIcon id={id} metadata={metadata} />

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
            <LibraryEntryTime activitySummary={item.activitySummary} />
          )}
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
  activitySummary: PlainMessage<ActivitySummary>
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
      <SizableText flexShrink={0} numberOfLines={1} size="$1">
        {formattedDateMedium(displayTime)}
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
  activitySummary: PlainMessage<ActivitySummary>
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
    <SizableText numberOfLines={1} size="$1">
      {summaryText}
    </SizableText>
  )
}

function plainTextOfContent(content: PlainMessage<BlockNode>[]): string {
  // todo, make this better
  return content.map((block) => block.block?.text).join(' ')
}

function LibraryEntryBreadcrumbs({
  breadcrumbs,
  onNavigate,
  id,
}: {
  breadcrumbs: PlainMessage<Breadcrumb>[]
  onNavigate: (route: DocumentRoute) => void
  id: UnpackedHypermediaId
}) {
  const displayCrumbs = breadcrumbs.slice(1, -1)
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
  activitySummary: PlainMessage<ActivitySummary>
}) {
  const commentCount = activitySummary?.commentCount
  if (!commentCount) return null
  return (
    <XStack gap="$1" ai="center">
      <MessageSquare size={16} />
      <SizableText size="$2" fontWeight="bold">
        {commentCount}
      </SizableText>
    </XStack>
  )
}

function LibraryEntryAuthors({
  item,
  accountsMetadata,
}: {
  item: PlainMessage<DocumentInfo>
  accountsMetadata: AccountsMetadata
}) {
  const {authors} = item
  return <FacePile accounts={authors} accountsMetadata={accountsMetadata} />
  // return <XStack>{authors.map((author) => <LinkIcon id={author.id} metadata={author.metadata} size={16} />)}</XStack>
}
