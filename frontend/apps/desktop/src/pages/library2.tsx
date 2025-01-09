import {MainWrapper} from '@/components/main-wrapper'
import {useAccounts} from '@/models/accounts'

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
  DocumentListItem,
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

// const defaultSort: LibraryQueryState['sort'] = 'lastUpdate'

export default function Library2Page() {
  const library = useLibrary()
  const accounts = useAccounts()
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>
          {library?.map((site) => (
            <LibrarySiteItem
              key={site.id}
              site={site}
              accountsMetadata={accounts.data?.accountsMetadata}
              isRead={Math.random() > 0.5}
            />
          ))}
        </Container>
      </MainWrapper>
    </XStack>
  )
}

function LibrarySiteItem({
  site,
  isRead,
  accountsMetadata,
}: {
  site: LibrarySite
  isRead: boolean
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
        {isCollapsed == null ? (
          <View width="$1" />
        ) : (
          <Button
            icon={isCollapsed ? ChevronRight : ChevronDown}
            onPress={(e) => {
              e.stopPropagation()
              setIsCollapsed(!isCollapsed)
            }}
            circular
            size="$1"
          />
        )}
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
          {documents.data?.map((item) => {
            if (item.path === '') return null
            return (
              <LibraryDocumentItem
                item={item}
                accountsMetadata={accountsMetadata || {}}
                isRead={Math.random() > 0.5}
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
  isRead,
  margin,
  accountsMetadata,
}: {
  item: LibraryDocument
  isRead?: boolean
  margin?: boolean
  accountsMetadata: AccountsMetadata
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  const id = hmId('d', item.account, {
    path: entityQueryPathToHmIdPath(item.path),
  })
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
      <View width="$1" />
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
  if (latestCommentTime) {
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
  item: PlainMessage<DocumentListItem>
  accountsMetadata: AccountsMetadata
}) {
  const {authors} = item
  return <FacePile accounts={authors} accountsMetadata={accountsMetadata} />
  // return <XStack>{authors.map((author) => <LinkIcon id={author.id} metadata={author.metadata} size={16} />)}</XStack>
}
