import {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {IS_DESKTOP} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useMemo, useState} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {Feed} from './feed'
import {FeedDiscussions} from './feed-discussions'
import {useDocumentLayout} from './layout'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PageLayout} from './page-layout'
import {CommentEditorProps, computeHeaderData, PageWrapper} from './resource-page-common'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {Text} from './text'
import {useMedia} from './use-media'

/** View mode for the feed page. */
export type FeedPageView = 'feed' | 'discussions'

/** Props for the default feed page renderer. */
export interface FeedPageProps {
  docId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
  extraMenuItems?: MenuItemType[]
  rightActions?: React.ReactNode
  /** Controlled active view. Defaults to the raw feed. */
  feedView?: FeedPageView
  /** Called when the Feed/Discussions toggle changes. */
  onFeedViewChange?: (view: FeedPageView) => void
}

/** Render props exposed by the shared feed page shell. */
export interface FeedPageShellRenderProps {
  siteHomeId: UnpackedHypermediaId
  targetDomain?: string
}

/** Props for the shared feed page shell. */
export interface FeedPageShellProps {
  docId: UnpackedHypermediaId
  rightActions?: React.ReactNode
  children: (props: FeedPageShellRenderProps) => React.ReactNode
}

/** Shared page shell for feed-style pages that need the site header and feed chrome. */
export function FeedPageShell({docId, rightActions, children}: FeedPageShellProps) {
  const siteHomeId = hmId(docId.uid)
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})

  const siteHomeDocument: HMDocument | null =
    siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document : null

  const headerData = computeHeaderData(siteHomeDocument)
  const targetDomain = siteHomeDocument?.metadata?.siteUrl || undefined

  if (siteHomeResource.isInitialLoading) {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
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
      siteHomeId={siteHomeId}
      docId={docId}
      headerData={headerData}
      document={siteHomeDocument ?? undefined}
      isMainFeedVisible
      rightActions={rightActions}
    >
      {children({siteHomeId, targetDomain})}
    </PageWrapper>
  )
}

/** Props for the shared feed-page content layout. */
export interface FeedPageContentProps {
  title?: string
  extraMenuItems?: MenuItemType[]
  controls?: React.ReactNode
  children: React.ReactNode
}

/** Shared feed-page body layout with title row, optional controls, and scroll behavior. */
export function FeedPageContent({title = "What's New", extraMenuItems, controls, children}: FeedPageContentProps) {
  const {contentMaxWidth} = useDocumentLayout({
    contentWidth: undefined,
    showSidebars: false,
  })

  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP
  const menuItems = extraMenuItems || []

  const content = (
    <PageLayout contentMaxWidth={contentMaxWidth}>
      <div className="flex flex-col gap-4 pt-8">
        <div className="flex items-center justify-between gap-4 px-4">
          <Text weight="bold" size="3xl">
            {title}
          </Text>
          {menuItems.length > 0 ? <OptionsDropdown menuItems={menuItems} align="end" side="bottom" /> : null}
        </div>
        {controls ? <div className="px-4">{controls}</div> : null}
        <Separator />
        {children}
      </div>
    </PageLayout>
  )

  if (isMobile) {
    return <div className="flex flex-1 flex-col pb-16">{content}</div>
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <ScrollArea className="h-full">{content}</ScrollArea>
    </div>
  )
}

/** Reads the activity panel filter when the current route is a feed page. */
export function useFeedPageActivityFilter() {
  const route = useNavRoute()

  return useMemo(() => {
    if (route.key === 'feed' && route.panel?.key === 'activity') {
      return (route.panel as {filterEventType?: string[]}).filterEventType
    }
    return undefined
  }, [route])
}

/** Default raw activity feed page body used on web and desktop. */
export function FeedPage({
  docId,
  CommentEditor,
  extraMenuItems,
  rightActions,
  feedView,
  onFeedViewChange,
}: FeedPageProps) {
  const filterEventType = useFeedPageActivityFilter()
  const [localFeedView, setLocalFeedView] = useState<FeedPageView>('feed')
  const activeView = feedView ?? localFeedView
  const setActiveView = onFeedViewChange ?? setLocalFeedView

  return (
    <FeedPageShell docId={docId} rightActions={rightActions}>
      {({siteHomeId, targetDomain}) => (
        <FeedPageContent
          extraMenuItems={extraMenuItems}
          controls={<FeedPageViewToggle activeView={activeView} onChange={setActiveView} />}
        >
          {activeView === 'discussions' ? (
            <FeedDiscussions filterResource={`${siteHomeId.id}*`} CommentEditor={CommentEditor} />
          ) : (
            <Feed
              filterResource={`${siteHomeId.id}*`}
              targetDomain={targetDomain}
              size="md"
              filterEventType={filterEventType}
            />
          )}
        </FeedPageContent>
      )}
    </FeedPageShell>
  )
}

function FeedPageViewToggle({
  activeView,
  onChange,
}: {
  activeView: FeedPageView
  onChange: (view: FeedPageView) => void
}) {
  return (
    <div className="flex self-start rounded-md border">
      <Button
        size="sm"
        variant={activeView === 'feed' ? 'secondary' : 'ghost'}
        className="rounded-r-none border-0"
        onClick={() => onChange('feed')}
      >
        Feed
      </Button>
      <Button
        size="sm"
        variant={activeView === 'discussions' ? 'secondary' : 'ghost'}
        className="rounded-l-none border-0"
        onClick={() => onChange('discussions')}
      >
        Discussions
      </Button>
    </div>
  )
}
