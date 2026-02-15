import {
  BlockRange,
  DocumentPanelRoute,
  findContentBlock,
  getBlockText,
  HMComment,
  HMDocument,
  HMExistingDraft,
  hmId,
  NavRoute,
  UnpackedHypermediaId,
  unpackHmId,
  useUniversalAppContext,
} from '@shm/shared'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {
  useAccountsMetadata,
  useDirectory,
  useResource,
  useResources,
} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {getRoutePanel} from '@shm/shared/routes'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {
  createSiteUrl,
  createWebHMUrl,
  getCommentTargetId,
  parseFragment,
} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  BlockRangeSelectOptions,
  BlocksContent,
  BlocksContentProvider,
} from './blocks-content'
import {DocumentCollaborators} from './collaborators-page'
import {ScrollArea} from './components/scroll-area'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {DirectoryPageContent} from './directory-page'
import {DiscussionsPageContent} from './discussions-page'
import {DocumentCover} from './document-cover'
import {AuthorPayload, BreadcrumbEntry, DocumentHeader} from './document-header'
import {DocumentTools} from './document-tools'
import {Feed} from './feed'
import {FeedFilters} from './feed-filters'
import {useDocumentLayout} from './layout'
import {MobilePanelSheet} from './mobile-panel-sheet'
import {
  DocNavigationItem,
  DocNavigationWrapper,
  DocumentOutline,
  getSiteNavDirectory,
  useNodesOutline,
} from './navigation'
import {HistoryIcon, Link} from './icons'
import {OpenInPanelButton} from './open-in-panel'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PageLayout} from './page-layout'
import {PageDeleted, PageDiscovery, PageNotFound} from './page-message-states'
import {PanelLayout} from './panel-layout'
import {SiteHeader} from './site-header'
import {Spinner} from './spinner'
import {UnreferencedDocuments} from './unreferenced-documents'
import {useBlockScroll} from './use-block-scroll'
import {useMedia} from './use-media'
import {cn} from './utils'
import {Folder} from 'lucide-react'

/** Common menu items generated internally for all document views */
export function useCommonMenuItems(
  docId: UnpackedHypermediaId,
): MenuItemType[] {
  const navigate = useNavigate()
  const media = useMedia()
  const isMobile = media.xs
  const {onCopyReference} = useUniversalAppContext()

  return useMemo(
    () => [
      {
        key: 'copy-link',
        label: 'Copy Link',
        icon: <Link className="size-4" />,
        onClick: () => {
          if (onCopyReference) {
            onCopyReference(docId)
          } else if (typeof window !== 'undefined') {
            copyUrlToClipboardWithFeedback(window.location.href, 'Link')
          }
        },
      },
      {
        key: 'versions',
        label: 'Document Versions',
        icon: <HistoryIcon className="size-4" />,
        onClick: () => {
          if (isMobile) {
            navigate({
              key: 'activity',
              id: docId,
              filterEventType: ['Ref'],
            })
          } else {
            navigate({
              key: 'document',
              id: docId,
              panel: {key: 'activity', id: docId, filterEventType: ['Ref']},
            })
          }
        },
      },
      {
        key: 'directory',
        label: 'Directory',
        icon: <Folder className="size-4" />,
        onClick: () => {
          navigate({key: 'directory', id: docId})
        },
      },
    ],
    [navigate, docId, isMobile, onCopyReference],
  )
}

/** Extract panel route from a view route, stripping top-level-only fields */
function extractPanelRoute(route: NavRoute): DocumentPanelRoute {
  const {panel, width, ...params} = route as any
  return params as DocumentPanelRoute
}

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
  commentId?: string
  autoFocus?: boolean
}

export interface ResourcePageProps {
  docId: UnpackedHypermediaId
  /** Factory to create comment editor - platform-specific (web vs desktop) */
  CommentEditor?: React.ComponentType<CommentEditorProps>
  /** Additional platform-specific menu items for the options dropdown */
  extraMenuItems?: MenuItemType[]
  /** Edit/create action buttons - platform-specific (desktop only) */
  editActions?: ReactNode
  /** Existing draft info for showing draft indicator in toolbar */
  existingDraft?: HMExistingDraft | false
  /** Platform-specific collaborator form (e.g. invite form on desktop) */
  collaboratorForm?: ReactNode

