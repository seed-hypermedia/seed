import {
  BlockRange,
  HMBlockNode,
  HMComment,
  HMDocument,
  HMExistingDraft,
  HMResource,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  createInspectNavRoute,
  DocumentPanelRoute,
  findContentBlock,
  getBlockText,
  getDraftNodesOutline,
  hmId,
  NavRoute,
  ProfileTab,
  replaceRouteDocumentId,
  routeToHref,
  unpackHmId,
  useUniversalAppContext,
} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
  useCommentsServiceContext,
  useHackyAuthorsSubscriptions,
} from '@shm/shared/comments-service-provider'
import {IS_DESKTOP, NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import type {
  BlockRangeSelectOptions,
  DocumentContentProps,
  LinkExtensionOptions,
} from '@shm/shared/document-content-props'
import {findDraftForPath, isDraftPlaceholderPath, useDraftsForAccountSafe} from '@shm/shared/draft-breadcrumb-context'
import type {DocumentMachineEvent, TransientResourceError} from '@shm/shared/models/document-machine'
import {
  useAccount,
  useAccountsMetadata,
  useDirectory,
  useDocumentCollaborators,
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
  selectIsUnpublishedDraft,
  selectPublishedVersion,
  useAccountSync,
  useAutoRebase,
  useCapabilitySync,
  useDocumentNavigationOptional,
  useDocumentSelector,
  useDocumentSend,
  useDocumentSync,
  useDraftResolutionSync,
  useResourceTransientSync,
  useScrollSync,
  useVersionLatestSync,
} from '@shm/shared/models/use-document-machine'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {getRoutePanel} from '@shm/shared/routes'
import {getBreadcrumbDocumentIds, isDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {activityFilterToSlug, getCommentTargetId, parseFragment} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {getReservedLazyDraftBreadcrumbName} from '@shm/shared/utils/reserved-draft-ids'
import {FilePen, Search} from 'lucide-react'
import {CSSProperties, lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AccountPage} from './account-page'
import {AllDocumentsPage} from './all-documents-page'
import {CollaboratorsPage, getRenderedCollaboratorsCount} from './collaborators-page'
import {ScrollArea} from './components/scroll-area'
import {DirectoryPageContent} from './directory-page'
import {DiscussionsPageContent} from './discussions-page'
import {DocumentCover} from './document-cover'
import {AuthorPayload, BreadcrumbEntry, Breadcrumbs, DocumentHeader} from './document-header'
import {DocumentTools} from './document-tools'
import {DocumentVersionsPanel, isDocumentVersionsPanelRoute} from './document-versions-panel'
import {Feed, type DraftVersionEntry} from './feed'
import {FeedFilters} from './feed-filters'
import {useDocumentLayout} from './layout'
import {MembersFacepile} from './members-facepile'
import {MobilePanelSheet} from './mobile-panel-sheet'
import {
  DocNavigationItem,
  DocNavigationWrapper,
  DocumentOutline,
  isValidSiteHeaderItem,
  useNodesOutline,
} from './navigation'
import {OpenInPanelButton} from './open-in-panel'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {OptionsPanel} from './options-panel'
import {PageLayout} from './page-layout'
import {PageDeleted, PageDiscovery, PageNotFound, PagePrivate} from './page-message-states'
import {PanelLayout} from './panel-layout'
import {GotoLatestBanner, SiteHeader} from './site-header'
import {Spinner} from './spinner'
import {toast} from './toast'
import {UnreferencedDocuments} from './unreferenced-documents'
import {useBlockScroll} from './use-block-scroll'
import {useCopyHmLink} from './use-copy-hm-link'
import {useMedia} from './use-media'
import {cn} from './utils'

const LazyDocumentMachineDebugDrawer = lazy(() =>
  import('@shm/shared/models/document-machine-debug-drawer').then((m) => ({default: m.DocumentMachineDebugDrawer})),
)

/** Extract panel route from a view route, stripping top-level-only fields */
function extractPanelRoute(route: NavRoute): DocumentPanelRoute {
  const {panel, width, ...params} = route as any
  return params as DocumentPanelRoute
}

/** Returns a stable key for the exact document resource being viewed, including version state. */
export function getDocumentResourceRouteKey(id: UnpackedHypermediaId): string {
  return `${id.id}@${id.version ?? ''}@${id.latest ? 'latest' : ''}`
}

export type ActiveView =
  | 'content'
  | 'activity'
  | 'comments'
  | 'directory'
  | 'collaborators'
  | 'site-profile'
  | 'all-documents'

/** Selects the action controls shown for document content. */
export function getDocumentContentAction({
  activeView,
  isEditing,
  hasDraft,
  editingFloatingActions,
  draftActions,
  actionButtons,
  allMenuItems,
}: {
  activeView: ActiveView
  isEditing: boolean
  hasDraft: boolean
  editingFloatingActions?: (props: {menuItems: MenuItemType[]}) => ReactNode
  draftActions?: (props: {menuItems: MenuItemType[]}) => ReactNode
  actionButtons: ReactNode
  allMenuItems: MenuItemType[]
}) {
  if (activeView !== 'content') return null
  if (editingFloatingActions) return editingFloatingActions({menuItems: allMenuItems})
  if (!isEditing && hasDraft && draftActions) return draftActions({menuItems: allMenuItems})
  return actionButtons
}

type CommentDraftTarget = {
  docId: string
  commentId?: string
  quotingBlockId?: string
  quotingRangeStart?: number
  quotingRangeEnd?: number
}

/** Returns the document ID that should back the rendered document content. */
export function getRenderedDocumentId(
  routeDocId: UnpackedHypermediaId,
  resourceData: HMResource | null | undefined,
  resourceFetchId: UnpackedHypermediaId | null | undefined = routeDocId,
) {
  if (!resourceFetchId) return routeDocId
  return resourceData?.type === 'document' ? resourceData.id : routeDocId
}

function extractQuotingRange(blockRange?: BlockRange | null): {start: number; end: number} | undefined {
  if (!blockRange) return undefined
  if (
    'start' in blockRange &&
    'end' in blockRange &&
    typeof blockRange.start === 'number' &&
    typeof blockRange.end === 'number'
  ) {
    return {start: blockRange.start, end: blockRange.end}
  }
  return undefined
}

function getCommentEditorRouteKey(params?: {
  openComment?: string
  targetBlockId?: string
  blockRange?: BlockRange | null
}) {
  const range = extractQuotingRange(params?.blockRange ?? null)
  return [params?.openComment ?? 'new', params?.targetBlockId ?? 'document', range?.start ?? '', range?.end ?? ''].join(
    ':',
  )
}

function getCommentDraftTarget(
  docId: UnpackedHypermediaId,
  params?: {openComment?: string; targetBlockId?: string; blockRange?: BlockRange | null},
): CommentDraftTarget {
  const range = extractQuotingRange(params?.blockRange ?? null)
  return {
    docId: docId.id,
    commentId: params?.openComment,
    quotingBlockId: params?.targetBlockId,
    quotingRangeStart: range?.start,
    quotingRangeEnd: range?.end,
  }
}

function areSameCommentDraftTarget(a: CommentDraftTarget, b: CommentDraftTarget) {
  return (
    a.docId === b.docId &&
    a.commentId === b.commentId &&
    a.quotingBlockId === b.quotingBlockId &&
    a.quotingRangeStart === b.quotingRangeStart &&
    a.quotingRangeEnd === b.quotingRangeEnd
  )
}

export function shouldSuppressMainCommentEditor({
  docId,
  activeView,
  discussionsParams,
  panelRoute,
}: {
  docId: UnpackedHypermediaId
  activeView: ActiveView
  discussionsParams?: {openComment?: string; targetBlockId?: string; blockRange?: BlockRange | null}
  panelRoute: DocumentPanelRoute | null
}) {
  if (activeView !== 'comments' || panelRoute?.key !== 'comments') return false

  return areSameCommentDraftTarget(
    getCommentDraftTarget(docId, discussionsParams),
    getCommentDraftTarget(panelRoute.id, {
      openComment: panelRoute.openComment,
      targetBlockId: panelRoute.targetBlockId,
      blockRange: panelRoute.blockRange,
    }),
  )
}

export function shouldUseDraftForRenderedDocument({
  docId,
  existingDraft,
  isLatest,
}: {
  docId: UnpackedHypermediaId
  existingDraft?: HMExistingDraft | false
  isLatest?: boolean
}) {
  if (!existingDraft) return false
  // True old-version snapshots are immutable. If a link includes the latest
  // version CID, treat it like the normal latest route so writers keep access
  // to their draft and edit affordances.
  if (docId.version && !isLatest) return false
  return true
}

/** Return true when a local draft should bypass remote resource loading states. */
export function hasUnpublishedDraftForResourceState({
  existingDraft,
  reservedDraftId,
  resourceFetchId,
  resourceIsDiscovering,
  resourceData,
}: {
  existingDraft?: HMExistingDraft | false
  reservedDraftId?: string | null
  resourceFetchId: UnpackedHypermediaId | null
  resourceIsDiscovering: boolean
  resourceData?: {type?: string; message?: string} | null
}) {
  const hasVirtualDraft = !!reservedDraftId && !existingDraft
  return (
    (!!existingDraft || hasVirtualDraft) &&
    (resourceFetchId === null ||
      resourceIsDiscovering ||
      !resourceData ||
      resourceData.type === 'not-found' ||
      (resourceData.type === 'error' && !resourceData.message?.toLowerCase?.().includes('permission')))
  )
}

export function getCommentReplyPanelRoute({
  docId,
  comment,
  isReplying = false,
}: {
  docId: UnpackedHypermediaId
  comment: HMComment
  isReplying?: boolean
}): Extract<DocumentPanelRoute, {key: 'comments'}> {
  const targetRoute = isRouteEqualToCommentTarget({
    id: docId,
    comment,
  })
  const replyVersionData = isReplying
    ? {
        isReplying: true,
        replyCommentVersion: comment.version,
        rootReplyCommentVersion: comment.threadRootVersion || comment.version,
      }
    : {}

  return {
    key: 'comments',
    id: targetRoute || docId,
    openComment: comment.id,
    ...replyVersionData,
  }
}

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
    case 'all-documents':
      return 'all-documents'
    case 'site-profile':
      return 'site-profile'
    default:
      return 'content'
  }
}

