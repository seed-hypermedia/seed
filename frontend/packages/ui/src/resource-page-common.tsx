import {
  BlockRange,
  DocumentPanelRoute,
  HMDocument,
  hmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useDirectory, useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {getRoutePanel} from '@shm/shared/routes'
import {routeToUrl} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  BlockRangeSelectOptions,
  BlocksContent,
  BlocksContentProvider,
} from './blocks-content'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {ReadOnlyCollaboratorsContent} from './collaborators-page'
import {ScrollArea} from './components/scroll-area'
import {DirectoryPageContent} from './directory-page'
import {DiscussionsPageContent} from './discussions-page'
import {OpenInPanelButton} from './open-in-panel'
import {PageLayout} from './page-layout'
import {DocumentCover} from './document-cover'
import {DocumentHeader} from './document-header'
import {DocumentTools} from './document-tools'
import {Feed} from './feed'
import {useDocumentLayout} from './layout'
import {MobileInteractionBar} from './mobile-interaction-bar'
import {MobilePanelSheet} from './mobile-panel-sheet'
import {DocNavigationItem, getSiteNavDirectory} from './navigation'
import {PageDeleted, PageDiscovery, PageNotFound} from './page-message-states'
import {PanelLayout} from './panel-layout'
import {SiteHeader} from './site-header'
import {Spinner} from './spinner'
import {useMedia} from './use-media'
import {cn} from './utils'

export type ActiveView =
  | 'content'
  | 'activity'
  | 'discussions'
  | 'directory'
  | 'collaborators'

function getActiveView(routeKey: string): ActiveView {
  switch (routeKey) {
    case 'activity':
      return 'activity'
    case 'discussions':
      return 'discussions'
    case 'directory':
      return 'directory'
    case 'collaborators':
      return 'collaborators'
    default:
      return 'content'
  }
}

export interface CommentEditorProps {
  docId: UnpackedHypermediaId
  quotingBlockId?: string
  autoFocus?: boolean
}

/** Mobile-specific configuration for the ResourcePage */
export interface MobileConfig {
  /** Current user account (null if not logged in) */
  account?: {
    id: UnpackedHypermediaId
    metadata?: {name?: string; icon?: string}
  } | null
  /** Callback for avatar click (e.g., to open account creation) */
  onAvatarClick?: () => void
  /** Additional content to render (e.g., account creation dialog) */
  extraContent?: ReactNode
}

export interface ResourcePageProps {
  docId: UnpackedHypermediaId
  /** Factory to create comment editor - platform-specific (web vs desktop) */
  CommentEditor?: React.ComponentType<CommentEditorProps>
  /** Mobile-specific configuration (web only) */
  mobileConfig?: MobileConfig
}

/** Get panel title for display */
function getPanelTitle(panelKey: string | null): string {
  switch (panelKey) {
    case 'activity':
      return 'Activity'
    case 'discussions':
      return 'Discussions'
    case 'directory':
      return 'Directory'
    case 'collaborators':
      return 'Collaborators'
    default:
      return 'Panel'
  }
}

export function ResourcePage({
  docId,
  CommentEditor,
  mobileConfig,
}: ResourcePageProps) {
  // Load document data via React Query (hydrated from SSR prefetch)
  const resource = useResource(docId, {
    subscribed: true,
    recursive: true,
  })

  // Load home site entity for header (always load this so header can show)
  const siteHomeId = hmId(docId.uid)
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})
  const homeDirectory = useDirectory(siteHomeId)

  const siteHomeDocument =
    siteHomeResource.data?.type === 'document'
      ? siteHomeResource.data.document
      : null

  // Compute header data
  const headerData = computeHeaderData(
    siteHomeId,
    siteHomeDocument,
    homeDirectory.data,
  )

  // Loading state - should not show during SSR if data was prefetched
  if (resource.isInitialLoading) {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    )
  }

  // Handle discovery state
  if (resource.isDiscovering) {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <PageDiscovery />
      </PageWrapper>
    )
  }

  // Handle not-found
  if (!resource.data || resource.data.type === 'not-found') {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <PageNotFound />
      </PageWrapper>
    )
  }

  // Handle tombstone (deleted)
  if (resource.isTombstone || resource.data.type === 'tombstone') {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <PageDeleted />
      </PageWrapper>
    )
  }

  // Handle error
  if (resource.data.type === 'error') {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-destructive">{resource.data.message}</div>
        </div>
      </PageWrapper>
    )
  }

  // Handle redirect - for now just show not found, redirect handling comes later
  if (resource.data.type === 'redirect') {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <PageNotFound />
      </PageWrapper>
    )
  }

  // Success: render document
  if (resource.data.type !== 'document') {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
      >
        <PageNotFound />
      </PageWrapper>
    )
  }
  const document = resource.data.document

  return (
    <PageWrapper
      siteHomeId={siteHomeId}
      docId={docId}
      headerData={headerData}
      document={document}
    >
      <DocumentBody
        docId={docId}
        document={document}
        CommentEditor={CommentEditor}
        mobileConfig={mobileConfig}
      />
    </PageWrapper>
  )
}