  floatingButtons?: ReactNode
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
  extraMenuItems,
  editActions,
  existingDraft,
  floatingButtons,
  collaboratorForm,
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

  // Handle comment - render target document's discussions view with comment open
  if (resource.data.type === 'comment') {
    return (
      <CommentResourcePage
        comment={resource.data.comment}
        commentId={docId}
        CommentEditor={CommentEditor}
      />
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
        siteUrl={siteHomeDocument?.metadata?.siteUrl}
        CommentEditor={CommentEditor}
        extraMenuItems={extraMenuItems}
        editActions={editActions}
        existingDraft={existingDraft}
        floatingButtons={floatingButtons}
        collaboratorForm={collaboratorForm}
      />
    </PageWrapper>
  )
}

/** Renders the target document's discussions view when the route points to a comment entity */
function CommentResourcePage({
  comment,
  commentId,
  CommentEditor,
}: {
  comment: HMComment
  commentId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
}) {
  const targetDocId = getCommentTargetId(comment)

  // Load target document's site header
  const siteHomeId = targetDocId ? hmId(targetDocId.uid) : hmId(commentId.uid)
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})
  const homeDirectory = useDirectory(siteHomeId)
  const siteHomeDocument =
    siteHomeResource.data?.type === 'document'
      ? siteHomeResource.data.document
      : null
  const headerData = computeHeaderData(
    siteHomeId,
    siteHomeDocument,
    homeDirectory.data,
  )

  // Load target document
  const targetResource = useResource(targetDocId, {
    subscribed: true,
    recursive: true,
  })

  if (!targetDocId) {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={commentId}
        headerData={headerData}
      >
        <PageNotFound />
      </PageWrapper>
    )
  }

  if (targetResource.isInitialLoading) {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={targetDocId}
        headerData={headerData}
      >
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    )
  }

  if (targetResource.data?.type !== 'document') {
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={targetDocId}
        headerData={headerData}
      >
        <PageNotFound />
      </PageWrapper>
    )
  }

  const document = targetResource.data.document
  const isHomeDoc = !targetDocId.path?.length

  return (
    <PageWrapper
      siteHomeId={siteHomeId}
      docId={targetDocId}
      headerData={headerData}
      document={document}
    >
      <CommentPageBody
        docId={targetDocId}
        document={document}
        isHomeDoc={isHomeDoc}
        openComment={comment.id}
        CommentEditor={CommentEditor}
        siteUrl={siteHomeDocument?.metadata?.siteUrl}
      />
    </PageWrapper>
  )
}

