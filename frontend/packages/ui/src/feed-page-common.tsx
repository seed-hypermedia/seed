import {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {IS_DESKTOP} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useMemo} from 'react'
import {ScrollArea} from './components/scroll-area'
import {Feed} from './feed'
import {GeneralPageContainer, GeneralPageHeader} from './general-page'
import {useDocumentLayout} from './layout'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {CommentEditorProps, computeHeaderData, PageWrapper} from './resource-page-common'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {useMedia} from './use-media'

export interface FeedPageProps {
  docId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
  extraMenuItems?: MenuItemType[]
  rightActions?: React.ReactNode
}

export function FeedPage({docId, extraMenuItems, rightActions}: FeedPageProps) {
  const spaceHomeId = hmId(docId.uid)
  const spaceHomeResource = useResource(spaceHomeId, {subscribed: true})

  const spaceHomeDocument: HMDocument | null =
    spaceHomeResource.data?.type === 'document' ? spaceHomeResource.data.document : null

  const headerData = computeHeaderData(spaceHomeDocument)

  const targetDomain = spaceHomeDocument?.metadata?.siteUrl || undefined

  if (spaceHomeResource.isInitialLoading) {
    return (
      <PageWrapper
        spaceHomeId={spaceHomeId}
        docId={docId}
        headerData={headerData}
        isMainFeedVisible
        rightActions={rightActions}
      >
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper
      spaceHomeId={spaceHomeId}
      docId={docId}
      headerData={headerData}
      document={spaceHomeDocument ?? undefined}
      isMainFeedVisible
      rightActions={rightActions}
    >
      <FeedBody spaceHomeId={spaceHomeId} extraMenuItems={extraMenuItems} targetDomain={targetDomain} />
    </PageWrapper>
  )
}

function FeedBody({
  spaceHomeId,
  extraMenuItems,
  targetDomain,
}: {
  spaceHomeId: UnpackedHypermediaId
  extraMenuItems?: MenuItemType[]
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
  // In Electron (IS_DESKTOP), always use element scroll regardless of window width
  const isMobile = media.xs && !IS_DESKTOP

  const menuItems = extraMenuItems || []
  const actionButtons =
    menuItems.length > 0 ? <OptionsDropdown menuItems={menuItems} align="end" side="bottom" /> : null

  const feedContent = (
    <GeneralPageContainer contentMaxWidth={contentMaxWidth}>
      <GeneralPageHeader title="Activity Feed" />
      <Separator />
      <Feed
        filterResource={`${spaceHomeId.id}*`}
        targetDomain={targetDomain}
        size="md"
        filterEventType={filterEventType}
      />
    </GeneralPageContainer>
  )

  if (isMobile) {
    return (
      <div className="relative flex flex-1 flex-col pb-16">
        {actionButtons ? (
          <div className="absolute top-2 right-2 z-40 flex items-center gap-1 rounded-sm transition-opacity md:top-4 md:right-4">
            {actionButtons}
          </div>
        ) : null}
        {feedContent}
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {actionButtons ? (
        <div className="absolute top-2 right-2 z-40 flex items-center gap-1 rounded-sm transition-opacity md:top-4 md:right-4">
          {actionButtons}
        </div>
      ) : null}
      <ScrollArea className="h-full">{feedContent}</ScrollArea>
    </div>
  )
}
