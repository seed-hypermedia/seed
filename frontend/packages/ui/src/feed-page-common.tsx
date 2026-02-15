import {HMDocument, hmId, UnpackedHypermediaId} from '@shm/shared'
import {useDirectory, useResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useMemo} from 'react'
import {ScrollArea} from './components/scroll-area'
import {Feed} from './feed'
import {useDocumentLayout} from './layout'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PageLayout} from './page-layout'
import {
  CommentEditorProps,
  computeHeaderData,
  PageWrapper,
} from './resource-page-common'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {Text} from './text'
import {useMedia} from './use-media'

export interface FeedPageProps {
  docId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
  extraMenuItems?: MenuItemType[]
  currentAccountUid?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
}

export function FeedPage({
  docId,
  extraMenuItems,
  currentAccountUid,
  onCommentDelete,
}: FeedPageProps) {
  const siteHomeId = hmId(docId.uid)
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})
  const homeDirectory = useDirectory(siteHomeId)

  const siteHomeDocument: HMDocument | null =
    siteHomeResource.data?.type === 'document'
      ? siteHomeResource.data.document
      : null

  const headerData = computeHeaderData(
    siteHomeId,
    siteHomeDocument,
    homeDirectory.data,
  )

  const targetDomain = siteHomeDocument?.metadata?.siteUrl || undefined

  if (siteHomeResource.isInitialLoading) {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
        isMainFeedVisible
      >
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper
      siteHomeId={siteHomeId}
      docId={docId}
      headerData={headerData}
      document={siteHomeDocument ?? undefined}
      isMainFeedVisible
    >
      <FeedBody
        siteHomeId={siteHomeId}
        extraMenuItems={extraMenuItems}
        currentAccountUid={currentAccountUid}
        onCommentDelete={onCommentDelete}
        targetDomain={targetDomain}
      />
    </PageWrapper>
  )
}

function FeedBody({
  siteHomeId,
  extraMenuItems,
  currentAccountUid,
  onCommentDelete,
  targetDomain,
}: {
  siteHomeId: UnpackedHypermediaId
  extraMenuItems?: MenuItemType[]
  currentAccountUid?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  targetDomain?: string
}) {
  const route = useNavRoute()

  const filterEventType = useMemo(() => {
    if (route.key === 'feed' && route.panel?.key === 'activity') {
      return (route.panel as any).filterEventType
    }
    return undefined
  }, [route])

  const {contentMaxWidth} = useDocumentLayout({
    contentWidth: undefined,
    showSidebars: false,
  })

  const media = useMedia()
  const isMobile = media.xs

  const menuItems = extraMenuItems || []

  const feedContent = (
    <PageLayout centered contentMaxWidth={contentMaxWidth}>
      <div className="flex flex-col gap-4 pt-8">
        <div className="flex items-center justify-between">
          <Text weight="bold" size="3xl">
            What's New
          </Text>
          {menuItems.length > 0 && (
            <OptionsDropdown menuItems={menuItems} align="end" side="bottom" />
          )}
        </div>
        <Separator />
        <Feed
          filterResource={`${siteHomeId.id}*`}
          currentAccount={currentAccountUid || ''}
          onCommentDelete={onCommentDelete}
          targetDomain={targetDomain}
          size="md"
          centered
          filterEventType={filterEventType}
        />
      </div>
    </PageLayout>
  )

  if (isMobile) {
    return <div className="flex flex-1 flex-col pb-16">{feedContent}</div>
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <ScrollArea className="h-full">{feedContent}</ScrollArea>
    </div>
  )
}