export interface CommentEditorProps {
  docId: UnpackedHypermediaId
  quotingBlockId?: string
  /** Codepoint range within the quoted block. Absent ⇒ whole-block quote. */
  quotingRange?: {start: number; end: number}
  commentId?: string
  isReplying?: boolean
  /** Focus the editor on mount. Renamed from `autoFocus` to avoid `jsx-a11y/no-autofocus`; focus driven imperatively. */
  focusOnMount?: boolean
  /** CID version of the comment being replied to. */
  replyCommentVersion?: string
  /** CID version of the thread root comment. */
  rootReplyCommentVersion?: string
}

export interface ResourcePageProps {
  docId: UnpackedHypermediaId
  /** Resource ID to fetch for published content. Pass null for local-only draft routes that must not hit the backend. */
  resourceId?: UnpackedHypermediaId | null
  /** Factory to create comment editor - platform-specific (web vs desktop) */
  CommentEditor?: React.ComponentType<CommentEditorProps>
  /** Complete platform-specific menu items for the options dropdown */
  optionsMenuItems?: MenuItemType[]
  /** @deprecated use optionsMenuItems */
  extraMenuItems?: MenuItemType[]
  /** Existing draft info for showing draft indicator in toolbar */
  existingDraft?: HMExistingDraft | false
  /** Route-reserved draft id for an empty draft that has not been persisted yet. */
  reservedDraftId?: string | null
  /** Visibility of the existing draft, when the platform can provide full draft data. */
  existingDraftVisibility?: HMDocument['visibility']
  /** Pre-fetched content blocks from the existing draft (when available, used as editor initial content) */
  existingDraftContent?: HMBlockNode[]
  /** Cursor position saved in the draft file; used to restore cursor on reload. */
  existingDraftCursorPosition?: number
  /** Block IDs the user previously touched in this draft, persisted across reloads (for rebase classifier). */
  existingDraftMineTouchedIds?: string[]
  /** Three-way merge base captured at draft start or last rebase, persisted across reloads. */
  existingDraftBaseBlocks?: HMBlockNode[]
  /** Base deps captured for the draft. Used by platform wrappers and tests. */
  existingDraftDeps?: string[]
  /** Platform-specific confirm workflow for discarding the synthetic versions-panel draft row. */
  draftVersionOnDiscardConfirm?: (draftId: string, send: (event: DocumentMachineEvent) => void) => void
  /** Pre-rendered document content HTML for SSR (avoids blank flash before editor loads) */
  ssrContentHTML?: string | null
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
  /** Render prop for floating overlay when a draft exists but not actively editing. Shown when a draft exists and isEditing is false. */
  draftActions?: (props: {menuItems: MenuItemType[]}) => ReactNode
  /** Signing account ID for draft saving (desktop only). Flows into machine context. */
  signingAccountId?: string
  /** Publish account UID for publishing (desktop only). Flows into machine context. */
  publishAccountUid?: string
  /** Async function that uploads a File to the daemon and resolves to its CID. Platform-specific. */
  fileUpload?: (file: File) => Promise<string>
  /** Account uid used in inline mention suggestions. */
  perspectiveAccountUid?: string | null
  /** Options passed to the link extension. */
  linkExtensionOptions?: LinkExtensionOptions
  /** Optional site-header edit-nav pane rendered inside DocumentMachineProvider. */
  editNavPane?: ReactNode
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
    case 'all-documents':
      return 'All Documents'
    case 'options':
      return 'Document Options'
    default:
      return 'Panel'
  }
}

