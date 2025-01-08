import {MainWrapper} from '@/components/main-wrapper'
import {useListProfileDocuments} from '@/models/documents'

import {LibraryQueryState, LibrarySite, useLibrary2} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {
  Breadcrumb,
  DocumentListItem,
  DocumentRoute,
  entityQueryPathToHmIdPath,
  formattedDateMedium,
  getMetadataName,
  hmId,
  normalizeDate,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  Container,
  HMIcon,
  SizableText,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {AccountsMetadata, FacePile} from '@shm/ui/src/face-pile'
import {ChevronDown, ChevronRight, MessageSquare} from '@tamagui/lucide-icons'
import {useState} from 'react'

const defaultSort: LibraryQueryState['sort'] = 'lastUpdate'

export default function Library2Page() {
  const contacts = useListProfileDocuments()
  const lib = useLibrary2()
  console.log('lib data', lib.data)
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>
          {lib.data?.items?.map((site) => (
            <LibrarySiteItem
              key={site.entityUid}
              site={site}
              accountsMetadata={lib.data?.authors}
            />
          ))}
        </Container>
      </MainWrapper>
    </XStack>
  )
}

function LibrarySiteItem({
  site,
  accountsMetadata,
}: {
  site: LibrarySite
  accountsMetadata: AccountsMetadata
}) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  if (!site.homeItem) return null
  return (
    <>
      <LibraryListItem
        item={site.homeItem}
        accountsMetadata={accountsMetadata}
        isCollapsed={site.items.length > 0 ? isCollapsed : undefined}
        onSetCollapsed={setIsCollapsed}
        margin
      />
      {isCollapsed ? null : (
        <YStack>
          {site.items.map((item) => (
            <LibraryListItem
              item={item}
              accountsMetadata={accountsMetadata}
              isRead={Math.random() > 0.5}
            />
          ))}
        </YStack>
      )}
    </>
  )
}

export function LibraryListItem({
  item,
  isCollapsed,
  onSetCollapsed,
  isRead,
  margin,
  accountsMetadata,
}: {
  item: PlainMessage<DocumentListItem>
  isCollapsed?: boolean
  onSetCollapsed?: (isCollapsed: boolean) => void
  isRead?: boolean
  margin?: boolean
  accountsMetadata: AccountsMetadata
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  const id = hmId('d', item.account, {
    path: entityQueryPathToHmIdPath(item.path),
  })

  const hoverColor = '$color5'
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: hoverColor,
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
      {isCollapsed == null ? (
        <View width="$1" />
      ) : (
        <Button
          icon={isCollapsed ? ChevronRight : ChevronDown}
          onPress={(e) => {
            e.stopPropagation()
            onSetCollapsed?.(!isCollapsed)
          }}
          circular
          size="$1"
        />
      )}
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
          <LibraryEntryTime item={item} />
          <LibraryEntryCommentCount item={item} />
          <LibraryEntryAuthors
            item={item}
            accountsMetadata={accountsMetadata}
          />
        </XStack>
        <LibraryEntryUpdateSummary item={item} />
      </YStack>
      <XStack gap="$3" ai="center">
        <XStack>
          {/* {editors.map((author, idx) => (
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
              <LinkIcon
                key={author.id.id}
                id={author.id}
                metadata={author.metadata}
                size={20}
              />
            </XStack>
          ))}
          {entry.authors.length > editors.length && editors.length != 0 ? (
            <XStack
              zIndex="$zIndex.1"
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
          ) : null} */}
        </XStack>
      </XStack>
    </Button>
  )
}

function LibraryEntryTime({item}: {item: PlainMessage<DocumentListItem>}) {
  const {activitySummary} = item
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
  item,
}: {
  item: PlainMessage<DocumentListItem>
}) {
  const {activitySummary} = item
  const latestChangeTime = normalizeDate(activitySummary?.latestChangeTime)
  const latestCommentTime = normalizeDate(activitySummary?.latestCommentTime)
  let summaryText = ''
  if (latestChangeTime) {
    summaryText = `Document Changed`
  }
  if (latestCommentTime) {
    summaryText = `Comment`
  }
  return <SizableText size="$1">{summaryText}</SizableText>
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
  if (breadcrumbs.length > 3) console.log('~ displayCrumbs', displayCrumbs)
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
            onPress={(e) => {
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
  item,
}: {
  item: PlainMessage<DocumentListItem>
}) {
  const {activitySummary} = item
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
  item: PlainMessage<DocumentListItem>
  accountsMetadata: AccountsMetadata
}) {
  const {authors} = item
  return <FacePile accounts={authors} accountsMetadata={accountsMetadata} />
  // return <XStack>{authors.map((author) => <LinkIcon id={author.id} metadata={author.metadata} size={16} />)}</XStack>
}