// Header data computed from site home document
interface HeaderData {
  items: DocNavigationItem[]
  homeNavigationItems: DocNavigationItem[]
  directoryItems: DocNavigationItem[]
  isCenterLayout: boolean
  siteHomeDocument: HMDocument | null
}

function computeHeaderData(
  siteHomeId: UnpackedHypermediaId,
  siteHomeDocument: HMDocument | null,
  directory: ReturnType<typeof useDirectory>['data'],
): HeaderData {
  // Compute navigation items from home document's navigation block
  const navigationBlockNode = siteHomeDocument?.detachedBlocks?.navigation
  const homeNavigationItems: DocNavigationItem[] = navigationBlockNode
    ? navigationBlockNode.children
        ?.map((child) => {
          const linkBlock = child.block.type === 'Link' ? child.block : null
          if (!linkBlock) return null
          const id = unpackHmId(linkBlock.link)
          return {
            isPublished: true,
            isDraft: false,
            key: linkBlock.id,
            metadata: {name: linkBlock.text || ''},
            id: id || undefined,
            webUrl: id ? undefined : linkBlock.link,
          } as DocNavigationItem
        })
        .filter((item): item is DocNavigationItem => item !== null) ?? []
    : []

  const directoryItems = getSiteNavDirectory({
    id: siteHomeId,
    directory: directory ?? undefined,
  })

  const items =
    homeNavigationItems.length > 0 ? homeNavigationItems : directoryItems

  const isCenterLayout =
    siteHomeDocument?.metadata?.theme?.headerLayout === 'Center' ||
    siteHomeDocument?.metadata?.layout === 'Seed/Experimental/Newspaper'

  return {
    items,
    homeNavigationItems,
    directoryItems,
    isCenterLayout,
    siteHomeDocument,
  }
}

// Wrapper that renders SiteHeader + content
function PageWrapper({
  siteHomeId,
  docId,
  headerData,
  document,
  children,
}: {
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId
  headerData: HeaderData
  document?: HMDocument
  children: React.ReactNode
}) {
  // Mobile: let content flow naturally (document scroll)
  // Desktop: fixed height container (element scroll via ScrollArea in children)
  const media = useMedia()
  const isMobile = media.xs

  return (
    <div
      className={cn(
        'flex flex-col',
        // On desktop: fill viewport height for element scrolling (use dvh for mobile browsers)
        // On mobile: natural height for document scrolling
        isMobile ? 'min-h-dvh' : 'h-dvh',
      )}
    >
      <SiteHeader
        siteHomeId={siteHomeId}
        docId={docId}
        items={headerData.items}
        homeNavigationItems={headerData.homeNavigationItems}
        directoryItems={headerData.directoryItems}
        isCenterLayout={headerData.isCenterLayout}
        document={document}
        siteHomeDocument={headerData.siteHomeDocument}
        isMainFeedVisible={false}
      />
      {children}
    </div>
  )
}

