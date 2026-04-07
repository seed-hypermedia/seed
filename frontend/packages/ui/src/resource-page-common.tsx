import {
  BlockRange,
  HMBlockNode,
  HMDocument,
  HMExistingDraft,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  createInspectNavRoute,
  DocumentPanelRoute,
  findContentBlock,
  getBlockText,
  hmId,
  NavRoute,
  ProfileTab,
  unpackHmId,
  useUniversalAppContext,
} from '@shm/shared'
import {useHackyAuthorsSubscriptions} from '@shm/shared/comments-service-provider'
import {IS_DESKTOP, NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import type {BlockRangeSelectOptions, DocumentContentProps} from '@shm/shared/document-content-props'
import {useCanSeePrivateDocs} from '@shm/shared/models/capabilities'
import {
  useAccount,
  useAccountsMetadata,
  useDirectory,
  useIsLatest,
  useResource,
  useResources,
  useSiteMembers,
} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {
  documentMachine,
  DocumentMachineProvider,
  selectContext,
  selectIsEditing,
  selectPublishedVersion,
  useAccountSync,
  useCapabilitySync,
  useDocumentSelector,
  useDocumentSend,
  useDocumentSync,
  useDraftResolutionSync,
} from '@shm/shared/models/use-document-machine'
import {getRoutePanel} from '@shm/shared/routes'
import {getBreadcrumbDocumentIds} from '@shm/shared/utils/breadcrumbs'
import {
  activityFilterToSlug,
  createSiteUrl,
  createWebHMUrl,
  getCommentTargetId,
  parseFragment,
} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {Folder, Search} from 'lucide-react'
import {CSSProperties, lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AccountPage} from './account-page'
import {CollaboratorsPage} from './collaborators-page'
import {ScrollArea} from './components/scroll-area'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {DirectoryPageContent} from './directory-page'
import {DiscussionsPageContent} from './discussions-page'
import {DocumentCover} from './document-cover'
import {AuthorPayload, BreadcrumbEntry, Breadcrumbs, DocumentHeader} from './document-header'
import {DocumentTools} from './document-tools'
import {Feed} from './feed'
import {FeedFilters} from './feed-filters'
import {HistoryIcon, Link} from './icons'
import {useDocumentLayout} from './layout'
import {MembersFacepile} from './members-facepile'
import {MobilePanelSheet} from './mobile-panel-sheet'
import {
  DocNavigationItem,
  DocNavigationWrapper,
  DocumentOutline,
  getSiteNavDirectory,
  useNodesOutline,
} from './navigation'
import {OpenInPanelButton} from './open-in-panel'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PageLayout} from './page-layout'
import {PageDeleted, PageDiscovery, PageNotFound, PagePrivate} from './page-message-states'
import {PanelLayout} from './panel-layout'
import {GotoLatestBanner, SiteHeader} from './site-header'
import {Spinner} from './spinner'
import {UnreferencedDocuments} from './unreferenced-documents'
import {useBlockScroll} from './use-block-scroll'
import {useMedia} from './use-media'
import {cn} from './utils'

const LazyDocumentMachineDebugDrawer = lazy(() =>
  import('@shm/shared/models/document-machine-debug-drawer').then((m) => ({default: m.DocumentMachineDebugDrawer})),
)