/** Simplified body for comment pages: target doc header + discussions tab */
function CommentPageBody({
  docId,
  document,
  isHomeDoc,
  openComment,
  CommentEditor,
  siteUrl,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  isHomeDoc: boolean
  openComment: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
  siteUrl?: string
}) {
  const interactionSummary = useInteractionSummary(docId)

  const breadcrumbIds = useMemo(() => {
    if (isHomeDoc) return []
    return getParentPaths(docId.path).map((path) => hmId(docId.uid, {path}))
  }, [docId.uid, docId.path, isHomeDoc])

  const breadcrumbResults = useResources(breadcrumbIds)
  const breadcrumbs = useMemo((): BreadcrumbEntry[] | undefined => {
    if (isHomeDoc) return undefined
    const items: BreadcrumbEntry[] = breadcrumbIds.map((id, i) => {
      const data = breadcrumbResults[i]?.data
      const metadata =
        data?.type === 'document' ? data.document?.metadata || {} : {}
      return {id, metadata}
    })
    items.push({label: 'Comments'})
    return items
  }, [isHomeDoc, breadcrumbIds, breadcrumbResults])

  const {contentMaxWidth} = useDocumentLayout({
    contentWidth: document.metadata?.contentWidth,
    showSidebars: false,
  })
  const media = useMedia()
  const isMobile = media.xs

  // Fetch author metadata for document header
  const commentAccountsMetadata = useAccountsMetadata(document.authors || [])
  const commentAuthorPayloads: AuthorPayload[] = useMemo(() => {
    return (document.authors || []).map((uid) => {
      const data = commentAccountsMetadata.data[uid]
      if (data) return data
      return {
        id: hmId(uid),
        metadata: null,
        isDiscovering: true,
      }
    })
  }, [document.authors, commentAccountsMetadata.data])

  return (
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
            authors={commentAuthorPayloads}
            updateTime={document.updateTime}
            breadcrumbs={breadcrumbs}
          />
        )}
      </div>
      {/* <div className="h-3" /> */}
      <div className="dark:bg-background sticky top-0 z-10 bg-white py-1">
        <DocumentTools
          id={docId}
          activeTab="discussions"
          commentsCount={interactionSummary.data?.comments || 0}
          rightActions={
            !isMobile ? (
              <OpenInPanelButton
                id={docId}
                panelRoute={{
                  key: 'discussions',
                  id: docId,
                  openComment,
                }}
              />
            ) : undefined
          }
        />
      </div>
      <DiscussionsPageContent
        docId={docId}
        openComment={openComment}
        contentMaxWidth={contentMaxWidth}
        targetDomain={siteUrl}
        commentEditor={
          CommentEditor ? <CommentEditor docId={docId} autoFocus /> : undefined
        }
      />
    </>
  )
}

// Header data computed from site home document
export interface HeaderData {
  items: DocNavigationItem[]
  homeNavigationItems: DocNavigationItem[]
  directoryItems: DocNavigationItem[]
  isCenterLayout: boolean
  siteHomeDocument: HMDocument | null
}