// Document body with content
function DocumentBody({
  docId,
  document,
  CommentEditor,
  mobileConfig,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  CommentEditor?: React.ComponentType<CommentEditorProps>
  mobileConfig?: MobileConfig
}) {
  const route = useNavRoute()
  const navigate = useNavigate()
  const activeView = getActiveView(route.key)

  // Extract panel from route (only document/feed routes have panels)
  const panelRoute = getRoutePanel(route) as DocumentPanelRoute | null
  const panelKey = panelRoute?.key ?? null

  // Extract discussions-specific params from route
  const discussionsParams =
    route.key === 'discussions'
      ? {
          openComment: route.openComment,
          targetBlockId: route.targetBlockId,
          blockId: route.blockId,
          blockRange: route.blockRange,
        }
      : undefined

  const isHomeDoc = !docId.path?.length
  const directory = useDirectory(docId)
  const interactionSummary = useInteractionSummary(docId)

  // Track when DocumentTools becomes sticky
  const [isToolsSticky, setIsToolsSticky] = useState(false)
  const toolsSentinelRef = useRef<HTMLDivElement>(null)

  // Mobile panel state
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)

  useEffect(() => {
    const sentinel = toolsSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        // When sentinel is not intersecting (scrolled out of view), tools are sticky
        setIsToolsSticky(!entry.isIntersecting)
      },
      {threshold: 0.1, rootMargin: '0px'},
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    wrapperProps,
    contentMaxWidth,
  } = useDocumentLayout({
    contentWidth: document.metadata?.contentWidth,
    showSidebars:
      !isHomeDoc &&
      document.metadata?.showOutline !== false &&
      activeView === 'content',
  })

  // Use document scroll on mobile, element scroll on desktop
  const media = useMedia()
  const isMobile = media.xs

  // Block tools handlers
  const blockCitations = useMemo(
    () => interactionSummary.data?.blocks || null,
    [interactionSummary.data?.blocks],
  )

  const handleBlockCitationClick = useCallback(
    (blockId?: string | null) => {
      if (route.key !== 'document' && route.key !== 'feed') return
      navigate({
        ...route,
        id: {
          ...route.id,
          blockRef: blockId || null,
          blockRange: null,
        },
        panel: {
          key: 'discussions',
          id: route.id,
          blockId: blockId || undefined,
        },
      })
    },
    [route, navigate],
  )

  const handleBlockCommentClick = useCallback(
    (
      blockId?: string | null,
      blockRangeInput?: BlockRange | undefined,
      _startCommentingNow?: boolean,
    ) => {
      if (route.key !== 'document' && route.key !== 'feed') return
      if (!blockId) return
      // Validate blockRange has proper structure
      const blockRange =
        blockRangeInput &&
        'start' in blockRangeInput &&
        'end' in blockRangeInput
          ? blockRangeInput
          : null
      navigate({
        ...route,
        id: {
          ...route.id,
          blockRef: blockId,
          blockRange,
        },
        panel: {
          key: 'discussions',
          id: route.id,
          targetBlockId: blockId,
          blockRange,
          autoFocus: true,
        },
      })
    },
    [route, navigate],
  )

  // Block select handler (for copy block link)
  const handleBlockSelect = useCallback(
    (blockId: string, opts?: BlockRangeSelectOptions) => {
      if (route.key !== 'document' && route.key !== 'feed') return
      const shouldCopy = opts?.copyToClipboard !== false
      if (blockId && shouldCopy) {
        // Create route with block reference
        const blockRoute = {
          ...route,
          id: {
            ...route.id,
            blockRef: blockId,
            blockRange:
              opts && 'start' in opts && 'end' in opts
                ? {start: opts.start, end: opts.end}
                : null,
          },
        }
        const url = routeToUrl(blockRoute)
        copyUrlToClipboardWithFeedback(url, 'Block')
      }
    },
    [route],
  )

  // Main page content (used in both mobile and desktop layouts)
  const mainPageContent = (
    <>
      <DocumentCover cover={document.metadata?.cover} />

      <div
        className={cn('mx-auto flex w-full flex-col px-4', isHomeDoc && 'mt-6')}
        style={{maxWidth: contentMaxWidth}}
      >
        {!isHomeDoc && (
          <DocumentHeader
            docId={docId}
            docMetadata={document.metadata}
            authors={[]}
            updateTime={document.updateTime}
          />
        )}
      </div>

      {/* Sentinel element - also provides top spacing before tools */}
      <div ref={toolsSentinelRef} className="h-3" />

      {/* DocumentTools - sticky with compact padding */}
      <div
        className={cn(
          'dark:bg-background sticky top-0 z-10 bg-white py-1',
          isToolsSticky ? 'shadow-md' : 'shadow-none',
          'transition-shadow',
        )}
      >
        <DocumentTools
          id={docId}
          activeTab={activeView}
          commentsCount={interactionSummary.data?.comments || 0}
          directoryCount={directory.data?.length}
        />
      </div>

      {/* Main content based on activeView */}
      <MainContent
        docId={docId}
        document={document}
        activeView={activeView}
        contentMaxWidth={contentMaxWidth}
        wrapperProps={wrapperProps}
        sidebarProps={sidebarProps}
        mainContentProps={mainContentProps}
        showSidebars={showSidebars}
        discussionsParams={discussionsParams}
        blockCitations={blockCitations}
        onBlockCitationClick={handleBlockCitationClick}
        onBlockCommentClick={handleBlockCommentClick}
        onBlockSelect={handleBlockSelect}
        CommentEditor={CommentEditor}
      />
    </>
  )

  // Close panel handler
  const handlePanelClose = () => {
    if ('panel' in route) {
      navigate({...route, panel: null})
    }
  }

  // Activity filter change handler
  const handleFilterChange = (filter: {filterEventType?: string[]}) => {
    if (
      (route.key === 'document' || route.key === 'feed') &&
      route.panel?.key === 'activity'
    ) {
      navigate({
        ...route,
        panel: {...route.panel, filterEventType: filter.filterEventType},
      })
    }
  }

  // Mobile: use document scroll with bottom bar and panel sheet
  if (isMobile) {
    return (
      <>
        <div
          className="relative flex flex-1 flex-col pb-16"
          ref={elementRef}
        >
          {mainPageContent}
        </div>

        {/* Mobile bottom bar */}
        {mobileConfig && (
          <MobileInteractionBar
            docId={docId}
            commentsCount={interactionSummary.data?.comments || 0}
            onCommentsClick={() => setMobilePanelOpen(true)}
            account={mobileConfig.account}
            onAvatarClick={mobileConfig.onAvatarClick}
            extraContent={mobileConfig.extraContent}
          />
        )}

        {/* Mobile panel sheet */}
        <MobilePanelSheet
          isOpen={mobilePanelOpen}
          title={getPanelTitle('discussions')}
          onClose={() => setMobilePanelOpen(false)}
        >
          <DiscussionsPageContent
            docId={docId}
            showTitle={false}
            showOpenInPanel={false}
            contentMaxWidth={contentMaxWidth}
            commentEditor={
              CommentEditor ? (
                <CommentEditor docId={docId} autoFocus />
              ) : undefined
            }
          />
        </MobilePanelSheet>
      </>
    )
  }

  // Desktop: use PanelLayout with scrollable main content + optional panel
  const panelContent = panelKey ? (
    <ScrollArea className="flex-1">
      <PanelContentRenderer
        panelRoute={panelRoute!}
        docId={docId}
        contentMaxWidth={contentMaxWidth}
        CommentEditor={CommentEditor}
      />
    </ScrollArea>
  ) : null

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      ref={elementRef}
    >
      <PanelLayout
        panelKey={panelKey}
        panelContent={panelContent}
        onPanelClose={handlePanelClose}
        filterEventType={
          panelRoute?.key === 'activity'
            ? panelRoute.filterEventType
            : undefined
        }
        onFilterChange={handleFilterChange}
      >
        <ScrollArea className="h-full">{mainPageContent}</ScrollArea>
      </PanelLayout>
    </div>
  )
}