/** Common menu items generated internally for all document views */
export function useCommonMenuItems(docId: UnpackedHypermediaId): MenuItemType[] {
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

export type ActiveView = 'content' | 'activity' | 'comments' | 'directory' | 'collaborators' | 'site-profile'

function getActiveView(routeKey: string): ActiveView {
  switch (routeKey) {
    case 'activity':
      return 'activity'
    case 'comments':
      return 'comments'
    case 'directory':
      return 'directory'
    case 'collaborators':
      return 'collaborators'
    case 'site-profile':
      return 'site-profile'
    default:
      return 'content'
  }
}

export interface CommentEditorProps {
  docId: UnpackedHypermediaId
  quotingBlockId?: string
  commentId?: string
  isReplying?: boolean
  autoFocus?: boolean
  /** CID version of the comment being replied to. */
  replyCommentVersion?: string
  /** CID version of the thread root comment. */
  rootReplyCommentVersion?: string
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
  /** Pre-fetched content blocks from the existing draft (when available, used as editor initial content) */
  existingDraftContent?: HMBlockNode[]
  /** Cursor position saved in the draft file; used to restore cursor on reload. */
  existingDraftCursorPosition?: number
  /** Platform-specific page footer (web only) */
  pageFooter?: ReactNode

  floatingButtons?: ReactNode
  /** Inline child draft cards rendered after document content */
  inlineCards?: ReactNode
  /** Platform-specific actions rendered in the site header right side */
  rightActions?: ReactNode
  /** Callback to open edit profile dialog for site profile pages (only shown for own account) */
  onEditProfile?: () => void
  /** Additional header buttons for site profile pages (e.g., logout) - only shown for own account */
  profileHeaderButtons?: ReactNode
  /** Override follow button click on profile pages (web: saves intent + opens signup for unauthenticated users) */
  onFollowClick?: () => void
  /** Optional inline element injected after content blocks (subscribe box) */
  inlineInsert?: ReactNode
  /** Whether the current user can edit this document (drives the state machine guard). */
  canEdit?: boolean
  /** Optional provided machine (with actors) for desktop editing support. */
  machine?: typeof documentMachine
  /** Optional XState inspect callback for debugging. Gated by developerTools flag. */
  inspect?: (inspectionEvent: any) => void
  /** Inspect event store for the debug drawer to subscribe to. */
  inspectStore?: import('@shm/shared/models/document-machine-inspect').InspectEventStore
  /** Component to render document content using the editor. Optional during SSR. */
  DocumentContentComponent?: React.ComponentType<DocumentContentProps>
  /** Called when the editor instance is created. Used by desktop to capture editor ref for draft saving. */
  onEditorReady?: (editor: any) => void
  /** Extra components to render inside the DocumentMachineProvider (e.g. draft content loader). */
  machineExtras?: ReactNode
  /** Render prop for floating overlay when editing. Receives existing menu items so they can be merged. */
  editingFloatingActions?: (props: {menuItems: MenuItemType[]}) => ReactNode
  /** Signing account ID for draft saving (desktop only). Flows into machine context. */
  signingAccountId?: string
  /** Publish account UID for publishing (desktop only). Flows into machine context. */
  publishAccountUid?: string
  /** Render prop for the options panel (desktop only). Rendered when panel key is 'options'. */
  optionsPanel?: ReactNode
}

/** Get panel title for display */
function getPanelTitle(panelKey: string | null): string {
  switch (panelKey) {
    case 'activity':
      return 'Activity'
    case 'comments':
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
  existingDraftContent,
  existingDraftCursorPosition,
  floatingButtons,
  pageFooter,
  inlineCards,
  rightActions,
  onEditProfile,
  profileHeaderButtons,
  onFollowClick,
  inlineInsert,
  canEdit = false,
  machine,
  inspect,
  inspectStore,
  DocumentContentComponent,
  onEditorReady,
  machineExtras,
  editingFloatingActions,
  signingAccountId,
  publishAccountUid,
  optionsPanel,
}: ResourcePageProps) {
  const route = useNavRoute()
  const isSiteProfile = route.key === 'site-profile'

  // Load document data via React Query (hydrated from SSR prefetch)
  const resource = useResource(docId, {
    subscribed: true,
    recursive: true,
  })

  // docId.uid determines the site header — for site-profile, docId IS the site context
  const siteHomeId = hmId(docId.uid)
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})
  const homeDirectory = useDirectory(siteHomeId)
  const isLatest = useIsLatest(docId, resource)
  const canSeePrivate = useCanSeePrivateDocs(docId)

  const siteHomeDocument = siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document : null

  // Compute header data
  const headerData = computeHeaderData(siteHomeId, siteHomeDocument, homeDirectory.data, canSeePrivate)

  // Comment handling: when resource is a comment, resolve and load its target document.
  // Hooks must be called unconditionally, so we always call useResource for the target
  // (it no-ops when targetDocId is null).
  const comment = resource.data?.type === 'comment' ? resource.data.comment : null
  const targetDocId = comment ? getCommentTargetId(comment) : null
  const targetResource = useResource(targetDocId, {
    subscribed: true,
    recursive: true,
  })

  // Site profile view: subscribe to and discover the profile account, then render profile content
  if (isSiteProfile) {
    const accountUid = route.key === 'site-profile' ? route.accountUid || docId.uid : docId.uid
    const tab = route.key === 'site-profile' ? route.tab : 'profile'
    return (
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={siteHomeId}
        headerData={headerData}
        document={siteHomeDocument || undefined}
        rightActions={rightActions}
      >
        <SiteProfileContent
          siteUid={docId.uid}
          accountUid={accountUid}
          tab={tab}
          onEditProfile={onEditProfile}
          headerButtons={profileHeaderButtons}
          onFollowClick={onFollowClick}
          pageFooter={pageFooter}
        />
      </PageWrapper>
    )
  }

  // Loading state - should not show during SSR if data was prefetched
  if (resource.isInitialLoading) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle discovery state
  if (resource.isDiscovering) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageDiscovery />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle not-found
  if (!resource.data || resource.data.type === 'not-found') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageNotFound />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle tombstone (deleted)
  if (resource.isTombstone || resource.data.type === 'tombstone') {
    const isCommentRoute = route.key === 'comments'
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageDeleted entityType={isCommentRoute ? 'comment' : 'document'} />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle private document (permission denied)
  if (resource.data.type === 'error' && resource.data.message.toLowerCase().includes('permission')) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PagePrivate />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle error
  if (resource.data.type === 'error') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-destructive">{resource.data.message}</div>
        </div>
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle comment — show the target document's discussions view with this comment open.
  // Uses the same PageWrapper as all other branches so the site header stays mounted.
  if (comment) {
    if (!targetDocId || targetResource.data?.type === 'not-found') {
      return (
        <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
          <PageNotFound />
          {pageFooter}
        </PageWrapper>
      )
    }
    if (targetResource.isInitialLoading) {
      return (
        <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
          {pageFooter}
        </PageWrapper>
      )
    }
    if (targetResource.data?.type !== 'document') {
      return (
        <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
          <PageNotFound />
          {pageFooter}
        </PageWrapper>
      )
    }
    const targetDocument = targetResource.data.document
    return (
      <DocumentMachineProvider input={{documentId: targetDocId, canEdit: false}} inspect={inspect}>
        <PageWrapper
          siteHomeId={siteHomeId}
          docId={targetDocId}
          headerData={headerData}
          document={targetDocument}
          rightActions={rightActions}
        >
          <DocumentBody
            docId={targetDocId}
            document={targetDocument}
            activeView="comments"
            openComment={comment.id}
            existingDraft={false}
            CommentEditor={CommentEditor}
            siteUrl={siteHomeDocument?.metadata?.siteUrl}
            pageFooter={pageFooter}
            DocumentContentComponent={DocumentContentComponent}
          />
        </PageWrapper>
      </DocumentMachineProvider>
    )
  }

  // Success: render document
  if (resource.data.type !== 'document') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageNotFound />
        {pageFooter}
      </PageWrapper>
    )
  }
  const document = resource.data.document

  return (
    <DocumentMachineProvider
      input={{
        documentId: docId,
        canEdit,
        editUid: docId.uid,
        editPath: docId.path ?? undefined,
        signingAccountId,
        publishAccountUid,
      }}
      machine={machine}
      inspect={inspect}
    >
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={docId}
        headerData={headerData}
        document={document}
        rightActions={rightActions}
      >
        <DocumentBody
          docId={docId}
          document={document}
          activeView={getActiveView(route.key)}
          isLatest={isLatest}
          siteUrl={siteHomeDocument?.metadata?.siteUrl}
          CommentEditor={CommentEditor}
          extraMenuItems={extraMenuItems}
          editActions={editActions}
          existingDraft={existingDraft}
          existingDraftContent={existingDraftContent}
          existingDraftCursorPosition={existingDraftCursorPosition}
          floatingButtons={floatingButtons}
          pageFooter={pageFooter}
          inlineCards={inlineCards}
          inlineInsert={inlineInsert}
          DocumentContentComponent={DocumentContentComponent}
          onEditorReady={onEditorReady}
          canEdit={canEdit}
          editingFloatingActions={editingFloatingActions}
          signingAccountId={signingAccountId}
          publishAccountUid={publishAccountUid}
          optionsPanel={optionsPanel}
        />
      </PageWrapper>
      {machineExtras}
      {inspect && (
        <Suspense fallback={null}>
          <LazyDocumentMachineDebugDrawer store={inspectStore} />
        </Suspense>
      )}
    </DocumentMachineProvider>
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
  includePrivate: boolean = false,
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
    includePrivate,
  })

  const items = homeNavigationItems.length > 0 ? homeNavigationItems : directoryItems

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
  rightActions,
}: {
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId
  headerData: HeaderData
  document?: HMDocument
  children: React.ReactNode
  isMainFeedVisible?: boolean
  rightActions?: React.ReactNode
}) {
  // Mobile: let content flow naturally (document scroll)
  // Desktop: fixed height container (element scroll via ScrollArea in children)
  // Note: IS_DESKTOP (Electron) never uses document scroll regardless of window width
  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP

  return (
    <div
      style={
        {
          '--site-header-default-h': headerData.isCenterLayout ? '96px' : '60px',
        } as CSSProperties
      }
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
        rightActions={rightActions}
      />
      {children}
    </div>
  )
}