export function ResourcePage({
  docId,
  resourceId,
  CommentEditor,
  optionsMenuItems,
  extraMenuItems,
  existingDraft,
  reservedDraftId,
  existingDraftVisibility,
  existingDraftContent,
  existingDraftCursorPosition,
  existingDraftMineTouchedIds,
  existingDraftBaseBlocks,
  existingDraftDeps,
  draftVersionOnDiscardConfirm,
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
  draftActions,
  signingAccountId,
  publishAccountUid,
  fileUpload,
  ssrContentHTML,
  perspectiveAccountUid,
  linkExtensionOptions,
  editNavPane,
}: ResourcePageProps) {
  const route = useNavRoute()
  const replaceRoute = useNavigate('replace')
  const isSiteProfile = route.key === 'site-profile'

  const handleResourceRedirect = useCallback(
    ({isDeleted, redirectTarget}: {isDeleted: boolean; redirectTarget: UnpackedHypermediaId | null}) => {
      if (isDeleted || !redirectTarget) return
      const nextRoute = replaceRouteDocumentId(route, redirectTarget)
      const sourcePathName = docId.path?.join('/') || '/'
      const destinationPathName = redirectTarget.path?.join('/') || '/'
      const sourceDisplayPath = sourcePathName === '/' ? '/' : `/${sourcePathName}`
      const destinationDisplayPath = destinationPathName === '/' ? '/' : `/${destinationPathName}`
      replaceRoute(nextRoute)
      toast(`This document redirected from ${sourceDisplayPath} to ${destinationDisplayPath}.`)
    },
    [docId, replaceRoute, route],
  )

  const resourceFetchId = resourceId === undefined ? docId : resourceId
  const resource = useResource(resourceFetchId, {
    subscribed: true,
    recursive: true,
    onRedirectOrDeleted: handleResourceRedirect,
  })

  // Once a real document has been seen, keep DocumentMachineProvider mounted across any
  // subsequent transient resource failures (refetch errors, discovery flapping, transient
  // not-found from a stale daemon `latest` pointer). Without this sticky gate, the early
  // returns below would unmount DocumentBody and destroy the XState actor on each blip.
  // Reset on route changes so a newly-created local draft never reuses the parent
  // document while its draft record is resolving.
  const documentResourceRouteKey = getDocumentResourceRouteKey(docId)
  const lastGoodRouteIdRef = useRef(documentResourceRouteKey)
  const hasEverLoadedRef = useRef(false)
  const lastGoodDocumentRef = useRef<HMDocument | null>(null)
  if (lastGoodRouteIdRef.current !== documentResourceRouteKey) {
    lastGoodRouteIdRef.current = documentResourceRouteKey
    hasEverLoadedRef.current = false
    lastGoodDocumentRef.current = null
  }
  if (resourceFetchId && resource.data?.type === 'document' && resource.data.id.id === resourceFetchId.id) {
    hasEverLoadedRef.current = true
    lastGoodDocumentRef.current = resource.data.document
  }

  // docId.uid determines the site header — for site-profile, docId IS the site context
  const siteHomeId = hmId(docId.uid, {latest: true})
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})
  const isLatest = useIsLatest(resourceFetchId, resource)

  const siteHomeDocument = siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document : null

  // Compute header data
  const headerData = computeHeaderData(siteHomeDocument)

  // Comment handling: when resource is a comment, resolve and load its target document.
  // Hooks must be called unconditionally, so we always call useResource for the target
  // (it no-ops when targetDocId is null).
  const comment = resource.data?.type === 'comment' ? resource.data.comment : null
  const targetDocId = comment ? getCommentTargetId(comment) : null
  const targetResource = useResource(targetDocId, {
    subscribed: true,
    recursive: true,
  })

  // Transient (non-fatal) resource state surfaced as a banner under the site header
  // while the document keeps rendering. Only meaningful after the doc has loaded at
  // least once; before that, the regular loading/error branches still take over.
  const transientResourceError: TransientResourceError = (() => {
    if (!hasEverLoadedRef.current) return null
    if (resource.data?.type === 'error') {
      const msg = resource.data.message ?? 'Refresh failed'
      // Permission errors are persistent, not transient — leave to the regular branch.
      if (msg.toLowerCase().includes('permission')) return null
      return {kind: 'refetch-error', message: msg}
    }
    if (resource.isDiscovering) return {kind: 'discovering'}
    if (resource.data?.type === 'not-found') return {kind: 'not-found-transient'}
    return null
  })()

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

  if (resourceFetchId === null && existingDraft === undefined && !reservedDraftId) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
        {pageFooter}
      </PageWrapper>
    )
  }

  // Drafts can target a path that has no published document yet (the user
  // is creating a new doc via the unified editor). When that's the case,
  // bypass discovery / not-found and render the editor over a placeholder
  // document so the document machine can transition to "loaded" → editing.
  const hasUnpublishedDraft = hasUnpublishedDraftForResourceState({
    existingDraft,
    reservedDraftId,
    resourceFetchId,
    resourceIsDiscovering: resource.isDiscovering,
    resourceData: resource.data,
  })

  // Loading state - should not show during SSR if data was prefetched
  if (resource.isInitialLoading && !hasUnpublishedDraft && !hasEverLoadedRef.current) {
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
  if (resource.isDiscovering && !hasUnpublishedDraft && !hasEverLoadedRef.current) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageDiscovery />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle not-found
  if ((!resource.data || resource.data.type === 'not-found') && !hasUnpublishedDraft && !hasEverLoadedRef.current) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageNotFound />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle tombstone (deleted) — real deletion, not transient. Always unmount.
  if (!hasUnpublishedDraft && (resource.isTombstone || resource.data?.type === 'tombstone')) {
    const isCommentRoute = route.key === 'comments'
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageDeleted entityType={isCommentRoute ? 'comment' : 'document'} />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle private document (permission denied) — persistent state, always unmount.
  if (resource.data?.type === 'error' && resource.data.message.toLowerCase().includes('permission')) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PagePrivate />
        {pageFooter}
      </PageWrapper>
    )
  }

  // Handle error — only if we never loaded successfully. Otherwise fall through to the
  // success render path with a banner so the user keeps the document in view.
  if (!hasUnpublishedDraft && resource.data?.type === 'error' && !hasEverLoadedRef.current) {
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
            ssrContentHTML={ssrContentHTML}
            perspectiveAccountUid={perspectiveAccountUid}
            linkExtensionOptions={linkExtensionOptions}
          />
        </PageWrapper>
      </DocumentMachineProvider>
    )
  }

  // Success: render document. When the doc isn't published yet but a draft
  // exists, fabricate a placeholder so DocumentBody / the document machine
  // can transition to "loaded" → editing for the new-document case.
  let document: HMDocument
  const renderedDocId = getRenderedDocumentId(docId, resource.data, resourceFetchId)
  if (resourceFetchId && resource.data?.type === 'document') {
    document = resource.data.document
  } else if (lastGoodDocumentRef.current) {
    // Transient refetch failure / not-found / discovery flap — keep showing the last
    // good document. The banner in PageWrapper informs the user.
    document = lastGoodDocumentRef.current
  } else if (hasUnpublishedDraft) {
    document = {
      account: docId.uid,
      path: `/${(docId.path ?? []).join('/')}`,
      content: [],
      metadata: existingDraft && existingDraft.metadata ? existingDraft.metadata : {},
      visibility: existingDraftVisibility,
      version: '',
      authors: [],
      createTime: undefined as any,
      updateTime: undefined as any,
      genesis: '',
    } as unknown as HMDocument
  } else {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData} rightActions={rightActions}>
        <PageNotFound />
        {pageFooter}
      </PageWrapper>
    )
  }

  const shouldUseDraft = shouldUseDraftForRenderedDocument({docId: renderedDocId, existingDraft, isLatest})
  const effectiveCanEdit =
    (canEdit || (resourceFetchId === null && !!existingDraft)) && (!renderedDocId.version || isLatest || shouldUseDraft)
  const effectiveExistingDraft = shouldUseDraft ? existingDraft : false
  const effectiveExistingDraftVisibility = shouldUseDraft ? existingDraftVisibility : undefined
  const effectiveExistingDraftContent = shouldUseDraft ? existingDraftContent : undefined
  const effectiveExistingDraftCursorPosition = shouldUseDraft ? existingDraftCursorPosition : undefined
  const effectiveExistingDraftMineTouchedIds = shouldUseDraft ? existingDraftMineTouchedIds : undefined
  const effectiveExistingDraftBaseBlocks = shouldUseDraft ? existingDraftBaseBlocks : undefined
  const effectiveExistingDraftDeps = shouldUseDraft ? existingDraftDeps : undefined
  const draftVersionEntry = existingDraft
    ? {
        docId: renderedDocId,
        draftId: existingDraft.id,
        deps: existingDraftDeps,
        metadata: existingDraft.metadata,
        onDiscardConfirm: draftVersionOnDiscardConfirm,
      }
    : undefined

  return (
    <DocumentMachineProvider
      // Key on the route id so the machine actor is recreated when the URL
      // path changes (e.g. after first publish from `-${draftId}` → real slug).
      // Without this, useActorRef keeps the original actor instance and its
      // context still references the old documentId/editPath.
      key={`${renderedDocId.id}@${renderedDocId.version ?? 'latest'}`}
      input={{
        documentId: renderedDocId,
        canEdit: effectiveCanEdit,
        isLatest,
        deps: effectiveExistingDraftDeps,
        reservedDraftId: reservedDraftId ?? undefined,
        editUid: renderedDocId.uid,
        editPath: renderedDocId.path ?? undefined,
        signingAccountId,
        publishAccountUid,
      }}
      machine={machine}
      inspect={inspect}
    >
      <PageWrapper
        siteHomeId={siteHomeId}
        docId={renderedDocId}
        headerData={headerData}
        document={document}
        rightActions={rightActions}
        editNavPane={editNavPane}
        transientResourceError={transientResourceError}
      >
        <DocumentBody
          docId={renderedDocId}
          document={document}
          activeView={getActiveView(route.key)}
          isLatest={isLatest}
          siteUrl={siteHomeDocument?.metadata?.siteUrl}
          CommentEditor={CommentEditor}
          optionsMenuItems={optionsMenuItems}
          extraMenuItems={extraMenuItems}
          existingDraft={effectiveExistingDraft}
          reservedDraftId={reservedDraftId}
          existingDraftVisibility={effectiveExistingDraftVisibility}
          existingDraftContent={effectiveExistingDraftContent}
          existingDraftCursorPosition={effectiveExistingDraftCursorPosition}
          existingDraftMineTouchedIds={effectiveExistingDraftMineTouchedIds}
          existingDraftBaseBlocks={effectiveExistingDraftBaseBlocks}
          existingDraftDeps={effectiveExistingDraftDeps}
          draftVersionEntry={draftVersionEntry}
          floatingButtons={floatingButtons}
          pageFooter={pageFooter}
          inlineCards={inlineCards}
          inlineInsert={inlineInsert}
          DocumentContentComponent={DocumentContentComponent}
          onEditorReady={onEditorReady}
          canEdit={effectiveCanEdit}
          editingFloatingActions={editingFloatingActions}
          draftActions={draftActions}
          signingAccountId={signingAccountId}
          publishAccountUid={publishAccountUid}
          fileUpload={fileUpload}
          ssrContentHTML={ssrContentHTML}
          perspectiveAccountUid={perspectiveAccountUid}
          linkExtensionOptions={linkExtensionOptions}
          transientResourceError={transientResourceError}
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

export function computeHeaderData(siteHomeDocument: HMDocument | null): HeaderData {
  // Top navigation is manual-only for now. If the home document has no
  // explicit `navigation` detached block, the header stays empty rather than
  // inferring items from the document hierarchy.
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
        .filter((item): item is DocNavigationItem => item !== null && isValidSiteHeaderItem(item)) ?? []
    : []

  const isCenterLayout =
    siteHomeDocument?.metadata?.theme?.headerLayout === 'Center' ||
    siteHomeDocument?.metadata?.layout === 'Seed/Experimental/Newspaper'

  return {
    items: homeNavigationItems,
    homeNavigationItems,
    directoryItems: [],
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
  editNavPane,
  transientResourceError,
}: {
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId
  headerData: HeaderData
  document?: HMDocument
  children: React.ReactNode
  isMainFeedVisible?: boolean
  rightActions?: React.ReactNode
  editNavPane?: React.ReactNode
  /** Non-fatal resource fetch state rendered as a banner below the header. */
  transientResourceError?: TransientResourceError
}) {
  // Mobile: let content flow naturally (document scroll)
  // Desktop: fixed height container (element scroll via ScrollArea in children)
  // Note: IS_DESKTOP (Electron) never uses document scroll regardless of window width
  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP

  // Live-preview the in-flight nav while the user edits the home doc, so
  // additions/reorders/deletions in the EditNavPopover show immediately in
  // the visible site header. Mirrors the legacy draft route at
  // frontend/apps/desktop/src/pages/draft.tsx:880-893. Returns undefined
  // outside DocumentMachineProvider (loading/error/discovery branches), in
  // which case we fall back to the published headerData.items.
  const machineNav = useDocumentNavigationOptional()
  const isHomeDoc = !docId.path?.length
  const liveItems: DocNavigationItem[] | undefined =
    isHomeDoc && machineNav
      ? machineNav
          .map((n) => {
            const id = unpackHmId(n.link)
            return {
              key: n.id,
              id: id ?? undefined,
              webUrl: id ? undefined : n.link,
              draftId: undefined,
              metadata: {name: n.text || ''},
              isPublished: true,
            } satisfies DocNavigationItem
          })
          .filter(isValidSiteHeaderItem)
      : undefined
  const itemsForHeader = liveItems ?? headerData.items

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
        items={itemsForHeader}
        homeNavigationItems={headerData.homeNavigationItems}
        directoryItems={headerData.directoryItems}
        isCenterLayout={headerData.isCenterLayout}
        document={document}
        siteHomeDocument={headerData.siteHomeDocument}
        isMainFeedVisible={isMainFeedVisible}
        notifyServiceHost={NOTIFY_SERVICE_HOST}
        rightActions={rightActions}
        editNavPane={editNavPane}
      />
      <TransientResourceBanner error={transientResourceError ?? null} />
      {children}
    </div>
  )
}