// Renders panel content based on panel type
function PanelContentRenderer({
  panelRoute,
  docId,
  contentMaxWidth,
  CommentEditor,
}: {
  panelRoute: DocumentPanelRoute
  docId: UnpackedHypermediaId
  contentMaxWidth: number
  CommentEditor?: React.ComponentType<CommentEditorProps>
}) {
  switch (panelRoute.key) {
    case 'activity':
      return (
        <div className="p-4">
          <Feed
            size="sm"
            filterResource={docId.id}
            filterEventType={panelRoute.filterEventType}
          />
        </div>
      )
    case 'discussions':
      return (
        <DiscussionsPageContent
          docId={docId}
          showTitle={false}
          showOpenInPanel={false}
          contentMaxWidth={contentMaxWidth}
          openComment={panelRoute.openComment}
          targetBlockId={panelRoute.targetBlockId}
          commentEditor={
            CommentEditor ? (
              <CommentEditor
                docId={docId}
                quotingBlockId={panelRoute.targetBlockId}
                autoFocus
              />
            ) : undefined
          }
        />
      )
    case 'directory':
      return (
        <DirectoryPageContent
          docId={docId}
          showTitle={false}
          contentMaxWidth={contentMaxWidth}
        />
      )
    case 'collaborators':
      return (
        <div className="p-4">
          <ReadOnlyCollaboratorsContent docId={docId} />
        </div>
      )
    default:
      return null
  }
}