// Document body with content
function DocumentBody({
  docId,
  document,
  activeView,
  isLatest = true,
  siteUrl,
  CommentEditor,
  extraMenuItems,
  editActions,
  existingDraft,
  existingDraftContent,
  existingDraftCursorPosition,
  floatingButtons,
  pageFooter,
  inlineCards,
  openComment,
  inlineInsert,
  DocumentContentComponent,
  onEditorReady,
  canEdit = false,
  editingFloatingActions,
  signingAccountId,
  publishAccountUid,
  optionsPanel,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  /** Which tab/view to display */
  activeView: ActiveView
  isLatest?: boolean
  siteUrl?: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
  extraMenuItems?: MenuItemType[]
  editActions?: ReactNode
  existingDraft?: HMExistingDraft | false
  existingDraftContent?: HMBlockNode[]
  existingDraftCursorPosition?: number
  floatingButtons?: ReactNode
  pageFooter?: ReactNode
  inlineCards?: ReactNode
  /** Comment to open in discussions view (used when navigating to a comment entity) */
  openComment?: string
  /** Optional inline element injected after content blocks */
  inlineInsert?: ReactNode
  /** Component to render document content using the editor */
  DocumentContentComponent?: React.ComponentType<DocumentContentProps>
  /** Called when the editor instance is created */
  onEditorReady?: (editor: any) => void
  /** Whether the current user can edit this document */
  canEdit?: boolean
  /** Render prop for floating overlay when editing */
  editingFloatingActions?: (props: {menuItems: MenuItemType[]}) => ReactNode
  /** Signing account ID for draft saving (desktop only) */
  signingAccountId?: string
  /** Publish account UID for publishing (desktop only) */
  publishAccountUid?: string
  /** Render prop for the options panel */
  optionsPanel?: ReactNode
}) {
  // Sync document into state machine
  useDocumentSync(document)
  // Sync canEdit changes into the machine (for account switching)
  useCapabilitySync(canEdit)
  // Sync account IDs into the machine (for draft saving / publishing)
  useAccountSync(signingAccountId, publishAccountUid)
  // Sync draft resolution — machine stays in loading until this settles.
  // undefined = still loading, {draftId: null} = no draft, {draftId: string} = draft + content ready
  const draftResolution = useMemo(() => {
    let result: {draftId: string | null; content: HMBlockNode[] | null; cursorPosition: number | null} | undefined
    if (existingDraft === undefined) {
      result = undefined
    } else if (!existingDraft) {
      result = {draftId: null as string | null, content: null, cursorPosition: null}
    } else if (existingDraftContent) {
      result = {draftId: existingDraft.id, content: existingDraftContent, cursorPosition: existingDraftCursorPosition ?? null}
    } else {
      result = undefined // draft found but content not loaded yet
    }
    console.log('[DraftResolution]', {
      existingDraft: existingDraft === undefined ? 'undefined' : existingDraft === false ? 'false' : existingDraft?.id,
      hasContent: !!existingDraftContent,
      resolution: result === undefined ? 'undefined (waiting)' : `draftId=${result.draftId}`,
    })
    return result
  }, [existingDraft, existingDraftContent, existingDraftCursorPosition])
  useDraftResolutionSync(draftResolution)
  const publishedVersion = useDocumentSelector(selectPublishedVersion)
  const isEditing = useDocumentSelector(selectIsEditing)

  const route = useNavRoute()
  const navigate = useNavigate()

  // Extract panel from route (only document/feed routes have panels)
  const panelRoute = getRoutePanel(route) as DocumentPanelRoute | null
  const panelKey = panelRoute?.key ?? null

  // Extract discussions-specific params from route or from explicit props
  const discussionsParams =
    route.key === 'comments'
      ? {
          openComment: route.openComment,
          targetBlockId: route.targetBlockId,
          blockId: route.blockId,
          blockRange: route.blockRange,
          autoFocus: route.autoFocus,
          isReplying: route.isReplying,
          replyCommentVersion: route.replyCommentVersion,
          rootReplyCommentVersion: route.rootReplyCommentVersion,
        }
      : openComment
      ? {openComment}
      : undefined

  // Respect the showActivity metadata toggle to hide the document tools bar.
  const showActivity = document.metadata?.showActivity !== false

  // Extract blockRef from route for scroll-to-block and highlighting
  const routeBlockRef = 'id' in route && typeof route.id === 'object' ? route.id.blockRef : null
  const {scrollToBlock} = useBlockScroll(routeBlockRef)

  // On mount, sync URL hash (#blockId) into route if not already present
  const replaceRoute = useNavigate('replace')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (!hash) return
    const fragment = parseFragment(hash.substring(1))
    if (!fragment?.blockId) return
    const blockRange =
      'start' in fragment && 'end' in fragment
        ? {start: fragment.start, end: fragment.end}
        : 'expanded' in fragment && fragment.expanded
        ? {expanded: true}
        : null
    // For comments routes, sync fragment into blockId/blockRange (comment block selection)
    if (route.key === 'comments') {
      if (route.blockId) return // already have block selection
      replaceRoute({
        ...route,
        id: {...route.id, blockRef: fragment.blockId, blockRange},
        blockId: fragment.blockId,
        blockRange,
      })
      return
    }
    if (route.key !== 'document' && route.key !== 'feed') return
    if (routeBlockRef) return // already have blockRef from route
    replaceRoute({
      ...route,
      id: {
        ...route.id,
        blockRef: fragment.blockId,
        blockRange,
      },
    })
  }, []) // only on mount

  const isHomeDoc = !docId.path?.length
  const siteId = useMemo(() => hmId(docId.uid), [docId.uid])
  const siteMembers = useSiteMembers(siteId)
  const directory = useDirectory(docId)
  const interactionSummary = useInteractionSummary(docId)

  // Breadcrumbs: fetch parent documents for non-home docs
  const breadcrumbIds = useMemo(() => {
    if (isHomeDoc) return []
    return getBreadcrumbDocumentIds(docId)
  }, [docId, isHomeDoc])

  const breadcrumbResults = useResources(breadcrumbIds)

  const breadcrumbs = useMemo((): BreadcrumbEntry[] | undefined => {
    if (isHomeDoc) return undefined
    const items: BreadcrumbEntry[] = breadcrumbIds.map((id, i) => {
      const result = breadcrumbResults[i]
      const data = result?.data
      const metadata = data?.type === 'document' ? data.document?.metadata || {} : {}
      const fallbackName = id.path?.at(-1) || id.uid.slice(0, 8)
      return {
        id,
        metadata,
        fallbackName,
        isLoading: result?.isDiscovering || result?.isLoading,
        isTombstone: result?.isTombstone,
        isNotFound: data?.type === 'not-found' && !result?.isDiscovering,
        isError: result?.isError && !result?.isDiscovering && !result?.isTombstone,
      }
    })

    // Append active panel name when not on content/draft view
    const panelLabels: Record<string, string> = {
      comments: 'Comments',
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
        const routeId = 'id' in route && typeof route.id === 'object' ? route.id : null
        const blockRange = routeId?.blockRange ?? null
        if (blockRange && typeof blockRange.start === 'number' && typeof blockRange.end === 'number') {
          text = text.slice(blockRange.start, blockRange.end)
        }
        const truncated = text.length > 40 ? text.slice(0, 40) + '...' : text
        if (truncated) items.push({label: `"${truncated}"`})
      }
    }

    return items
  }, [isHomeDoc, breadcrumbIds, breadcrumbResults, activeView, routeBlockRef, document.content, route])

  // Track when DocumentTools becomes sticky
  const [isToolsSticky, setIsToolsSticky] = useState(false)
  const toolsSentinelRef = useRef<HTMLDivElement>(null)

  // Mobile panel open state derived from URL panel route
  const mobilePanelOpen = !!panelKey

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

  const {showSidebars, showCollapsed, sidebarProps, mainContentProps, elementRef, wrapperProps, contentMaxWidth} =
    useDocumentLayout({
      contentWidth: document.metadata?.contentWidth,
      showSidebars: !isHomeDoc && document.metadata?.showOutline !== false && activeView === 'content',
    })

  // Fetch author metadata for document header and subscribe for discovery
  const accountsMetadata = useAccountsMetadata(document.authors || [])
  useHackyAuthorsSubscriptions(document.authors || [])
  const authorPayloads: AuthorPayload[] = useMemo(() => {
    return (document.authors || []).map((uid) => {
      const data = accountsMetadata.data[uid]
      if (data) return data
      return {
        id: hmId(uid),
        metadata: null,
      }
    })
  }, [document.authors, accountsMetadata.data])

  // Use document scroll on mobile web, element scroll on desktop/large screens
  // In Electron (IS_DESKTOP), always use element scroll regardless of window width,
  // because the layout uses overflow-hidden containers that prevent document scroll.
  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP

  // Block tools handlers
  const blockCitations = useMemo(() => interactionSummary.data?.blocks || null, [interactionSummary.data?.blocks])

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
          key: 'comments',
          id: route.id,
          blockId: blockId || undefined,
        },
      })
    },
    [route, navigate],
  )

  const handleBlockCommentClick = useCallback(
    (blockId?: string | null, blockRangeInput?: BlockRange | undefined, _startCommentingNow?: boolean) => {
      if (route.key !== 'document' && route.key !== 'feed') return
      if (!blockId) return
      // Validate blockRange has proper structure
      const blockRange =
        blockRangeInput && 'start' in blockRangeInput && 'end' in blockRangeInput ? blockRangeInput : null
      navigate({
        ...route,
        id: {
          ...route.id,
          blockRef: blockId,
          blockRange,
        },
        panel: {
          key: 'comments',
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
          : opts && 'expanded' in opts && opts.expanded
          ? {expanded: true}
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
        const versionForLink = publishedVersion ?? document.version
        const url = siteUrl
          ? createSiteUrl({
              path: docId.path,
              hostname: siteUrl,
              blockRef: blockId,
              blockRange,
              version: versionForLink,
            })
          : createWebHMUrl(docId.uid, {
              path: docId.path,
              blockRef: blockId,
              blockRange,
              version: versionForLink,
            })
        copyUrlToClipboardWithFeedback(url, 'Block')
      }
      // Navigate to update route with blockRef (unless explicitly copy-only)
      if (opts?.copyToClipboard !== true) {
        scrollToBlock(blockId)
        navigate(blockRoute)
      }
    },
    [route, navigate, scrollToBlock, docId, document.version, siteUrl, publishedVersion],
  )

  // Activity filter change handler (main page)
  const handleMainActivityFilterChange = (filter: {filterEventType?: string[]}) => {
    if (route.key === 'activity') {
      navigate({
        ...route,
        filterEventType: filter.filterEventType,
      })
    }
  }

  // Options dropdown: common items + platform extras
  const commonMenuItems = useCommonMenuItems(docId)
  const inspectMenuItem = useMemo<MenuItemType | null>(() => {
    if (route.key === 'inspect') return null
    const inspectDocId = {...docId, blockRef: null, blockRange: null}
    return {
      key: 'inspect',
      label: 'Inspect Document',
      icon: <Search className="size-4" />,
      onClick: () => {
        navigate(createInspectNavRoute(inspectDocId))
      },
    }
  }, [docId, navigate, route.key])
  const allMenuItems = useMemo(() => {
    const extras = extraMenuItems || []
    const nonDestructiveExtras = extras.filter((item) => item.variant !== 'destructive')
    const destructiveExtras = extras.filter((item) => item.variant === 'destructive')
    const items = [...commonMenuItems]
    if (inspectMenuItem) {
      const copyLinkIndex = items.findIndex((item) => item.key === 'copy-link')
      items.splice(copyLinkIndex >= 0 ? copyLinkIndex + 1 : 0, 0, inspectMenuItem)
    }
    return [...nonDestructiveExtras, ...items, ...destructiveExtras]
  }, [extraMenuItems, commonMenuItems, inspectMenuItem])

  const hasOptions = allMenuItems.length > 0
  const hasActionButtons = hasOptions || editActions
  const actionButtons = hasActionButtons ? (
    <>
      {/* Only show in the floating overlay on md+ screens — on mobile the same
          button is rendered inside DocumentTools rightActions (md:hidden), so
          hiding it here prevents both from showing simultaneously around the
          md breakpoint (issue #321). */}
      {hasOptions && (
        <div className="hidden md:block">
          <OptionsDropdown menuItems={allMenuItems} align="end" side="bottom" />
        </div>
      )}
      {editActions}
    </>
  ) : null

  // Main page content (used in both mobile and desktop layouts)
  const mainPageContent = (
    <div
      className={cn(
        'flex flex-col',
        pageFooter &&
          'min-h-[calc(100dvh-var(--site-header-live-h,var(--site-header-default-h,60px))-var(--hm-host-banner-h,0px))]',
        !pageFooter && 'min-h-full',
      )}
    >
      <DocumentCover cover={document.metadata?.cover} />

      {!isMobile ? (
        <div style={wrapperProps.style} className={cn('mx-auto flex w-full justify-between')}>
          {showSidebars && <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto')} />}
          <div {...mainContentProps} className={cn(mainContentProps.className, 'flex flex-col')}>
            {isHomeDoc && !siteMembers.isInitialLoading && siteMembers.members.length > 0 && (
              <div className="pt-4">
                <MembersFacepile members={siteMembers.members} siteId={siteId} />
              </div>
            )}
            {isHomeDoc && !showActivity && (
              <div className="mt-4 px-6">
                <Breadcrumbs
                  breadcrumbs={[
                    {id: hmId(docId.uid, {latest: true}), metadata: document.metadata || {}},
                    ...(activeView !== 'content'
                      ? [
                          {
                            label:
                              (
                                {
                                  comments: 'Comments',
                                  collaborators: 'People',
                                  activity: 'Activity',
                                  directory: 'Directory',
                                  'site-profile': 'Profile',
                                } as Record<string, string>
                              )[activeView] || '',
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            )}
            {!isHomeDoc &&
              (isEditing ? (
                <EditableDocumentHeader
                  docId={docId}
                  docMetadata={document.metadata}
                  authors={authorPayloads}
                  updateTime={document.updateTime}
                  breadcrumbs={breadcrumbs}
                  visibility={document.visibility}
                />
              ) : (
                <DocumentHeader
                  docId={docId}
                  docMetadata={document.metadata}
                  authors={authorPayloads}
                  updateTime={document.updateTime}
                  breadcrumbs={breadcrumbs}
                  visibility={document.visibility}
                />
              ))}
          </div>
          {showSidebars && <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto')} />}
        </div>
      ) : (
        <div className={cn('mx-auto flex w-full flex-col px-4')} style={{maxWidth: contentMaxWidth}}>
          {isHomeDoc && !siteMembers.isInitialLoading && siteMembers.members.length > 0 && (
            <div className="pt-4">
              <MembersFacepile members={siteMembers.members} siteId={siteId} />
            </div>
          )}
          {isHomeDoc && !showActivity && (
            <div className="mt-4 px-6">
              <Breadcrumbs
                breadcrumbs={[
                  {id: hmId(docId.uid, {latest: true}), metadata: document.metadata || {}},
                  ...(activeView !== 'content'
                    ? [
                        {
                          label:
                            (
                              {
                                comments: 'Comments',
                                collaborators: 'People',
                                activity: 'Activity',
                                directory: 'Directory',
                                'site-profile': 'Profile',
                              } as Record<string, string>
                            )[activeView] || '',
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}
          {!isHomeDoc &&
            (isEditing ? (
              <EditableDocumentHeader
                docId={docId}
                docMetadata={document.metadata}
                authors={authorPayloads}
                updateTime={document.updateTime}
                breadcrumbs={breadcrumbs}
                visibility={document.visibility}
              />
            ) : (
              <DocumentHeader
                docId={docId}
                docMetadata={document.metadata}
                authors={authorPayloads}
                updateTime={document.updateTime}
                breadcrumbs={breadcrumbs}
                visibility={document.visibility}
              />
            ))}
        </div>
      )}

      {/* Sentinel element - important for doc tools sticky checking */}
      <div ref={toolsSentinelRef} />

      {/* DocumentTools - sticky with compact padding. Hidden when showActivity is false. */}
      {showActivity && (
        <div
          className={cn(
            'sticky top-0 z-10 px-5 py-1',
            'dark:bg-background bg-white',
            isToolsSticky ? 'shadow-md' : 'shadow-none',
            'transition-shadow',
          )}
        >
          <DocumentTools
            id={docId}
            activeTab={
              activeView === 'activity' &&
              activityFilterToSlug(route.key === 'activity' ? route.filterEventType : undefined) === 'citations'
                ? 'citations'
                : activeView === 'activity' || activeView === 'directory' || activeView === 'site-profile'
                ? undefined
                : activeView
            }
            currentPanel={panelRoute}
            existingDraft={isEditing ? undefined : existingDraft}
            commentsCount={interactionSummary.data?.comments || 0}
            citationsCount={interactionSummary.data?.citations || 0}
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
              <div className="flex items-center gap-1">
                {hasOptions && (
                  <div className="md:hidden">
                    <OptionsDropdown menuItems={allMenuItems} align="end" side="bottom" />
                  </div>
                )}
                {activeView !== 'content' && activeView !== 'site-profile' && !isMobile && (
                  <OpenInPanelButton
                    id={docId}
                    panelRoute={
                      route.key === activeView
                        ? extractPanelRoute(route)
                        : {key: activeView as Exclude<ActiveView, 'content' | 'site-profile'>, id: docId}
                    }
                  />
                )}
              </div>
            }
          />
        </div>
      )}

      {/* Main content based on activeView */}
      <div className="px-4 pb-60">
        <MainContent
          docId={docId}
          resourceId={'id' in route && typeof route.id === 'object' ? route.id : docId}
          document={document}
          activeView={activeView}
          contentMaxWidth={contentMaxWidth}
          wrapperProps={wrapperProps}
          sidebarProps={sidebarProps}
          mainContentProps={mainContentProps}
          showSidebars={showSidebars}
          showCollapsed={showCollapsed}
          discussionsParams={discussionsParams}
          activityFilterEventType={route.key === 'activity' ? route.filterEventType : undefined}
          onActivityFilterChange={handleMainActivityFilterChange}
          blockCitations={blockCitations}
          onBlockCitationClick={handleBlockCitationClick}
          onBlockCommentClick={handleBlockCommentClick}
          onBlockSelect={handleBlockSelect}
          CommentEditor={CommentEditor}
          directory={directory.data}
          siteUrl={siteUrl}
          inlineCards={inlineCards}
          inlineInsert={inlineInsert}
          DocumentContentComponent={DocumentContentComponent}
          onEditorReady={onEditorReady}
          existingDraftContent={existingDraftContent}
          existingDraftCursorPosition={existingDraftCursorPosition}
        />
      </div>
      {pageFooter ? <div className="mt-auto">{pageFooter}</div> : null}
    </div>
  )

  // Close panel handler
  const handlePanelClose = () => {
    if ('panel' in route) {
      navigate({...route, panel: null})
    }
  }

  // Activity filter change handler (panel)
  const handleFilterChange = (filter: {filterEventType?: string[]}) => {
    if ((route.key === 'document' || route.key === 'feed') && route.panel?.key === 'activity') {
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
          <GotoLatestBanner isLatest={isLatest} id={docId} document={document} />
          {mainPageContent}
        </div>
        {floatingButtons}
        {mobilePanelOpen && (
          <MobilePanelSheet isOpen={mobilePanelOpen} title={getPanelTitle(panelKey)} onClose={handlePanelClose}>
            <DiscussionsPageContent
              docId={docId}
              showTitle={false}
              showOpenInPanel={false}
              contentMaxWidth={contentMaxWidth}
              targetDomain={siteUrl}
              openComment={panelRoute?.key === 'comments' ? panelRoute.openComment : undefined}
              targetBlockId={panelRoute?.key === 'comments' ? panelRoute.targetBlockId : undefined}
              blockId={panelRoute?.key === 'comments' ? panelRoute.blockId : undefined}
              blockRange={panelRoute?.key === 'comments' ? panelRoute.blockRange : undefined}
              commentEditor={
                CommentEditor ? (
                  <CommentEditor
                    key={panelRoute?.key === 'comments' ? panelRoute.openComment : undefined}
                    docId={docId}
                    quotingBlockId={panelRoute?.key === 'comments' ? panelRoute.targetBlockId : undefined}
                    commentId={panelRoute?.key === 'comments' ? panelRoute.openComment : undefined}
                    isReplying={
                      panelRoute?.key === 'comments' ? panelRoute.isReplying ?? !!panelRoute.openComment : false
                    }
                    replyCommentVersion={panelRoute?.key === 'comments' ? panelRoute.replyCommentVersion : undefined}
                    rootReplyCommentVersion={
                      panelRoute?.key === 'comments' ? panelRoute.rootReplyCommentVersion : undefined
                    }
                    autoFocus
                  />
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
        optionsPanel={optionsPanel}
      />
    </ScrollArea>
  ) : null

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" ref={elementRef}>
      <PanelLayout
        panelKey={panelKey}
        panelContent={panelContent}
        onPanelClose={handlePanelClose}
        filterEventType={panelRoute?.key === 'activity' ? panelRoute.filterEventType : undefined}
        onFilterChange={handleFilterChange}
      >
        <GotoLatestBanner isLatest={isLatest} id={docId} document={document} />
        {/* Floating action buttons — when editing, show editing toolbar; otherwise show normal action buttons */}
        {isEditing && editingFloatingActions ? (
          <div
            className={cn(
              'absolute top-2 right-2 z-40 flex items-center gap-1 rounded-sm transition-opacity md:top-4 md:right-4',
            )}
          >
            {editingFloatingActions({menuItems: allMenuItems})}
          </div>
        ) : actionButtons ? (
          <div
            className={cn(
              'absolute top-2 right-2 z-40 flex items-center gap-1 rounded-sm transition-opacity md:top-4 md:right-4',
            )}
          >
            {actionButtons}
          </div>
        ) : null}
        <ScrollArea
          className="h-full"
          viewportClassName="[&>div]:!block [&>div]:flex [&>div]:min-h-full [&>div]:flex-col"
          fillViewportContent
        >
          {mainPageContent}
        </ScrollArea>
      </PanelLayout>
    </div>
  )
}

/**
 * Editable document header shown when in editing mode.
 * Renders the same breadcrumbs/authors/date via DocumentHeader but replaces
 * the static title and summary with editable textareas that send `change`
 * events to the document machine.
 */
function EditableDocumentHeader({
  docId,
  docMetadata,
  authors,
  updateTime,
  breadcrumbs,
  visibility,
}: {
  docId: UnpackedHypermediaId
  docMetadata: HMDocument['metadata']
  authors: AuthorPayload[]
  updateTime: HMDocument['updateTime']
  breadcrumbs?: BreadcrumbEntry[]
  visibility?: string
}) {
  const ctx = useDocumentSelector(selectContext)
  const send = useDocumentSend()
  const inputName = useRef<HTMLTextAreaElement | null>(null)
  const inputSummary = useRef<HTMLTextAreaElement | null>(null)

  // Use machine context metadata if it has been changed, otherwise fall back to document metadata
  const name = ctx.metadata?.name ?? docMetadata?.name ?? ''
  const summary = ctx.metadata?.summary ?? docMetadata?.summary ?? ''

  useEffect(() => {
    const target = inputName.current
    if (!target) return
    if (target.value !== name) {
      target.value = name || ''
      applyTitleResize(target)
    }
  }, [name])

  useEffect(() => {
    const target = inputSummary.current
    if (!target) return
    if (target.value !== summary) {
      target.value = summary || ''
      applyTitleResize(target)
    }
  }, [summary])

  useEffect(() => {
    function handleResize() {
      if (inputName.current) applyTitleResize(inputName.current)
      if (inputSummary.current) applyTitleResize(inputSummary.current)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <DocumentHeader
      docId={docId}
      docMetadata={docMetadata}
      authors={authors}
      updateTime={updateTime}
      breadcrumbs={breadcrumbs}
      visibility={visibility as any}
      showTitle={false}
    >
      <textarea
        ref={inputName}
        rows={1}
        className="w-full resize-none border-none border-transparent bg-transparent text-4xl font-bold shadow-none ring-0 ring-transparent outline-none focus:ring-0"
        defaultValue={name}
        onChange={(e) => {
          applyTitleResize(e.target)
          send({type: 'change', metadata: {name: e.target.value}})
        }}
        placeholder="Document Title"
      />
      <textarea
        ref={inputSummary}
        rows={1}
        className="text-muted-foreground w-full resize-none border-none border-transparent bg-transparent font-serif text-xl font-normal shadow-none ring-0 ring-transparent outline-none focus:ring-0"
        defaultValue={summary}
        onChange={(e) => {
          applyTitleResize(e.target)
          send({type: 'change', metadata: {summary: e.target.value}})
        }}
        placeholder="Document Summary"
      />
    </DocumentHeader>
  )
}

/** Auto-resize a textarea to fit its content. */
function applyTitleResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// Renders panel content based on panel type
function PanelContentRenderer({
  panelRoute,
  docId,
  contentMaxWidth,
  CommentEditor,
  siteUrl,
  optionsPanel,
}: {
  panelRoute: DocumentPanelRoute
  docId: UnpackedHypermediaId
  contentMaxWidth: number
  CommentEditor?: React.ComponentType<CommentEditorProps>
  siteUrl?: string
  optionsPanel?: ReactNode
}) {
  switch (panelRoute.key) {
    case 'options':
      return optionsPanel ?? null
    case 'activity':
      return (
        <Feed size="sm" filterResource={docId.id} filterEventType={panelRoute.filterEventType} targetDomain={siteUrl} />
      )
    case 'comments':
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
                key={panelRoute.openComment}
                docId={docId}
                quotingBlockId={panelRoute.targetBlockId}
                commentId={panelRoute.openComment}
                isReplying={panelRoute.isReplying ?? !!panelRoute.openComment}
                replyCommentVersion={panelRoute.replyCommentVersion}
                rootReplyCommentVersion={panelRoute.rootReplyCommentVersion}
                autoFocus
              />
            ) : undefined
          }
        />
      )
    case 'directory':
      return <DirectoryPageContent docId={docId} showTitle={false} contentMaxWidth={contentMaxWidth} />
    case 'collaborators':
      return (
        <div className="p-4">
          <CollaboratorsPage docId={docId} />
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
  siteUrl,
  inlineCards,
  inlineInsert,
  DocumentContentComponent,
  onEditorReady,
  existingDraftContent,
  existingDraftCursorPosition,
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
    blockRange?: import('@seed-hypermedia/client/hm-types').BlockRange | null
    autoFocus?: boolean
    isReplying?: boolean
    replyCommentVersion?: string
    rootReplyCommentVersion?: string
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
  directory?: import('@seed-hypermedia/client/hm-types').HMDocumentInfo[]
  siteUrl?: string
  inlineCards?: ReactNode
  inlineInsert?: ReactNode
  DocumentContentComponent?: React.ComponentType<DocumentContentProps>
  onEditorReady?: (editor: any) => void
  existingDraftContent?: HMBlockNode[]
  existingDraftCursorPosition?: number
}) {
  switch (activeView) {
    case 'directory':
      return <DirectoryPageContent docId={docId} showTitle contentMaxWidth={contentMaxWidth} />

    case 'collaborators':
      return (
        <PageLayout contentMaxWidth={contentMaxWidth}>
          <CollaboratorsPage docId={docId} />
        </PageLayout>
      )

    case 'activity':
      return (
        <PageLayout contentMaxWidth={contentMaxWidth}>
          {activityFilterToSlug(activityFilterEventType) !== 'citations' && (
            <FeedFilters filterEventType={activityFilterEventType} onFilterChange={onActivityFilterChange} />
          )}
          <Feed
            size="md"
            filterResource={docId.id}
            filterEventType={activityFilterEventType || []}
            targetDomain={siteUrl}
          />
        </PageLayout>
      )

    case 'comments':
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
                key={discussionsParams?.openComment}
                docId={docId}
                quotingBlockId={discussionsParams?.targetBlockId}
                commentId={discussionsParams?.openComment}
                isReplying={discussionsParams?.isReplying ?? !!discussionsParams?.openComment}
                replyCommentVersion={discussionsParams?.replyCommentVersion}
                rootReplyCommentVersion={discussionsParams?.rootReplyCommentVersion}
                autoFocus={discussionsParams?.autoFocus}
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
          inlineCards={inlineCards}
          inlineInsert={inlineInsert}
          DocumentContentComponent={DocumentContentComponent}
          onEditorReady={onEditorReady}
          existingDraftContent={existingDraftContent}
          existingDraftCursorPosition={existingDraftCursorPosition}
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
  inlineCards,
  inlineInsert,
  DocumentContentComponent,
  onEditorReady,
  existingDraftContent,
  existingDraftCursorPosition,
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
  directory?: import('@seed-hypermedia/client/hm-types').HMDocumentInfo[]
  inlineCards?: ReactNode
  inlineInsert?: ReactNode
  DocumentContentComponent?: React.ComponentType<DocumentContentProps>
  onEditorReady?: (editor: any) => void
  existingDraftContent?: HMBlockNode[]
  existingDraftCursorPosition?: number
}) {
  const outline = useNodesOutline(document, docId)

  return (
    <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
      {showSidebars && (
        <div {...sidebarProps}>
          {outline.length > 0 && (
            <div className="sticky top-24 mt-4">
              <DocNavigationWrapper showCollapsed={showCollapsed} outline={outline}>
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
        {DocumentContentComponent ? (
          <DocumentContentComponent
            blocks={existingDraftContent ?? document.content}
            resourceId={resourceId}
            focusBlockId={docId.blockRef ?? undefined}
            blockCitations={blockCitations}
            onBlockCitationClick={onBlockCitationClick}
            onBlockCommentClick={onBlockCommentClick}
            onBlockSelect={onBlockSelect}
            onEditorReady={onEditorReady}
            draftCursorPosition={existingDraftCursorPosition}
          />
        ) : null}
        {inlineInsert}
        {inlineCards}
        <UnreferencedDocuments docId={docId} content={document.content} directory={directory} />
      </div>

      {showSidebars && <div {...sidebarProps} />}
    </div>
  )
}

/**
 * Handles discovery subscription and loading states for a profile viewed within a site context.
 * Subscribes to the profile account so it gets discovered from the network, then shows
 * appropriate loading/discovery indicators before rendering the AccountPage.
 */
function SiteProfileContent({
  siteUid,
  accountUid,
  tab,
  onEditProfile,
  headerButtons,
  onFollowClick,
  pageFooter,
}: {
  siteUid: string
  accountUid: string
  tab: ProfileTab
  onEditProfile?: () => void
  headerButtons?: ReactNode
  onFollowClick?: () => void
  pageFooter?: ReactNode
}) {
  const profileId = hmId(accountUid)
  const profileResource = useResource(profileId, {subscribed: true, recursive: true})
  const account = useAccount(accountUid)

  if (profileResource.isInitialLoading) {
    return (
      <>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
        {pageFooter}
      </>
    )
  }

  if (profileResource.isDiscovering) {
    return (
      <>
        <PageDiscovery entityType="profile" />
        {pageFooter}
      </>
    )
  }

  if (account.isLoading) {
    return (
      <>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
        {pageFooter}
      </>
    )
  }

  if (!account.data) {
    return (
      <>
        <PageNotFound entityType="profile" />
        {pageFooter}
      </>
    )
  }

  return (
    <>
      <AccountPage
        siteUid={siteUid}
        accountUid={accountUid}
        tab={tab}
        onEditProfile={onEditProfile}
        headerButtons={headerButtons}
        onFollowClick={onFollowClick}
      />
      {pageFooter}
    </>
  )
}
