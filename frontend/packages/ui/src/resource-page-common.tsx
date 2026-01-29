import {hmId, HMDocument, unpackHmId, UnpackedHypermediaId} from '@shm/shared'
import {useDirectory, useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useEffect, useRef, useState} from 'react'
import {BlocksContent, BlocksContentProvider} from './blocks-content'
import {ReadOnlyCollaboratorsContent} from './collaborators-page'
import {ScrollArea} from './components/scroll-area'
import {DirectoryPageContent} from './directory-page'
import {DiscussionsPageContent} from './discussions-page'
import {DocumentCover} from './document-cover'
import {DocumentHeader} from './document-header'
import {DocumentTools} from './document-tools'
import {Feed} from './feed'
import {useDocumentLayout} from './layout'
import {DocNavigationItem, getSiteNavDirectory} from './navigation'
import {
  PageDeleted,
  PageDiscovery,
  PageNotFound,
} from './page-message-states'
import {SiteHeader} from './site-header'
import {Spinner} from './spinner'
import {cn} from './utils'

export type ActiveView = 'content' | 'activity' | 'discussions' | 'directory' | 'collaborators'

function getActiveView(routeKey: string): ActiveView {
  switch (routeKey) {
    case 'activity': return 'activity'
    case 'discussions': return 'discussions'
    case 'directory': return 'directory'
    case 'collaborators': return 'collaborators'
    default: return 'content'
  }
}

export interface ResourcePageProps {
  docId: UnpackedHypermediaId
}

export function ResourcePage({docId}: ResourcePageProps) {
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
  const headerData = computeHeaderData(siteHomeId, siteHomeDocument, homeDirectory.data)

  // Loading state - should not show during SSR if data was prefetched
  if (resource.isInitialLoading) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    )
  }

  // Handle discovery state
  if (resource.isDiscovering) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageDiscovery />
      </PageWrapper>
    )
  }

  // Handle not-found
  if (!resource.data || resource.data.type === 'not-found') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageNotFound />
      </PageWrapper>
    )
  }

  // Handle tombstone (deleted)
  if (resource.isTombstone || resource.data.type === 'tombstone') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageDeleted />
      </PageWrapper>
    )
  }

  // Handle error
  if (resource.data.type === 'error') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-destructive">{resource.data.message}</div>
        </div>
      </PageWrapper>
    )
  }

  // Handle redirect - for now just show not found, redirect handling comes later
  if (resource.data.type === 'redirect') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageNotFound />
      </PageWrapper>
    )
  }

  // Success: render document
  if (resource.data.type !== 'document') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
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
      <DocumentBody docId={docId} document={document} />
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
    ? (navigationBlockNode.children
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
        .filter((item): item is DocNavigationItem => item !== null) ?? [])
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
  return (
    <div className={cn('flex h-full flex-col')}>
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
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
}) {
  const route = useNavRoute()
  const activeView = getActiveView(route.key)

  // Extract discussions-specific params from route
  const discussionsParams = route.key === 'discussions' ? {
    openComment: route.openComment,
    targetBlockId: route.targetBlockId,
    blockId: route.blockId,
    blockRange: route.blockRange,
  } : undefined

  const isHomeDoc = !docId.path?.length
  const directory = useDirectory(docId)
  const interactionSummary = useInteractionSummary(docId)

  // Track when DocumentTools becomes sticky
  const [isToolsSticky, setIsToolsSticky] = useState(false)
  const toolsSentinelRef = useRef<HTMLDivElement>(null)

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
    showSidebars: !isHomeDoc && document.metadata?.showOutline !== false && activeView === 'content',
  })

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" ref={elementRef}>
      <ScrollArea className="flex-1">
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

        {/* DocumentTools - sticky with compact padding, direct child of scroll area */}
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
        />
      </ScrollArea>
    </div>
  )
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
}) {
  switch (activeView) {
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
        <div className="mx-auto w-full px-4" style={{maxWidth: contentMaxWidth}}>
          <ReadOnlyCollaboratorsContent docId={docId} />
        </div>
      )

    case 'activity':
      return (
        <div className="mx-auto w-full px-4" style={{maxWidth: contentMaxWidth}}>
          <Feed size="md" centered filterResource={docId.id} />
        </div>
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
            <BlocksContentProvider resourceId={docId}>
              <BlocksContent blocks={document.content} />
            </BlocksContentProvider>
          </div>

          {showSidebars && <div {...sidebarProps} />}
        </div>
      )
  }
}