export function computeHeaderData(
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
export function PageWrapper({
  siteHomeId,
  docId,
  headerData,
  document,
  children,
  isMainFeedVisible = false,
}: {
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId
  headerData: HeaderData
  document?: HMDocument
  children: React.ReactNode
  isMainFeedVisible?: boolean
}) {
  // Mobile: let content flow naturally (document scroll)
  // Desktop: fixed height container (element scroll via ScrollArea in children)
  const media = useMedia()
  const isMobile = media.xs

  return (
    <div
      className={cn(
        'dark:bg-background flex max-h-full flex-col bg-white',
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
        isMainFeedVisible={isMainFeedVisible}
        notifyServiceHost={NOTIFY_SERVICE_HOST}
      />
      {children}
    </div>
  )
}

// Document body with content
function DocumentBody({
  docId,
  document,
  siteUrl,
  CommentEditor,
  extraMenuItems,
  editActions,
  existingDraft,
  floatingButtons,
  collaboratorForm,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  siteUrl?: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
  extraMenuItems?: MenuItemType[]
  editActions?: ReactNode
  existingDraft?: HMExistingDraft | false
  floatingButtons?: ReactNode
  collaboratorForm?: ReactNode
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

  // Extract blockRef from route for scroll-to-block and highlighting
  const routeBlockRef =
    'id' in route && typeof route.id === 'object' ? route.id.blockRef : null
  const {scrollToBlock} = useBlockScroll(routeBlockRef)

  // On mount, sync URL hash (#blockId) into route if not already present
  const replaceRoute = useNavigate('replace')
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (routeBlockRef) return // already have blockRef from route
    const hash = window.location.hash
    if (!hash) return
    const fragment = parseFragment(hash.substring(1))
    if (!fragment?.blockId) return
    if (route.key !== 'document' && route.key !== 'feed') return
    replaceRoute({
      ...route,
      id: {
        ...route.id,
        blockRef: fragment.blockId,
        blockRange:
          'start' in fragment && 'end' in fragment
            ? {start: fragment.start, end: fragment.end}
            : null,
      },
    })
  }, []) // only on mount

  const isHomeDoc = !docId.path?.length
  const directory = useDirectory(docId)
  const interactionSummary = useInteractionSummary(docId)

  // Breadcrumbs: fetch parent documents for non-home docs
  const breadcrumbIds = useMemo(() => {
    if (isHomeDoc) return []
    return getParentPaths(docId.path).map((path) => hmId(docId.uid, {path}))
  }, [docId.uid, docId.path, isHomeDoc])

  const breadcrumbResults = useResources(breadcrumbIds)

  const breadcrumbs = useMemo((): BreadcrumbEntry[] | undefined => {
    if (isHomeDoc) return undefined
    const items: BreadcrumbEntry[] = breadcrumbIds.map((id, i) => {
      const data = breadcrumbResults[i]?.data
      const metadata =
        data?.type === 'document' ? data.document?.metadata || {} : {}
      return {id, metadata}
    })

    // Append active panel name when not on content/draft view
    const panelLabels: Record<string, string> = {
      discussions: 'Comments',
      collaborators: 'People',
      directory: 'Directory',
      activity: 'Activity',
    }
    if (activeView !== 'content' && panelLabels[activeView]) {
      items.push({label: panelLabels[activeView]})
    }

    // Append block text when a block is focused
    if (routeBlockRef && document.content) {
      const blockNode = findContentBlock(document.content, routeBlockRef)
      if (blockNode?.block) {
        let text = getBlockText(blockNode.block)
        const routeId =
          'id' in route && typeof route.id === 'object' ? route.id : null
        const blockRange = routeId?.blockRange ?? null
        if (
          blockRange &&
          typeof blockRange.start === 'number' &&
          typeof blockRange.end === 'number'
        ) {
          text = text.slice(blockRange.start, blockRange.end)
        }
        const truncated = text.length > 40 ? text.slice(0, 40) + '...' : text
        if (truncated) items.push({label: `"${truncated}"`})
      }
    }

    return items
  }, [
    isHomeDoc,
    breadcrumbIds,
    breadcrumbResults,
    activeView,
    routeBlockRef,
    document.content,
    route,
  ])

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
    showCollapsed,
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

  // Fetch author metadata for document header
  const accountsMetadata = useAccountsMetadata(document.authors || [])
  const authorPayloads: AuthorPayload[] = useMemo(() => {
    return (document.authors || []).map((uid) => {
      const data = accountsMetadata.data[uid]
      if (data) return data
      return {
        id: hmId(uid),
        metadata: null,
        isDiscovering: true,
      }
    })
  }, [document.authors, accountsMetadata.data])

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

  // Block select handler (copy block link + navigate to update URL)
  const handleBlockSelect = useCallback(
    (blockId: string, opts?: BlockRangeSelectOptions) => {
      if (route.key !== 'document' && route.key !== 'feed') return
      const blockRange =
        opts && 'start' in opts && 'end' in opts
          ? {start: opts.start, end: opts.end}
          : null
      const blockRoute = {
        ...route,
        id: {
          ...route.id,
          blockRef: blockId,
          blockRange,
        },
      }
      const shouldCopy = opts?.copyToClipboard !== false
      if (blockId && shouldCopy) {
        // Block links must include version (block tied to specific version)
        // and use siteUrl hostname when available
        const url = siteUrl
          ? createSiteUrl({
              path: docId.path,
              hostname: siteUrl,
              blockRef: blockId,
              blockRange,
              version: document.version,
            })
          : createWebHMUrl(docId.uid, {
              path: docId.path,
              blockRef: blockId,
              blockRange,
              version: document.version,
            })
        copyUrlToClipboardWithFeedback(url, 'Block')
      }
      // Navigate to update route with blockRef (unless explicitly copy-only)
      if (opts?.copyToClipboard !== true) {
        scrollToBlock(blockId)
        navigate(blockRoute)
      }
    },
    [route, navigate, scrollToBlock, docId, document.version, siteUrl],
  )

  // Activity filter change handler (main page)
  const handleMainActivityFilterChange = (filter: {
    filterEventType?: string[]
  }) => {
    if (route.key === 'activity') {
      navigate({
        ...route,
        filterEventType: filter.filterEventType,
      })
    }
  }

  // Options dropdown: common items + platform extras
  const commonMenuItems = useCommonMenuItems(docId)
  const allMenuItems = useMemo(() => {
    const extras = extraMenuItems || []
    return [...extras, ...commonMenuItems]
  }, [extraMenuItems, commonMenuItems])

  const hasOptions = allMenuItems.length > 0
  const hasActionButtons = hasOptions || editActions
  const actionButtons = hasActionButtons ? (
    <>
      {hasOptions && (
        <OptionsDropdown menuItems={allMenuItems} align="end" side="bottom" />
      )}
      {editActions}
    </>
  ) : null

  // Main page content (used in both mobile and desktop layouts)
  const mainPageContent = (
    <>
      <DocumentCover cover={document.metadata?.cover} />

      {!isMobile ? (
        <div
          {...wrapperProps}
          className={cn(wrapperProps.className, isHomeDoc && 'mt-6')}
        >
          {showSidebars && (
            <div
              {...sidebarProps}
              className={cn(sidebarProps.className, '!h-auto')}
            />
          )}
          <div
            {...mainContentProps}
            className={cn(mainContentProps.className, 'flex flex-col')}
          >
            {!isHomeDoc && (
              <DocumentHeader
                docId={docId}
                docMetadata={document.metadata}
                authors={authorPayloads}
                updateTime={document.updateTime}
                breadcrumbs={breadcrumbs}
              />
            )}
          </div>
          {showSidebars && (
            <div
              {...sidebarProps}
              className={cn(sidebarProps.className, '!h-auto')}
            />
          )}
        </div>
      ) : (
        <div
          className={cn(
            'mx-auto flex w-full flex-col px-4',
            isHomeDoc && 'mt-6',
          )}
          style={{maxWidth: contentMaxWidth}}
        >
          {!isHomeDoc && (
            <DocumentHeader
              docId={docId}
              docMetadata={document.metadata}
              authors={authorPayloads}
              updateTime={document.updateTime}
              breadcrumbs={breadcrumbs}
            />
          )}
        </div>
      )}

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
          activeTab={
            activeView === 'activity' || activeView === 'directory'
              ? undefined
              : activeView
          }
          currentPanel={panelRoute}
          existingDraft={existingDraft}
          commentsCount={interactionSummary.data?.comments || 0}
          layoutProps={
            isMobile
              ? undefined
              : {
                  wrapperProps,
                  sidebarProps,
                  mainContentProps,
                  showSidebars,
                }
          }
          rightActions={
            <div className="flex items-center gap-1 pr-2 md:pr-0">
              {activeView !== 'content' && !isMobile && (
                <OpenInPanelButton
                  id={docId}
                  panelRoute={
                    route.key === activeView
                      ? extractPanelRoute(route)
                      : {key: activeView, id: docId}
                  }
                />
              )}
              {actionButtons ? (
                <div
                  className={cn(
                    'flex items-center gap-1 transition-opacity',
                    isMobile
                      ? 'opacity-100'
                      : isToolsSticky
                      ? 'opacity-100'
                      : 'pointer-events-none opacity-0',
                  )}
                >
                  {actionButtons}
                </div>
              ) : null}
            </div>
          }
        />
      </div>

      {/* Main content based on activeView */}
      <div className="pt-4">
        <MainContent
          docId={docId}
          resourceId={
            'id' in route && typeof route.id === 'object' ? route.id : docId
          }
          document={document}
          activeView={activeView}
          contentMaxWidth={contentMaxWidth}
          wrapperProps={wrapperProps}
          sidebarProps={sidebarProps}
          mainContentProps={mainContentProps}
          showSidebars={showSidebars}
          showCollapsed={showCollapsed}
          discussionsParams={discussionsParams}
          activityFilterEventType={
            route.key === 'activity' ? route.filterEventType : undefined
          }
          onActivityFilterChange={handleMainActivityFilterChange}
          blockCitations={blockCitations}
          onBlockCitationClick={handleBlockCitationClick}
          onBlockCommentClick={handleBlockCommentClick}
          onBlockSelect={handleBlockSelect}
          CommentEditor={CommentEditor}
          directory={directory.data}
          collaboratorForm={collaboratorForm}
          siteUrl={siteUrl}
        />
      </div>
    </>
  )

  // Close panel handler
  const handlePanelClose = () => {
    if ('panel' in route) {
      navigate({...route, panel: null})
    }
  }

  // Activity filter change handler (panel)
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
        <div className="relative flex flex-1 flex-col pb-20" ref={elementRef}>
          {mainPageContent}
        </div>
        {floatingButtons}
        {mobilePanelOpen && (
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
              targetDomain={siteUrl}
              commentEditor={
                CommentEditor ? (
                  <CommentEditor docId={docId} autoFocus />
                ) : undefined
              }
            />
          </MobilePanelSheet>
        )}
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
        siteUrl={siteUrl}
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
        {/* Floating action buttons - visible when DocumentTools is NOT sticky */}
        {actionButtons && !isMobile ? (
          <div
            className={cn(
              'absolute top-4 right-4 z-20 mt-[2px] flex items-center gap-1 rounded-sm transition-opacity',
              isToolsSticky ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            {actionButtons}
          </div>
        ) : null}
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
  siteUrl,
}: {
  panelRoute: DocumentPanelRoute
  docId: UnpackedHypermediaId
  contentMaxWidth: number
  CommentEditor?: React.ComponentType<CommentEditorProps>
  siteUrl?: string
}) {
  switch (panelRoute.key) {
    case 'activity':
      return (
        <div className="p-4">
          <Feed
            size="sm"
            filterResource={docId.id}
            filterEventType={panelRoute.filterEventType}
            targetDomain={siteUrl}
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
          targetDomain={siteUrl}
          openComment={panelRoute.openComment}
          targetBlockId={panelRoute.targetBlockId}
          blockId={panelRoute.blockId}
          blockRange={panelRoute.blockRange}
          commentEditor={
            CommentEditor ? (
              <CommentEditor
                docId={docId}
                quotingBlockId={panelRoute.targetBlockId}
                commentId={panelRoute.openComment}
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
          <DocumentCollaborators docId={docId} />
        </div>
      )
    default:
      return null
  }
}

function MainContent({
  docId,
  resourceId,
  document,
  activeView,
  contentMaxWidth,
  wrapperProps,
  sidebarProps,
  mainContentProps,
  showSidebars,
  showCollapsed,
  discussionsParams,
  activityFilterEventType,
  onActivityFilterChange,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  CommentEditor,
  directory,
  collaboratorForm,
  siteUrl,
}: {
  docId: UnpackedHypermediaId
  resourceId: UnpackedHypermediaId
  document: HMDocument
  activeView: ActiveView
  contentMaxWidth: number
  wrapperProps: React.HTMLAttributes<HTMLDivElement>
  sidebarProps: React.HTMLAttributes<HTMLDivElement>
  mainContentProps: React.HTMLAttributes<HTMLDivElement>
  showSidebars: boolean
  showCollapsed: boolean
  discussionsParams?: {
    openComment?: string
    targetBlockId?: string
    blockId?: string
    blockRange?: import('@shm/shared').BlockRange | null
  }
  activityFilterEventType?: string[]
  onActivityFilterChange?: (filter: {filterEventType?: string[]}) => void
  blockCitations?: Record<string, {citations: number; comments: number}> | null
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (
    blockId?: string | null,
    blockRange?: BlockRange | undefined,
    startCommentingNow?: boolean,
  ) => void
  onBlockSelect?: (blockId: string, opts?: BlockRangeSelectOptions) => void
  CommentEditor?: React.ComponentType<CommentEditorProps>
  directory?: import('@shm/shared').HMDocumentInfo[]
  collaboratorForm?: ReactNode
  siteUrl?: string
}) {
  switch (activeView) {
    case 'directory':
      return (
        <DirectoryPageContent
          docId={docId}
          showTitle
          contentMaxWidth={contentMaxWidth}
        />
      )

    case 'collaborators':
      return (
        <PageLayout centered contentMaxWidth={contentMaxWidth}>
          {collaboratorForm}
          <DocumentCollaborators docId={docId} />
        </PageLayout>
      )

    case 'activity':
      return (
        <PageLayout centered contentMaxWidth={contentMaxWidth}>
          <FeedFilters
            filterEventType={activityFilterEventType}
            onFilterChange={onActivityFilterChange}
          />
          <Feed
            size="md"
            centered
            filterResource={docId.id}
            filterEventType={activityFilterEventType || []}
            targetDomain={siteUrl}
          />
        </PageLayout>
      )

    case 'discussions':
      return (
        <DiscussionsPageContent
          docId={docId}
          showTitle={false}
          showOpenInPanel={false}
          contentMaxWidth={contentMaxWidth}
          targetDomain={siteUrl}
          openComment={discussionsParams?.openComment}
          targetBlockId={discussionsParams?.targetBlockId}
          blockId={discussionsParams?.blockId}
          blockRange={discussionsParams?.blockRange}
          commentEditor={
            CommentEditor ? (
              <CommentEditor
                docId={docId}
                quotingBlockId={discussionsParams?.targetBlockId}
                commentId={discussionsParams?.openComment}
              />
            ) : undefined
          }
        />
      )

    case 'content':
    default:
      return (
        <ContentViewWithOutline
          docId={docId}
          resourceId={resourceId}
          document={document}
          wrapperProps={wrapperProps}
          sidebarProps={sidebarProps}
          mainContentProps={mainContentProps}
          showSidebars={showSidebars}
          showCollapsed={showCollapsed}
          blockCitations={blockCitations}
          onBlockCitationClick={onBlockCitationClick}
          onBlockCommentClick={onBlockCommentClick}
          onBlockSelect={onBlockSelect}
          directory={directory}
        />
      )
  }
}

function ContentViewWithOutline({
  docId,
  resourceId,
  document,
  wrapperProps,
  sidebarProps,
  mainContentProps,
  showSidebars,
  showCollapsed,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  directory,
}: {
  docId: UnpackedHypermediaId
  resourceId: UnpackedHypermediaId
  document: HMDocument
  wrapperProps: React.HTMLAttributes<HTMLDivElement>
  sidebarProps: React.HTMLAttributes<HTMLDivElement>
  mainContentProps: React.HTMLAttributes<HTMLDivElement>
  showSidebars: boolean
  showCollapsed: boolean
  blockCitations?: Record<string, {citations: number; comments: number}> | null
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (
    blockId?: string | null,
    blockRange?: BlockRange | undefined,
    startCommentingNow?: boolean,
  ) => void
  onBlockSelect?: (blockId: string, opts?: BlockRangeSelectOptions) => void
  directory?: import('@shm/shared').HMDocumentInfo[]
}) {
  const outline = useNodesOutline(document, docId)

  return (
    <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
      {showSidebars && (
        <div {...sidebarProps}>
          {outline.length > 0 && (
            <div className="sticky top-24 mt-4">
              <DocNavigationWrapper
                showCollapsed={showCollapsed}
                outline={outline}
              >
                <DocumentOutline
                  onActivateBlock={(blockId) => {
                    const el = window.document.getElementById(blockId)
                    if (el) {
                      el.scrollIntoView({behavior: 'smooth', block: 'start'})
                    }
                  }}
                  outline={outline}
                  id={docId}
                  activeBlockId={docId.blockRef}
                />
              </DocNavigationWrapper>
            </div>
          )}
        </div>
      )}

      <div {...mainContentProps}>
        <BlocksContentProvider
          resourceId={resourceId}
          blockCitations={blockCitations}
          onBlockCitationClick={onBlockCitationClick}
          onBlockCommentClick={onBlockCommentClick}
          onBlockSelect={onBlockSelect}
        >
          <BlocksContent blocks={document.content} />
        </BlocksContentProvider>
        <UnreferencedDocuments
          docId={docId}
          content={document.content}
          directory={directory}
        />
      </div>

      {showSidebars && <div {...sidebarProps} />}
    </div>
  )
}