function TransientResourceBanner({error}: {error: TransientResourceError}) {
  if (!error) return null
  const tone =
    error.kind === 'refetch-error'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
      : 'bg-muted text-muted-foreground'
  let message: string
  switch (error.kind) {
    case 'refetch-error':
      message = `Couldn't refresh from peers. Showing last loaded version. (${error.message})`
      break
    case 'discovering':
      message = 'Looking for newer version…'
      break
    case 'not-found-transient':
      message = 'Document temporarily unreachable. Retrying…'
      break
  }
  return (
    <div role="status" className={cn('px-4 py-2 text-xs', tone)} data-testid="transient-resource-banner">
      {message}
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
  optionsMenuItems,
  extraMenuItems,
  existingDraft,
  reservedDraftId,
  existingDraftVisibility,
  existingDraftContent,
  existingDraftCursorPosition,
  existingDraftMineTouchedIds,
  existingDraftBaseBlocks,
  existingDraftDeps,
  draftVersionEntry,
  floatingButtons,
  pageFooter,
  inlineCards,
  openComment,
  inlineInsert,
  DocumentContentComponent,
  onEditorReady,
  canEdit = false,
  editingFloatingActions,
  draftActions,
  signingAccountId,
  publishAccountUid,
  fileUpload,
  ssrContentHTML,
  perspectiveAccountUid,
  linkExtensionOptions,
  transientResourceError,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  /** Which tab/view to display */
  activeView: ActiveView
  isLatest?: boolean
  siteUrl?: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
  optionsMenuItems?: MenuItemType[]
  extraMenuItems?: MenuItemType[]
  existingDraft?: HMExistingDraft | false
  reservedDraftId?: string | null
  existingDraftVisibility?: HMDocument['visibility']
  existingDraftContent?: HMBlockNode[]
  existingDraftCursorPosition?: number
  existingDraftMineTouchedIds?: string[]
  existingDraftBaseBlocks?: HMBlockNode[]
  existingDraftDeps?: string[]
  draftVersionEntry?: DraftVersionEntry
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
  /** Render prop for floating overlay when a draft exists but not actively editing */
  draftActions?: (props: {menuItems: MenuItemType[]}) => ReactNode
  /** Signing account ID for draft saving (desktop only) */
  signingAccountId?: string
  /** Publish account UID for publishing (desktop only) */
  publishAccountUid?: string
  /** Async function that uploads a File to the daemon and resolves to its CID */
  fileUpload?: (file: File) => Promise<string>
  ssrContentHTML?: string | null
  /** Account uid used in inline mention suggestions. */
  perspectiveAccountUid?: string | null
  /** Options passed to the link extension. */
  linkExtensionOptions?: LinkExtensionOptions
  /** Non-fatal resource fetch state synced into the machine context. */
  transientResourceError?: TransientResourceError
}) {
  // Sync document into state machine
  useDocumentSync(document)
  // Sync canEdit changes into the machine (for account switching)
  useCapabilitySync(canEdit)
  // Sync isLatest changes into the machine (for old-version edit guard)
  useVersionLatestSync(isLatest)
  // Sync account IDs into the machine (for draft saving / publishing)
  useAccountSync(signingAccountId, publishAccountUid)
  // Forward scroll events from the scroll container to the machine
  useScrollSync()
  // Surface transient resource fetch state inside the machine for debug / inner consumers.
  useResourceTransientSync(transientResourceError ?? null)
  // Sync draft resolution — machine stays in loading until this settles.
  // undefined = still loading, {draftId: null} = no draft, {draftId: string} = draft + content ready
  const draftResolution = useMemo(() => {
    let result:
      | {
          draftId: string | null
          content: HMBlockNode[] | null
          cursorPosition: number | null
          metadata?: import('@seed-hypermedia/client/hm-types').HMMetadata | null
          deps?: string[] | null
          mineTouchedIds?: string[] | null
          baseBlocks?: HMBlockNode[] | null
        }
      | undefined
    if (existingDraft === undefined) {
      result = undefined
    } else if (!existingDraft) {
      result = {draftId: null as string | null, content: null, cursorPosition: null}
    } else if (existingDraftContent) {
      result = {
        draftId: existingDraft.id,
        content: existingDraftContent,
        cursorPosition: existingDraftCursorPosition ?? null,
        metadata: existingDraft.metadata ?? null,
        deps: existingDraftDeps ?? null,
        mineTouchedIds: existingDraftMineTouchedIds ?? null,
        baseBlocks: existingDraftBaseBlocks ?? null,
      }
    } else {
      result = undefined // draft found but content not loaded yet
    }
    return result
  }, [
    existingDraft,
    existingDraftContent,
    existingDraftCursorPosition,
    existingDraftDeps,
    existingDraftMineTouchedIds,
    existingDraftBaseBlocks,
  ])
  useDraftResolutionSync(draftResolution)
  const publishedVersion = useDocumentSelector(selectPublishedVersion)
  const isEditing = useDocumentSelector(selectIsEditing)
  const isUnpublishedDraft = useDocumentSelector(selectIsUnpublishedDraft)
  const ctx = useDocumentSelector(selectContext)
  // Set of block ids present in the currently published version of the document.
  const publishedBlockIds = useMemo(() => {
    const ids = new Set<string>()
    const walk = (nodes: HMBlockNode[] | undefined) => {
      if (!nodes) return
      for (const node of nodes) {
        if (node.block?.id) ids.add(node.block.id)
        if (node.children) walk(node.children)
      }
    }
    walk(document?.content ?? [])
    return ids
  }, [document?.content])
  const isBlockInPublishedVersion = useCallback(
    (blockId: string) => publishedBlockIds.has(blockId),
    [publishedBlockIds],
  )

  // Capture the editor instance locally and forward to upstream onEditorReady.
  // The local state drives useAutoRebase (auto-rebase on remote updates during editing).
  const [autoRebaseEditor, setAutoRebaseEditor] = useState<any>(null)
  const handleEditorReadyWrapped = useCallback(
    (editor: any) => {
      setAutoRebaseEditor(editor)
      onEditorReady?.(editor)
    },
    [onEditorReady],
  )
  useAutoRebase({
    editor: autoRebaseEditor,
    suppressChangeRef: autoRebaseEditor?._suppressChangeRef,
    onAutoMerged: (author) => {
      const msg = author ? `Draft updated with ${author}'s latest changes.` : `Draft updated to latest version.`
      toast.success(msg)
    },
    // Conflict path applies a mine-wins merge automatically (publish is never
    // blocked). The toast informs the user so they can review the other side's
    // changes if desired. Phase B will surface a per-block picker.
    onConflictDetected: ({conflictedBlockIds, author}) => {
      const blockCount = conflictedBlockIds.length
      const blockNoun = blockCount === 1 ? 'block' : 'blocks'
      const who = author ? `${author}` : 'another author'
      toast.info(`${who} also edited ${blockCount} ${blockNoun} — your version was kept.`, {duration: 6000})
    },
  })

  const route = useNavRoute()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')

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
  const suppressMainCommentEditor = shouldSuppressMainCommentEditor({
    docId,
    activeView,
    discussionsParams,
    panelRoute,
  })

  // Respect the showActivity metadata toggle to hide the document tools bar.
  const showActivity = document.metadata?.showActivity !== false

  // Extract blockRef from route for scroll-to-block and highlighting
  const routeBlockRef = 'id' in route && typeof route.id === 'object' ? route.id.blockRef : null
  const {scrollToBlock} = useBlockScroll(routeBlockRef)

  // On mount, sync URL hash (#blockId) into route if not already present
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
  const draftVisibility = existingDraft ? existingDraftVisibility : undefined
  const headerVisibility =
    document.visibility === 'PRIVATE' || draftVisibility === 'PRIVATE' ? 'PRIVATE' : document.visibility
  const siteId = useMemo(() => hmId(docId.uid), [docId.uid])
  const siteMembers = useSiteMembers(siteId)
  const directory = useDirectory(docId)
  const interactionSummary = useInteractionSummary(docId)
  const collaborators = useDocumentCollaborators(docId)
  const peopleCount = useMemo(
    () => getRenderedCollaboratorsCount(collaborators.data, isHomeDoc),
    [collaborators.data, isHomeDoc],
  )

  // Breadcrumbs: fetch parent documents for non-home docs
  const breadcrumbIds = useMemo(() => {
    if (isHomeDoc) return []
    return getBreadcrumbDocumentIds(docId)
  }, [docId, isHomeDoc])

  // Local drafts override published metadata for breadcrumb segments. The
  // provider returns an empty list on platforms without local drafts (e.g.
  // current web), so the daemon-fetch path stays unchanged there.
  const accountDrafts = useDraftsForAccountSafe(docId.uid)

  // Resolve each breadcrumb segment to a local draft when possible. A draft
  // match short-circuits the daemon fetch and the discovery subscription —
  // we pass `null` at draft positions to `useResources` (see below) which
  // honours `enabled: !!id` and skips both.
  const draftsForBreadcrumbs = useMemo(
    () => breadcrumbIds.map((id) => findDraftForPath(accountDrafts.data, id.uid, id.path ?? [])),
    [breadcrumbIds, accountDrafts.data],
  )

  const reservedDraftBreadcrumbNames = useMemo(
    () => breadcrumbIds.map((id) => getReservedLazyDraftBreadcrumbName(id.path?.at(-1), reservedDraftId)),
    [breadcrumbIds, reservedDraftId],
  )

  // Positions where the draft list is still loading but the path *looks*
  // like a draft (placeholder `-` segment). We treat them as loading rather
  // than firing a daemon fetch we'll discard once the local list resolves.
  // Preallocated lazy draft ids are already known locally, so render their
  // stable placeholder breadcrumb immediately instead of a loading spinner.
  const pendingDraftLookup = useMemo(
    () =>
      breadcrumbIds.map(
        (id, i) => accountDrafts.isLoading && isDraftPathSegment(id.path?.at(-1)) && !reservedDraftBreadcrumbNames[i],
      ),
    [breadcrumbIds, accountDrafts.isLoading, reservedDraftBreadcrumbNames],
  )

  // Mask draft positions so `useResources` skips the daemon `Resource`
  // request and the discovery subscription for them. Array length is
  // preserved so downstream index-based access stays aligned.
  const resourceFetchIds = useMemo(
    () =>
      breadcrumbIds.map((id, i) =>
        draftsForBreadcrumbs[i] || pendingDraftLookup[i] || reservedDraftBreadcrumbNames[i] ? null : id,
      ),
    [breadcrumbIds, draftsForBreadcrumbs, pendingDraftLookup, reservedDraftBreadcrumbNames],
  )

  const breadcrumbResults = useResources(resourceFetchIds, {subscribed: true})

  const breadcrumbs = useMemo((): BreadcrumbEntry[] | undefined => {
    if (isHomeDoc) return undefined
    const lastIdx = breadcrumbIds.length - 1
    const items: BreadcrumbEntry[] = breadcrumbIds.map((id, i) => {
      const draft = draftsForBreadcrumbs[i]
      const isCurrent = i === lastIdx
      const currentDraftName =
        isCurrent && isUnpublishedDraft
          ? ctx.metadata?.name || (existingDraft ? existingDraft.metadata?.name : undefined)
          : undefined
      const reservedDraftBreadcrumbName = reservedDraftBreadcrumbNames[i]
      const fallbackName = currentDraftName || reservedDraftBreadcrumbName || id.path?.at(-1) || id.uid.slice(0, 8)

      if (draft) {
        const draftIsUnpublished = isDraftPlaceholderPath(id.path, draft.id) || (isCurrent && isUnpublishedDraft)
        const draftMetadata = draft.metadata ?? {}
        const draftName = currentDraftName || draftMetadata.name
        return {
          id,
          metadata: draftName ? {...draftMetadata, name: draftName} : draftMetadata,
          draftId: draft.id,
          fallbackName: draftName || fallbackName,
          isLoading: false,
          isTombstone: false,
          isNotFound: false,
          isError: false,
          isUnpublishedDraft: draftIsUnpublished,
        }
      }

      if (reservedDraftBreadcrumbName) {
        return {
          id,
          metadata: currentDraftName ? {name: currentDraftName} : {},
          fallbackName,
          isLoading: false,
          isTombstone: false,
          isNotFound: false,
          isError: false,
          isUnpublishedDraft: true,
        }
      }

      if (pendingDraftLookup[i]) {
        return {
          id,
          metadata: {},
          fallbackName,
          isLoading: true,
          isTombstone: false,
          isNotFound: false,
          isError: false,
          isUnpublishedDraft: true,
        }
      }

      const result = breadcrumbResults[i]
      const data = result?.data
      // Fallback: the document machine knows the current doc is an
      // unpublished draft even before the account draft list resolves.
      // Avoids flashing "not found" on the active draft on first paint.
      const showAsUnpublishedDraft = isCurrent && isUnpublishedDraft
      const metadata =
        isCurrent && currentDraftName
          ? {...(document.metadata || {}), name: currentDraftName}
          : isCurrent
            ? document.metadata || {}
            : data?.type === 'document'
              ? data.document?.metadata || {}
              : {}
      return {
        id,
        metadata,
        draftId: showAsUnpublishedDraft && existingDraft ? existingDraft.id : undefined,
        fallbackName,
        isLoading: !result || result?.isDiscovering || result?.isLoading,
        isTombstone: result?.isTombstone,
        isNotFound: !showAsUnpublishedDraft && data?.type === 'not-found' && !result?.isDiscovering,
        isError: result?.isError && !result?.isDiscovering && !result?.isTombstone,
        isUnpublishedDraft: showAsUnpublishedDraft,
      }
    })

    // Append active panel name when not on content/draft view
    const panelLabels: Record<string, string> = {
      comments: 'Comments',
      collaborators: 'People',
      directory: 'Directory',
      activity: 'Activity',
      'all-documents': 'All Documents',
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
        const truncated = text.length > 40 ? text.slice(0, 40) + '…' : text
        if (truncated) items.push({label: `"${truncated}"`})
      }
    }

    return items
  }, [
    isHomeDoc,
    breadcrumbIds,
    breadcrumbResults,
    draftsForBreadcrumbs,
    pendingDraftLookup,
    reservedDraftBreadcrumbNames,
    document.metadata,
    isUnpublishedDraft,
    existingDraft,
    ctx.metadata?.name,
    activeView,
    routeBlockRef,
    document.content,
    route,
  ])

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
  const copyHmLink = useCopyHmLink()
  // Current origin for gateway-format links (web: site's own URL; desktop: the
  // configured gateway). Used as a fallback when the document has no site URL.
  const {origin: appOrigin, experiments} = useUniversalAppContext()

  const handleBlockCitationClick = useCallback(
    (blockId?: string | null) => {
      if (route.key !== 'document' && route.key !== 'feed') return
      navigate({
        ...route,
        id: {
          ...route.id,
          blockRef: blockId || null,
          // Mark the block as expanded so the editor highlight plugin focuses
          // and highlights the whole block (not just a text range).
          blockRange: blockId ? {expanded: true} : null,
        },
        panel: {
          key: 'comments',
          id: route.id,
          // DiscussionsPanel reads `targetBlockId` to scope the panel to a
          // single block's discussions; `blockId` was the wrong field.
          targetBlockId: blockId || undefined,
        } as any,
      })
      if (blockId) scrollToBlock(blockId)
    },
    [route, navigate, scrollToBlock],
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
        // Pin to the published version only if the block actually exists there.
        // Newly-added draft blocks aren't in any published version yet — emit
        // a version-less, latest-resolving link so the URL stays valid once
        // the next publish lands.
        const publishedVersionCandidate = publishedVersion ?? document.version
        const existsInPublished = !!findContentBlock(document.content ?? [], blockId)
        const versionForLink = existsInPublished ? publishedVersionCandidate : null
        copyHmLink({
          id: {
            ...docId,
            version: versionForLink ?? null,
            blockRef: blockId,
            blockRange,
            hostname: siteUrl ?? docId.hostname ?? null,
            latest: existsInPublished ? null : true,
          },
          // Fall back to the app origin for gateway-format URLs so copied
          // links on web point back to this deployment (instead of the
          // default `hyper.media` gateway) when no site URL is set.
          gatewayUrl: appOrigin ?? undefined,
        })
      }
      // Always scroll + navigate so the URL updates and the target block gets
      // visually focused/highlighted — even on copy clicks.
      scrollToBlock(blockId)
      navigate(blockRoute)
    },
    [
      route,
      navigate,
      scrollToBlock,
      docId,
      document.version,
      document.content,
      siteUrl,
      publishedVersion,
      copyHmLink,
      appOrigin,
    ],
  )

  const handleTextSelection = useCallback(() => {
    if (route.key !== 'document' && route.key !== 'feed') return
    if (!route.id.blockRef && !route.id.blockRange) return

    replaceRoute({
      ...route,
      id: {
        ...route.id,
        blockRef: null,
        blockRange: null,
      },
    })
  }, [route, replaceRoute])

  // Activity filter change handler (main page)
  const handleMainActivityFilterChange = (filter: {filterEventType?: string[]}) => {
    if (route.key === 'activity') {
      navigate({
        ...route,
        filterEventType: filter.filterEventType,
      })
    }
  }

  // Options dropdown: fully controlled by platform wrappers.
  const inspectMenuItem = useMemo<MenuItemType | null>(() => {
    if (!experiments?.developerTools) return null
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
  }, [docId, navigate, route.key, experiments?.developerTools])
  const documentOptionsMenuItem = useMemo<MenuItemType | null>(() => {
    if (!canEdit) return null
    return {
      key: 'options',
      label: 'Document Settings',
      icon: <FilePen className="size-4" />,
      onClick: () => {
        const newPanel = panelKey === 'options' ? null : {key: 'options' as const}
        replaceRoute({...route, panel: newPanel} as any)
      },
    }
  }, [canEdit, panelKey, route, replaceRoute])

  const allMenuItems = useMemo(() => {
    let unorderedItems: MenuItemType[] = [...(optionsMenuItems ?? extraMenuItems ?? [])]
    if (inspectMenuItem) unorderedItems.push(inspectMenuItem)
    if (documentOptionsMenuItem) unorderedItems.push(documentOptionsMenuItem)
    // Drop share/copy-link entries while the doc is an unpublished draft —
    // its URL won't resolve for anyone else, so any "share" action is a footgun.
    if (isUnpublishedDraft) {
      const drop = (key: string) => key === 'copy-link' || key.startsWith('copy-') || key === 'share'
      unorderedItems = unorderedItems.filter((item) => !drop(item.key))
    }
    // Contextual menu items ordering
    const itemOrder = [
      'new',
      'versions',
      'options',
      'copy-link',
      'link-site',
      'link',
      'move',
      'duplicate',
      'branch',
      'export',
      'directory',
      'all-documents',
    ]
    const byKey = new Map(unorderedItems.map((i) => [i.key, i]))
    const orderedItems: MenuItemType[] = []
    const consumed = new Set<string>()
    for (const key of itemOrder) {
      const item = byKey.get(key)
      if (item && item.variant !== 'destructive') {
        orderedItems.push(item)
        consumed.add(key)
      }
    }
    for (const item of unorderedItems) {
      if (consumed.has(item.key) || item.variant === 'destructive') continue
      orderedItems.push(item)
    }
    for (const item of unorderedItems) {
      if (item.variant === 'destructive') orderedItems.push(item)
    }
    return orderedItems
  }, [optionsMenuItems, extraMenuItems, inspectMenuItem, documentOptionsMenuItem, isUnpublishedDraft])

  const hasOptions = allMenuItems.length > 0
  const actionButtons = hasOptions ? <OptionsDropdown menuItems={allMenuItems} align="end" side="bottom" /> : null
  const documentContentAction = getDocumentContentAction({
    activeView,
    isEditing,
    hasDraft: ctx.draftId !== null,
    editingFloatingActions,
    draftActions,
    actionButtons,
    allMenuItems,
  })
  const documentContentActionOverlay =
    documentContentAction && !isMobile ? (
      <div className="absolute top-2 right-2 z-50 flex items-center gap-1 rounded-sm transition-opacity md:top-4 md:right-4">
        {documentContentAction}
      </div>
    ) : null
  const documentToolsRightAction = isMobile ? documentContentAction : null
  const floatingButtonsAction = activeView === 'content' && !documentContentAction ? floatingButtons : null

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
        <div {...wrapperProps} className={cn(wrapperProps.className, 'flex-none', !showSidebars && 'justify-center')}>
          {showSidebars && <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto')} />}
          <div {...mainContentProps} className={cn(mainContentProps.className, 'flex flex-col')}>
            {isHomeDoc &&
              activeView !== 'all-documents' &&
              !siteMembers.isInitialLoading &&
              siteMembers.members.length > 0 && (
                <div className="pt-4">
                  <MembersFacepile members={siteMembers.members} siteId={siteId} />
                </div>
              )}
            {isHomeDoc && !showActivity && activeView !== 'all-documents' && (
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
                                  'all-documents': 'All Documents',
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
              (canEdit ? (
                <EditableDocumentHeader
                  docId={docId}
                  docMetadata={document.metadata}
                  authors={authorPayloads}
                  updateTime={document.updateTime}
                  breadcrumbs={breadcrumbs}
                  visibility={headerVisibility}
                  version={document.version}
                />
              ) : (
                <DocumentHeader
                  docId={docId}
                  docMetadata={document.metadata}
                  authors={authorPayloads}
                  updateTime={document.updateTime}
                  breadcrumbs={breadcrumbs}
                  visibility={headerVisibility}
                  version={document.version}
                />
              ))}
          </div>
          {showSidebars && <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto')} />}
        </div>
      ) : (
        <div className={cn('mx-auto flex w-full flex-col px-4')} style={{maxWidth: contentMaxWidth}}>
          {isHomeDoc &&
            activeView !== 'all-documents' &&
            !siteMembers.isInitialLoading &&
            siteMembers.members.length > 0 && (
              <div className="pt-4">
                <MembersFacepile members={siteMembers.members} siteId={siteId} />
              </div>
            )}
          {isHomeDoc && !showActivity && activeView !== 'all-documents' && (
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
                                'all-documents': 'All Documents',
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
            (canEdit ? (
              <EditableDocumentHeader
                docId={docId}
                docMetadata={document.metadata}
                authors={authorPayloads}
                updateTime={document.updateTime}
                breadcrumbs={breadcrumbs}
                visibility={headerVisibility}
                version={document.version}
              />
            ) : (
              <DocumentHeader
                docId={docId}
                docMetadata={document.metadata}
                authors={authorPayloads}
                updateTime={document.updateTime}
                breadcrumbs={breadcrumbs}
                visibility={headerVisibility}
                version={document.version}
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
                : activeView === 'activity' ||
                    activeView === 'directory' ||
                    activeView === 'site-profile' ||
                    activeView === 'all-documents'
                  ? undefined
                  : activeView
            }
            currentPanel={panelRoute}
            existingDraft={isEditing ? undefined : existingDraft}
            commentsCount={interactionSummary.data?.comments || 0}
            citationsCount={interactionSummary.data?.citations || 0}
            collabsCount={peopleCount}
            rightAction={documentToolsRightAction}
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
            activeTabAction={
              activeView !== 'content' && activeView !== 'site-profile' && activeView !== 'all-documents' ? (
                <OpenInPanelButton
                  id={docId}
                  panelRoute={
                    route.key === activeView
                      ? extractPanelRoute(route)
                      : {
                          key: activeView as Exclude<ActiveView, 'content' | 'site-profile' | 'all-documents'>,
                          id: docId,
                        }
                  }
                />
              ) : null
            }
          />
        </div>
      )}

      {/* Main content based on activeView */}
      <div className={cn('flex-1', activeView !== 'content' && 'pb-60', isMobile && 'px-4')}>
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
          suppressCommentEditor={suppressMainCommentEditor}
          activityFilterEventType={route.key === 'activity' ? route.filterEventType : undefined}
          onActivityFilterChange={handleMainActivityFilterChange}
          blockCitations={blockCitations}
          onBlockCitationClick={handleBlockCitationClick}
          onBlockCommentClick={handleBlockCommentClick}
          onBlockSelect={handleBlockSelect}
          onTextSelection={handleTextSelection}
          isUnpublishedDraft={isUnpublishedDraft}
          isBlockInPublishedVersion={isBlockInPublishedVersion}
          CommentEditor={CommentEditor}
          directory={directory.data}
          siteUrl={siteUrl}
          inlineCards={inlineCards}
          inlineInsert={inlineInsert}
          DocumentContentComponent={DocumentContentComponent}
          onEditorReady={handleEditorReadyWrapped}
          existingDraftContent={existingDraftContent}
          existingDraftCursorPosition={existingDraftCursorPosition}
          ssrContentHTML={ssrContentHTML}
          perspectiveAccountUid={perspectiveAccountUid}
          linkExtensionOptions={linkExtensionOptions}
          fileUpload={fileUpload}
          draftVersionEntry={draftVersionEntry}
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
          {floatingButtonsAction}
        </div>

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
                    key={
                      panelRoute?.key === 'comments'
                        ? getCommentEditorRouteKey({
                            openComment: panelRoute.openComment,
                            targetBlockId: panelRoute.targetBlockId,
                            blockRange: panelRoute.blockRange,
                          })
                        : undefined
                    }
                    docId={docId}
                    quotingBlockId={panelRoute?.key === 'comments' ? panelRoute.targetBlockId : undefined}
                    quotingRange={
                      panelRoute?.key === 'comments' ? extractQuotingRange(panelRoute.blockRange) : undefined
                    }
                    commentId={panelRoute?.key === 'comments' ? panelRoute.openComment : undefined}
                    isReplying={
                      panelRoute?.key === 'comments' ? panelRoute.isReplying ?? !!panelRoute.openComment : false
                    }
                    replyCommentVersion={panelRoute?.key === 'comments' ? panelRoute.replyCommentVersion : undefined}
                    rootReplyCommentVersion={
                      panelRoute?.key === 'comments' ? panelRoute.rootReplyCommentVersion : undefined
                    }
                    focusOnMount
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
        fileUpload={fileUpload}
        draftVersionEntry={draftVersionEntry}
      />
    </ScrollArea>
  ) : null

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" ref={elementRef}>
      <PanelLayout
        panelKey={panelKey}
        panelContent={panelContent}
        onPanelClose={handlePanelClose}
        isVersionsPanel={isDocumentVersionsPanelRoute(panelRoute)}
        filterEventType={panelRoute?.key === 'activity' ? panelRoute.filterEventType : undefined}
        onFilterChange={handleFilterChange}
      >
        <GotoLatestBanner isLatest={isLatest} id={docId} document={document} />
        {/* Floating action buttons — when editing, show editing toolbar;
            when a draft exists but not editing, show draft toolbar (publish + menu);
            otherwise show the options menu */}
        {documentContentActionOverlay}
        <ScrollArea
          id="scroll-page-wrapper"
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
  version,
}: {
  docId: UnpackedHypermediaId
  docMetadata: HMDocument['metadata']
  authors: AuthorPayload[]
  updateTime: HMDocument['updateTime']
  breadcrumbs?: BreadcrumbEntry[]
  visibility?: string
  version?: HMDocument['version'] | null
}) {
  const ctx = useDocumentSelector(selectContext)
  const isEditing = useDocumentSelector(selectIsEditing)
  const send = useDocumentSend()
  const inputName = useRef<HTMLTextAreaElement | null>(null)
  const inputSummary = useRef<HTMLTextAreaElement | null>(null)

  // Use machine context metadata if it has been changed, otherwise fall back to document metadata
  const name = ctx.metadata?.name ?? docMetadata?.name ?? ''
  const summary = ctx.metadata?.summary ?? docMetadata?.summary ?? ''

  // Reflow both textareas. Runs the resize immediately, on the next animation
  // frame (after React commits paint), and once fonts have loaded — reading
  // `scrollHeight` before fonts settle or before the parent has its final
  // width produces a stale height that sticks until the next window resize,
  // which is why opening DevTools (a window resize) "fixes" the layout.
  const reflowBoth = useCallback(() => {
    const doResize = () => {
      if (inputName.current) applyTitleResize(inputName.current)
      if (inputSummary.current) applyTitleResize(inputSummary.current)
    }
    doResize()
    requestAnimationFrame(doResize)
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      ;(document as any).fonts.ready.then(doResize).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const target = inputName.current
    if (!target) return
    if (target.value !== name) {
      target.value = name || ''
    }
    applyTitleResize(target)
    requestAnimationFrame(() => {
      if (inputName.current) applyTitleResize(inputName.current)
    })
  }, [name])

  useEffect(() => {
    const target = inputSummary.current
    if (!target) return
    if (target.value !== summary) {
      target.value = summary || ''
    }
    applyTitleResize(target)
    requestAnimationFrame(() => {
      if (inputSummary.current) applyTitleResize(inputSummary.current)
    })
  }, [summary])

  useEffect(() => {
    reflowBoth()
    window.addEventListener('resize', reflowBoth)

    // Watch the parent container so any width change (panel open/close,
    // content re-layout after publish, scrollbar appearing) re-reflows the
    // textareas without waiting for a window resize.
    const parent = inputName.current?.parentElement
    let observer: ResizeObserver | null = null
    if (parent && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => reflowBoth())
      observer.observe(parent)
    }

    return () => {
      window.removeEventListener('resize', reflowBoth)
      observer?.disconnect()
    }
  }, [reflowBoth])

  return (
    <DocumentHeader
      docId={docId}
      docMetadata={docMetadata}
      authors={authors}
      updateTime={updateTime}
      breadcrumbs={breadcrumbs}
      visibility={visibility as any}
      version={version}
      showTitle={false}
    >
      <textarea
        ref={inputName}
        rows={1}
        className="w-full resize-none border-none border-transparent bg-transparent text-4xl font-bold shadow-none ring-0 ring-transparent outline-none focus:ring-0"
        defaultValue={name}
        onFocus={() => {
          if (!isEditing) send({type: 'edit.start'})
        }}
        onChange={(e) => {
          applyTitleResize(e.target)
          send({type: 'change', metadata: {name: e.target.value}})
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && isEditing) {
            e.currentTarget.blur()
            send({type: 'edit.cancel'})
          }
        }}
        placeholder="Document Title"
      />
      <textarea
        ref={inputSummary}
        rows={1}
        className="text-muted-foreground w-full resize-none border-none border-transparent bg-transparent font-serif text-xl font-normal shadow-none ring-0 ring-transparent outline-none focus:ring-0"
        defaultValue={summary}
        onFocus={() => {
          if (!isEditing) send({type: 'edit.start'})
        }}
        onChange={(e) => {
          applyTitleResize(e.target)
          send({type: 'change', metadata: {summary: e.target.value}})
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && isEditing) {
            e.currentTarget.blur()
            send({type: 'edit.cancel'})
          }
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
  fileUpload,
  draftVersionEntry,
}: {
  panelRoute: DocumentPanelRoute
  docId: UnpackedHypermediaId
  contentMaxWidth: number
  CommentEditor?: React.ComponentType<CommentEditorProps>
  siteUrl?: string
  fileUpload?: (file: File) => Promise<string>
  draftVersionEntry?: DraftVersionEntry
}) {
  switch (panelRoute.key) {
    case 'options':
      return <DocumentOptionsPanel docId={docId} fileUpload={fileUpload} />
    case 'activity':
      if (isDocumentVersionsPanelRoute(panelRoute)) {
        return (
          <DocumentVersionsPanel size="sm" docId={docId} targetDomain={siteUrl} draftVersionEntry={draftVersionEntry} />
        )
      }
      return (
        <Feed
          size="sm"
          filterResource={docId.id}
          filterEventType={panelRoute.filterEventType}
          targetDomain={siteUrl}
          draftVersionEntry={draftVersionEntry}
        />
      )
    case 'comments':
      return (
        <CommentsPanelContent
          docId={docId}
          panelRoute={panelRoute}
          contentMaxWidth={contentMaxWidth}
          targetDomain={siteUrl}
          CommentEditor={CommentEditor}
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

function CommentsPanelContent({
  docId,
  panelRoute,
  contentMaxWidth,
  targetDomain,
  CommentEditor,
}: {
  docId: UnpackedHypermediaId
  panelRoute: Extract<DocumentPanelRoute, {key: 'comments'}>
  contentMaxWidth: number
  targetDomain?: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
}) {
  const commentsContext = useCommentsServiceContext()
  const route = useNavRoute()
  const replaceRoute = useNavigate('replace')

  const onReplyClick = useCallback(
    (comment: HMComment) => {
      if (!('panel' in route)) return
      replaceRoute({
        ...route,
        panel: getCommentReplyPanelRoute({
          docId,
          comment,
          isReplying: true,
        }),
      } as NavRoute)
    },
    [docId, replaceRoute, route],
  )

  const onReplyCountClick = useCallback(
    (comment: HMComment) => {
      if (!('panel' in route)) return
      replaceRoute({
        ...route,
        panel: getCommentReplyPanelRoute({
          docId,
          comment,
        }),
      } as NavRoute)
    },
    [docId, replaceRoute, route],
  )

  return (
    <CommentsProvider {...commentsContext} onReplyClick={onReplyClick} onReplyCountClick={onReplyCountClick}>
      <DiscussionsPageContent
        docId={docId}
        showTitle={false}
        showOpenInPanel={false}
        contentMaxWidth={contentMaxWidth}
        targetDomain={targetDomain}
        openComment={panelRoute.openComment}
        targetBlockId={panelRoute.targetBlockId}
        blockId={panelRoute.blockId}
        blockRange={panelRoute.blockRange}
        commentEditor={
          CommentEditor ? (
            <CommentEditor
              key={getCommentEditorRouteKey({
                openComment: panelRoute.openComment,
                targetBlockId: panelRoute.targetBlockId,
                blockRange: panelRoute.blockRange,
              })}
              docId={docId}
              quotingBlockId={panelRoute.targetBlockId}
              quotingRange={extractQuotingRange(panelRoute.blockRange)}
              commentId={panelRoute.openComment}
              isReplying={panelRoute.isReplying ?? !!panelRoute.openComment}
              replyCommentVersion={panelRoute.replyCommentVersion}
              rootReplyCommentVersion={panelRoute.rootReplyCommentVersion}
              focusOnMount
            />
          ) : undefined
        }
      />
    </CommentsProvider>
  )
}

function DocumentOptionsPanel({
  docId,
  fileUpload,
}: {
  docId: UnpackedHypermediaId
  fileUpload?: (file: File) => Promise<string>
}) {
  const ctx = useDocumentSelector(selectContext)
  const send = useDocumentSend()
  const {beginEditIfNeeded} = useEditorGate()
  const isHomeDoc = !docId.path?.length

  const metadata = {...(ctx.document?.metadata || {}), ...ctx.metadata}
  // draftId may not exist yet when the panel is opened in read mode. Fall back
  // to docId.id so form field HTML ids remain stable and unique.
  const formId = ctx.draftId ?? docId.id

  return (
    <OptionsPanel
      draftId={formId}
      metadata={metadata as any}
      isHomeDoc={isHomeDoc}
      fileUpload={fileUpload}
      onMetadata={(newMetadata) => {
        if (!newMetadata) return
        beginEditIfNeeded()
        send({type: 'change', metadata: newMetadata})
      }}
    />
  )
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
  suppressCommentEditor,
  activityFilterEventType,
  onActivityFilterChange,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  onTextSelection,
  isUnpublishedDraft,
  isBlockInPublishedVersion,
  CommentEditor,
  directory,
  siteUrl,
  inlineCards,
  inlineInsert,
  DocumentContentComponent,
  onEditorReady,
  existingDraftContent,
  existingDraftCursorPosition,
  ssrContentHTML,
  perspectiveAccountUid,
  linkExtensionOptions,
  fileUpload,
  draftVersionEntry,
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
  suppressCommentEditor?: boolean
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
  onTextSelection?: () => void
  isUnpublishedDraft?: boolean
  isBlockInPublishedVersion?: (blockId: string) => boolean
  CommentEditor?: React.ComponentType<CommentEditorProps>
  directory?: import('@seed-hypermedia/client/hm-types').HMDocumentInfo[]
  siteUrl?: string
  inlineCards?: ReactNode
  inlineInsert?: ReactNode
  DocumentContentComponent?: React.ComponentType<DocumentContentProps>
  onEditorReady?: (editor: any) => void
  existingDraftContent?: HMBlockNode[]
  existingDraftCursorPosition?: number
  ssrContentHTML?: string | null
  perspectiveAccountUid?: string | null
  linkExtensionOptions?: LinkExtensionOptions
  fileUpload?: (file: File) => Promise<string>
  draftVersionEntry?: DraftVersionEntry
}) {
  const {openRouteNewWindow, originHomeId} = useUniversalAppContext()
  const navigate = useNavigate()
  const allDocumentsSiteId = !IS_DESKTOP && originHomeId ? hmId(originHomeId.uid) : hmId(docId.uid)

  switch (activeView) {
    case 'all-documents':
      return (
        <AllDocumentsPage
          siteId={allDocumentsSiteId}
          scopeId={allDocumentsSiteId}
          onNavigateToDocument={(id, opts) => {
            const route = {key: 'document' as const, id}
            if (opts?.newWindow) {
              if (openRouteNewWindow) {
                openRouteNewWindow(route)
              } else {
                const href = routeToHref(route, {originHomeId})
                if (href) window.open(href, '_blank')
              }
              return
            }
            navigate(route)
          }}
        />
      )

    case 'directory':
      return <DirectoryPageContent docId={docId} showTitle contentMaxWidth={contentMaxWidth} />

    case 'collaborators':
      return (
        <PageLayout contentMaxWidth={contentMaxWidth}>
          <CollaboratorsPage docId={docId} />
        </PageLayout>
      )

    case 'activity':
      if (activityFilterToSlug(activityFilterEventType) === 'versions') {
        return (
          <PageLayout contentMaxWidth={contentMaxWidth}>
            <DocumentVersionsPanel
              size="md"
              docId={docId}
              targetDomain={siteUrl}
              draftVersionEntry={draftVersionEntry}
            />
          </PageLayout>
        )
      }
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
            draftVersionEntry={draftVersionEntry}
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
            CommentEditor && !suppressCommentEditor ? (
              <CommentEditor
                key={getCommentEditorRouteKey({
                  openComment: discussionsParams?.openComment,
                  targetBlockId: discussionsParams?.targetBlockId,
                  blockRange: discussionsParams?.blockRange,
                })}
                docId={docId}
                quotingBlockId={discussionsParams?.targetBlockId}
                quotingRange={extractQuotingRange(discussionsParams?.blockRange)}
                commentId={discussionsParams?.openComment}
                isReplying={discussionsParams?.isReplying ?? !!discussionsParams?.openComment}
                replyCommentVersion={discussionsParams?.replyCommentVersion}
                rootReplyCommentVersion={discussionsParams?.rootReplyCommentVersion}
                focusOnMount={discussionsParams?.autoFocus}
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
          onTextSelection={onTextSelection}
          isUnpublishedDraft={isUnpublishedDraft}
          isBlockInPublishedVersion={isBlockInPublishedVersion}
          directory={directory}
          inlineCards={inlineCards}
          inlineInsert={inlineInsert}
          DocumentContentComponent={DocumentContentComponent}
          onEditorReady={onEditorReady}
          existingDraftContent={existingDraftContent}
          existingDraftCursorPosition={existingDraftCursorPosition}
          ssrContentHTML={ssrContentHTML}
          perspectiveAccountUid={perspectiveAccountUid}
          linkExtensionOptions={linkExtensionOptions}
          fileUpload={fileUpload}
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
  onTextSelection,
  isUnpublishedDraft,
  isBlockInPublishedVersion,
  directory,
  inlineCards,
  inlineInsert,
  DocumentContentComponent,
  onEditorReady,
  existingDraftContent,
  existingDraftCursorPosition,
  ssrContentHTML,
  perspectiveAccountUid,
  linkExtensionOptions,
  fileUpload,
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
  onTextSelection?: () => void
  isUnpublishedDraft?: boolean
  isBlockInPublishedVersion?: (blockId: string) => boolean
  directory?: import('@seed-hypermedia/client/hm-types').HMDocumentInfo[]
  inlineCards?: ReactNode
  inlineInsert?: ReactNode
  DocumentContentComponent?: React.ComponentType<DocumentContentProps>
  onEditorReady?: (editor: any) => void
  existingDraftContent?: HMBlockNode[]
  existingDraftCursorPosition?: number
  ssrContentHTML?: string | null
  perspectiveAccountUid?: string | null
  linkExtensionOptions?: LinkExtensionOptions
  fileUpload?: (file: File) => Promise<string>
}) {
  const ctx = useDocumentSelector(selectContext)
  const rootChildrenType = (ctx.metadata?.childrenType ?? document.metadata?.childrenType) || 'Group'
  const publishedOutline = useNodesOutline(document, docId)
  const draftOutline = useMemo(
    () => (existingDraftContent ? getDraftNodesOutline(existingDraftContent, docId) : null),
    [existingDraftContent, docId],
  )
  const outline = draftOutline ?? publishedOutline
  const handleFileAttachment = useMemo<DocumentContentProps['handleFileAttachment'] | undefined>(() => {
    if (!fileUpload) return undefined
    return async (file: File) => {
      const cid = await fileUpload(file)
      return {
        url: cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`,
        displaySrc: '',
      }
    }
  }, [fileUpload])

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
                  activeBlockId={resourceId.blockRef}
                />
              </DocNavigationWrapper>
            </div>
          )}
        </div>
      )}

      <div {...mainContentProps} className={cn(mainContentProps.className, 'px-4 pt-8')}>
        {DocumentContentComponent ? (
          <DocumentContentComponent
            blocks={existingDraftContent ?? document.content}
            resourceId={resourceId}
            rootChildrenType={rootChildrenType}
            focusBlockId={resourceId.blockRef ?? undefined}
            focusBlockRange={resourceId.blockRange ?? undefined}
            blockCitations={blockCitations}
            onBlockCitationClick={onBlockCitationClick}
            onBlockCommentClick={onBlockCommentClick}
            onBlockSelect={onBlockSelect}
            onTextSelection={onTextSelection}
            onEditorReady={onEditorReady}
            draftCursorPosition={existingDraftCursorPosition}
            perspectiveAccountUid={perspectiveAccountUid}
            linkExtensionOptions={linkExtensionOptions}
            isUnpublishedDraft={isUnpublishedDraft}
            isBlockInPublishedVersion={isBlockInPublishedVersion}
            handleFileAttachment={handleFileAttachment}
          />
        ) : ssrContentHTML ? (
          <div dangerouslySetInnerHTML={{__html: ssrContentHTML}} />
        ) : null}
        {inlineInsert}
        {inlineCards}
        <UnreferencedDocuments
          docId={docId}
          content={document.content}
          draftContent={existingDraftContent}
          directory={directory}
        />
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
/** Profile discovery can take much longer than normal entity discovery (sync, etc). */
const PROFILE_DISCOVERY_TIMEOUT_MS = 5 * 60 * 1000

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
  // Subscribe to trigger background discovery/sync and track discovery state
  const profileResource = useResource(profileId, {subscribed: true, recursive: true})
  const account = useAccount(accountUid)

  // Track when we started looking so we can keep showing discovery UI
  // beyond the short global discovery timeout. Periodically refetch the
  // account query while waiting — data may arrive from sync at any point.
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const hasData = !!account.data
  useEffect(() => {
    if (hasData) return
    const id = setInterval(() => {
      setNow(Date.now())
      account.refetch()
    }, 5_000)
    return () => clearInterval(id)
  }, [hasData, account.refetch])
  const elapsed = now - mountedAt
  const stillLooking = !hasData && elapsed < PROFILE_DISCOVERY_TIMEOUT_MS

  if (!hasData && (account.isLoading || profileResource.isDiscovering || stillLooking)) {
    return (
      <>
        <PageDiscovery entityType="profile" />
        {pageFooter}
      </>
    )
  }

  if (account.data) {
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

  return (
    <>
      <PageNotFound entityType="profile" />
      {pageFooter}
    </>
  )
}