function MainContent({
  docId,
  document,
  activeView,
  contentMaxWidth,
  wrapperProps,
  sidebarProps,
  mainContentProps,
  showSidebars,
  discussionsParams,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  CommentEditor,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  activeView: ActiveView
  contentMaxWidth: number
  wrapperProps: React.HTMLAttributes<HTMLDivElement>
  sidebarProps: React.HTMLAttributes<HTMLDivElement>
  mainContentProps: React.HTMLAttributes<HTMLDivElement>
  showSidebars: boolean
  discussionsParams?: {
    openComment?: string
    targetBlockId?: string
    blockId?: string
    blockRange?: import('@shm/shared').BlockRange | null
  }
  blockCitations?: Record<string, {citations: number; comments: number}> | null
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (
    blockId?: string | null,
    blockRange?: BlockRange | undefined,
    startCommentingNow?: boolean,
  ) => void
  onBlockSelect?: (blockId: string, opts?: BlockRangeSelectOptions) => void
  CommentEditor?: React.ComponentType<CommentEditorProps>
}) {
  switch (activeView) {
    case 'directory':
      return (
        <DirectoryPageContent
          docId={docId}
          showTitle={false}
          contentMaxWidth={contentMaxWidth}
          headerRight={
            <OpenInPanelButton
              id={docId}
              panelRoute={{key: 'directory', id: docId}}
            />
          }
        />
      )

    case 'collaborators':
      return (
        <PageLayout centered contentMaxWidth={contentMaxWidth}>
          <div className="flex justify-end px-4 pb-2">
            <OpenInPanelButton
              id={docId}
              panelRoute={{key: 'collaborators', id: docId}}
            />
          </div>
          <ReadOnlyCollaboratorsContent docId={docId} />
        </PageLayout>
      )

    case 'activity':
      return (
        <PageLayout centered contentMaxWidth={contentMaxWidth}>
          <div className="flex justify-end px-4 pb-2">
            <OpenInPanelButton
              id={docId}
              panelRoute={{key: 'activity', id: docId}}
            />
          </div>
          <Feed size="md" centered filterResource={docId.id} />
        </PageLayout>
      )

    case 'discussions':
      return (
        <DiscussionsPageContent
          docId={docId}
          showTitle={false}
          contentMaxWidth={contentMaxWidth}
          openComment={discussionsParams?.openComment}
          targetBlockId={discussionsParams?.targetBlockId}
          blockId={discussionsParams?.blockId}
          blockRange={discussionsParams?.blockRange}
          commentEditor={
            CommentEditor ? (
              <CommentEditor
                docId={docId}
                quotingBlockId={discussionsParams?.targetBlockId}
              />
            ) : undefined
          }
        />
      )

    case 'content':
    default:
      return (
        <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
          {showSidebars && (
            <div {...sidebarProps}>{/* Document outline - placeholder */}</div>
          )}

          <div {...mainContentProps}>
            <BlocksContentProvider
              resourceId={docId}
              blockCitations={blockCitations}
              onBlockCitationClick={onBlockCitationClick}
              onBlockCommentClick={onBlockCommentClick}
              onBlockSelect={onBlockSelect}
            >
              <BlocksContent blocks={document.content} />
            </BlocksContentProvider>
          </div>

          {showSidebars && <div {...sidebarProps} />}
        </div>
      )
  }
}
