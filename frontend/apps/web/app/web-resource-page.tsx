import {HMDocument, HMExistingDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useJoinSite, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {CommentsProvider, InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
import {canCreateChildDocuments} from '@shm/shared/document-utils'
import {type EditorAccessor} from '@shm/shared/models/document-machine'
import {selectContext, useDocumentMachineRef} from '@shm/shared/models/use-document-machine'
import {useResource} from '@shm/shared/models/entity'
import {QueryBlockDraftsProvider} from '@shm/shared/query-block-drafts-context'
import {replaceRouteDocumentId} from '@shm/shared/routes'
import {getDraftPlaceholderParentId} from '@shm/shared/utils/breadcrumbs'
import {useCommentNavigation} from '@shm/shared/utils/comment-navigation'
import type {DocumentCardActionOrigin} from '@shm/shared/utils/document-actions'
import {createWebHMUrl, latestId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {pathNameify} from '@shm/shared/utils/path'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {computeInlineDraftPublishPath} from '@shm/shared/utils/publish-paths'
import {getDraftReturnParentId, isReservedLazyDraftId} from '@shm/shared/utils/reserved-draft-ids'
import {createDocumentVersionsPanelRoute} from '@shm/ui/document-versions-panel'
import {EditingDocToolsRight, type EditingToolbarCallbacks} from '@shm/ui/editing-toolbar'
import {Trash} from '@shm/ui/icons'
import {InlineSubscribeBox} from '@shm/ui/inline-subscribe-box'
import {InspectorPage} from '@shm/ui/inspector-page'
import type {MenuItemType} from '@shm/ui/options-dropdown'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useQuery} from '@tanstack/react-query'
import {FileInput} from 'lucide-react'
import {Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {EditProfileDialog, LogoutButton, useCreateAccount, useLocalKeyPair, useVaultSuccessDialog} from './auth'
import {preloadCommenting} from './client-lazy'
import {useWebCanEdit} from './document-edit/use-web-can-edit'
import {createWebDocumentMachine} from './document-edit/web-document-actors'
import {
  loadWebCleanupDraft,
  startWebDocumentCardCleanupCoordinator,
  subscribeWebDraftExternallyModified,
} from './document-edit/web-document-card-cleanup'
import {WebDraftActionsProvider} from './document-edit/web-draft-actions-provider'
import {WebDraftBreadcrumbProvider} from './document-edit/web-draft-breadcrumb-provider'
import {cleanupOldWebDocDrafts, getLatestWebDocDraftForDoc, getWebDocDraft} from './document-edit/web-draft-db'
import {getWebDraftShellId, shouldUseLocalWebDraftShell} from './document-edit/web-draft-shell'
import {makeWebFileUpload} from './document-edit/web-image-upload'
import {WebQueryBlockDraftSlot} from './document-edit/web-query-block-draft-slot'
import {restoreWebDocumentVersion} from './document-edit/web-restore-document-version'
import {setPendingIntent} from './local-db'
import {PageFooter} from './page-footer'
import {processPendingIntent} from './pending-intent'
import {useWebDeleteDocumentDialog} from './web-delete-document-dialog'
import {useWebDocumentDestinationDialog} from './web-move-document-dialog'
import {WebHeaderActions, WebSitePageShell, useWebCreateDocumentMenuItem, useWebMenuItems} from './web-utils'

/** Lazy-loaded inline comment editor — avoids pulling the full editor bundle eagerly. */
const LazyWebInlineEditor = lazy(() => import('./commenting').then((mod) => ({default: mod.WebInlineEditBox})))

/** Renders the inline editor for web comment editing, lazy-loaded. */
function renderWebInlineEditor(props: InlineEditCommentProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <LazyWebInlineEditor {...props} />
    </Suspense>
  )
}

function WebDraftExternalModificationListener() {
  const actorRef = useDocumentMachineRef()

  useEffect(() => {
    return subscribeWebDraftExternallyModified(async (event) => {
      const context = selectContext(actorRef.getSnapshot())
      if (event.source !== 'document-card-cleanup' || event.draftId !== context.draftId) return
      const draft = await loadWebCleanupDraft(event.draftId)
      actorRef.send({
        type: 'draft.externallyModified',
        draftId: event.draftId,
        source: event.source,
        deletedDocumentId: event.deletedDocumentId || event.sourceDocumentId,
        removedBlockIds: event.changedBlockIds,
        content: draft?.content ?? null,
        cursorPosition: draft?.cursorPosition ?? null,
        metadata: draft?.metadata ?? null,
        deps: draft?.deps ?? null,
      })
    })
  }, [actorRef])

  return null
}

export interface WebResourcePageProps {
  docId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
  ssrContentHTML?: string | null
}

/**
 * Web-specific wrapper for ResourcePage that handles:
 * - HypermediaHostBanner (shown when viewing content from a different site)
 * - Account button with login/create account flow
 */
// Client-only wrapper: DocumentEditor uses BlockNoteView which requires
// window.matchMedia (DOM API unavailable during SSR).
function useClientDocumentEditor(): React.ComponentType<DocumentContentProps> | undefined {
  const [Component, setComponent] = useState<React.ComponentType<DocumentContentProps> | undefined>(undefined)
  useEffect(() => {
    import('@shm/editor/document-editor').then((mod) => {
      setComponent(() => mod.DocumentEditor)
    })
  }, [])
  return Component
}

export function WebResourcePage({docId, CommentEditor, ssrContentHTML}: WebResourcePageProps) {
  const DocumentContentComponent = useClientDocumentEditor()
  const {origin, originHomeId} = useUniversalAppContext()
  const route = useNavRoute()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')
  const userKeyPair = useLocalKeyPair()
  const editProfileDialog = useAppDialog(EditProfileDialog)
  const vaultSuccessContent = useVaultSuccessDialog()
  const universalClient = useUniversalClient()
  const linkExtensionOptions = useMemo(() => ({universalClient}), [universalClient])
  const {canEdit, signingAccountId, capability} = useWebCanEdit(docId)
  const fileUpload = useMemo(() => makeWebFileUpload(universalClient), [universalClient])

  // Editor accessor — populated by the editor's onEditorReady callback.
  const editorRef = useRef<any>(null)
  const editorAccessor = useMemo<EditorAccessor>(
    () => ({
      getTopLevelBlocks: () => editorRef.current?.topLevelBlocks ?? null,
      getCursorPosition: () => editorRef.current?._tiptapEditor?.view?.state?.selection?.$anchor?.pos ?? null,
    }),
    [],
  )
  const onEditorReady = useCallback((editor: any) => {
    editorRef.current = editor
  }, [])

  // Post-publish: navigate to latest version so user sees published content
  const replaceRouteRef = useRef(replaceRoute)
  replaceRouteRef.current = replaceRoute
  const routeRef = useRef(route)
  routeRef.current = route
  const onPublishSuccess = useCallback((newDocument?: {account?: string; path?: string | null}) => {
    const currentRoute = routeRef.current
    if (currentRoute.key === 'document') {
      const currentId = (currentRoute as any).id as UnpackedHypermediaId | undefined
      if (newDocument?.account) {
        const publishedId = hmId(newDocument.account, {
          path: entityQueryPathToHmIdPath(newDocument.path),
          latest: true,
        })
        if (currentId && publishedId.id !== currentId.id) {
          replaceRouteRef.current({...currentRoute, id: publishedId} as any)
          return
        }
      }
      if (currentId?.version) {
        replaceRouteRef.current({
          ...currentRoute,
          id: {...currentId, version: null},
        } as any)
      }
    } else if (currentRoute.key === 'site-profile') {
      const currentId = (currentRoute as any).id as UnpackedHypermediaId | undefined
      if (currentId?.version) {
        replaceRouteRef.current({
          ...currentRoute,
          id: {...currentId, version: null},
        } as any)
      }
    }
  }, [])

  const placeholderDraftId = useMemo(() => getWebDraftShellId(docId.path), [docId.path])

  // Load any local IDB draft for this doc. Placeholder draft URLs must load by
  // exact draft id instead of asking the backend for the nonexistent document.
  const draftQuery = useQuery({
    queryKey: ['web-doc-draft', docId.id, signingAccountId ?? null, placeholderDraftId ?? null] as const,
    queryFn: async () => {
      if (!signingAccountId) return null
      if (placeholderDraftId) {
        const draft = await getWebDocDraft(placeholderDraftId)
        if (draft?.docId !== docId.id) return null
        if (draft.signingAccountId !== signingAccountId) return null
        return draft
      }
      if (!canEdit) return null
      return getLatestWebDocDraftForDoc(docId.id)
    },
    enabled: typeof window !== 'undefined' && !!signingAccountId && (canEdit || !!placeholderDraftId),
    staleTime: 60_000,
    keepPreviousData: false,
  })
  // Keep local drafts even when their base is no longer latest. Remote updates
  // are handled by the document machine's queued rebase flow; deleting here can
  // destroy a valid in-progress draft when the user is merely viewing a pinned
  // historical version.
  const loadedDraftData = draftQuery.data
  const draftData =
    loadedDraftData &&
    (placeholderDraftId
      ? loadedDraftData.draftId === placeholderDraftId && loadedDraftData.docId === docId.id
      : loadedDraftData.docId === docId.id)
      ? loadedDraftData
      : null
  const isDraftStale = false

  const canEditLocalPlaceholderDraft =
    !!placeholderDraftId && !!draftData && !!signingAccountId && draftData.signingAccountId === signingAccountId
  const effectiveCanEdit = canEdit || canEditLocalPlaceholderDraft || (!!placeholderDraftId && !!signingAccountId)
  const effectiveCapabilityCid = capability && capability.id !== '_owner' ? capability.id : draftData?.capabilityCid

  // Build a documentMachine wired to web actors. Stable per (docId, signing identity, capability).
  const machine = useMemo(() => {
    return createWebDocumentMachine({
      docId,
      getEditor: () => editorAccessor,
      client: universalClient,
      getSigner: (accountUid: string) => {
        if (!universalClient.getSigner) {
          throw new Error('Universal client does not provide a signer; cannot publish from web')
        }
        return universalClient.getSigner(accountUid)
      },
      getCapabilityCid: () => effectiveCapabilityCid,
      onPublishSuccess,
    })
  }, [docId.id, universalClient, editorAccessor, effectiveCapabilityCid, onPublishSuccess])

  useEffect(() => {
    if (typeof window === 'undefined') return
    startWebDocumentCardCleanupCoordinator({client: universalClient})
  }, [universalClient])

  const existingDraft: HMExistingDraft | false | undefined = useMemo(() => {
    if (!effectiveCanEdit) return false
    if (draftQuery.isLoading) return undefined
    const d = draftData
    if (!d || isDraftStale) return false
    return {id: d.draftId, metadata: d.metadata as HMExistingDraft['metadata']}
  }, [effectiveCanEdit, draftQuery.isLoading, draftData, isDraftStale])
  const reservedDraftId =
    placeholderDraftId && !draftData && isReservedLazyDraftId(placeholderDraftId) ? placeholderDraftId : null
  const useLocalDraftShell = shouldUseLocalWebDraftShell({
    placeholderDraftId,
    isDraftLoading: draftQuery.isInitialLoading || draftQuery.isFetching,
    hasDraft: !!draftData && !isDraftStale,
    isReservedDraft: !!reservedDraftId,
  })
  const existingDraftContent = isDraftStale ? undefined : draftData?.content ?? undefined
  const existingDraftCursorPosition = isDraftStale ? undefined : draftData?.cursorPosition ?? undefined

  // Garbage-collect old IDB drafts once per session.
  useEffect(() => {
    cleanupOldWebDocDrafts().catch((err) => console.warn('cleanupOldWebDocDrafts failed', err))
  }, [])

  // Determine if viewing own profile on site-profile page
  const isSiteProfile = route.key === 'site-profile'
  const profileAccountUid = isSiteProfile ? route.accountUid || docId.uid : null
  const ownAccountUid = userKeyPair?.delegatedAccountUid ?? userKeyPair?.id
  const isOwnProfile = isSiteProfile && !!userKeyPair && profileAccountUid === ownAccountUid
  const isDelegated = !!userKeyPair?.delegatedAccountUid

  // Profile edit callback - only for non-delegated own profile
  const onEditProfile = useMemo(() => {
    if (!isOwnProfile || isDelegated || !profileAccountUid) return undefined
    return () => editProfileDialog.open({accountUid: profileAccountUid})
  }, [isOwnProfile, isDelegated, profileAccountUid, editProfileDialog])

  // Profile header buttons (vault account settings + logout) - only for own profile
  const profileHeaderButtons = useMemo(() => {
    if (!isOwnProfile) return undefined
    return <LogoutButton />
  }, [isOwnProfile])

  // Follow intent flow for unauthenticated users
  const {content: followAccountContent, createAccount: openFollowAccountDialog} = useCreateAccount({
    onClose: () => {
      processPendingIntent(originHomeId ?? undefined)
    },
  })

  const onFollowClick = useMemo(() => {
    if (userKeyPair) return undefined
    if (!isSiteProfile || !profileAccountUid) return undefined
    return async () => {
      await setPendingIntent({type: 'follow', profileUid: profileAccountUid})
      openFollowAccountDialog()
    }
  }, [userKeyPair, isSiteProfile, profileAccountUid, openFollowAccountDialog])

  // Preload the comment editor chunk on first hover over any Comments-related element
  const preloaded = useRef(false)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (preloaded.current) return
      const target = e.target as HTMLElement
      if (target.closest?.('[data-tab="comments"]')) {
        preloaded.current = true
        preloadCommenting()
      }
    }
    document.addEventListener('mouseover', handler, {passive: true})
    return () => document.removeEventListener('mouseover', handler)
  }, [])

  // Shared toolbar callbacks for web
  const webToolbarCallbacks: EditingToolbarCallbacks = useMemo(
    () => ({
      getDocumentUrl: (id: UnpackedHypermediaId) =>
        createWebHMUrl(id.uid, {
          path: id.path,
          hostname: origin || null,
          originHomeId: originHomeId ?? undefined,
        }),
      onDiscardConfirm: (discardDraftId: string, send) => {
        if (window.confirm('Discard draft changes?')) {
          send({type: 'edit.discard'})
          const parentId = getDraftPlaceholderParentId(docId, discardDraftId) ?? getDraftReturnParentId(discardDraftId)
          if (parentId) {
            replaceRoute({
              ...(route.key === 'document' ? route : {key: 'document'}),
              id: parentId,
            } as any)
          }
          toast.success('Draft changes discarded')
        }
      },
      slugify: pathNameify,
      computeFirstPublishPath: computeInlineDraftPublishPath,
      onGoToVersions: (id: UnpackedHypermediaId) => {
        navigate({
          key: 'document',
          id,
          panel: createDocumentVersionsPanelRoute(id),
        } as any)
      },
    }),
    [origin, originHomeId, navigate, replaceRoute, docId, route],
  )

  const showPublishToolbar = route.key === 'document' || route.key === 'metadata'

  const editingFloatingActions =
    effectiveCanEdit && showPublishToolbar
      ? ({menuItems}: {menuItems: any[]}) => (
          <EditingDocToolsRight docId={docId} existingMenuItems={menuItems} {...webToolbarCallbacks} />
        )
      : undefined

  const siteUid = docId.uid
  const currentResource = useResource(useLocalDraftShell ? undefined : docId)
  const currentDocument = currentResource.data?.type === 'document' ? currentResource.data.document : undefined
  const canCreateChildDocs = canCreateChildDocuments(currentDocument?.visibility, draftData?.visibility)
  const {menuItem: newMenuItem, content: newMenuContent} = useWebCreateDocumentMenuItem({
    locationId: docId,
    signingAccountId: signingAccountId ?? undefined,
    canCreate: effectiveCanEdit && !!signingAccountId,
    canCreateChildren: canCreateChildDocs,
    capabilityCid: effectiveCapabilityCid,
  })
  const webMenuItems = useWebMenuItems(docId, {includeInspect: false})
  const deleteCapabilityId = capability && capability.id !== '_owner' ? capability.id : undefined
  const deleteDialog = useWebDeleteDocumentDialog({
    signingAccountId: signingAccountId ?? undefined,
    capabilityId: deleteCapabilityId,
    canDelete: effectiveCanEdit,
  })
  const destinationDialog = useWebDocumentDestinationDialog({
    signingAccountId: signingAccountId ?? undefined,
    capabilityId: deleteCapabilityId,
    writableLocationId: capability?.id === '_owner' ? hmId(docId.uid) : capability?.grantId,
    canMove: !!signingAccountId,
  })
  const onDeleteDocument = useCallback(
    (id: UnpackedHypermediaId, onSuccess?: () => void) => {
      deleteDialog.open({id, onSuccess})
    },
    [deleteDialog],
  )
  const onMoveDocument = useMemo(() => {
    if (!signingAccountId) return undefined
    return (id: UnpackedHypermediaId, origin?: DocumentCardActionOrigin) =>
      destinationDialog.open({id, mode: 'move', origin})
  }, [destinationDialog, signingAccountId])
  const canWriteDocument = useCallback(
    (id: UnpackedHypermediaId) =>
      !!signingAccountId && (id.uid === signingAccountId || (effectiveCanEdit && id.uid === docId.uid)),
    [docId.uid, effectiveCanEdit, signingAccountId],
  )
  const moveMenuItem = useMemo<MenuItemType | null>(() => {
    if (!effectiveCanEdit || !signingAccountId || !docId.path?.length) return null
    return {
      key: 'move',
      label: 'Move',
      icon: <FileInput className="size-4" />,
      onClick: () => destinationDialog.open({id: docId, mode: 'move'}),
    }
  }, [destinationDialog, docId, effectiveCanEdit, signingAccountId])
  const deleteMenuItem = useMemo<MenuItemType | null>(() => {
    if (!effectiveCanEdit || !signingAccountId || !docId.path?.length) return null
    return {
      key: 'delete',
      label: 'Delete Document',
      icon: <Trash className="size-4" />,
      variant: 'destructive',
      onClick: () => {
        onDeleteDocument(docId, () => {
          replaceRoute({
            key: 'document',
            id: hmId(docId.uid, {path: docId.path?.slice(0, -1)}),
          } as any)
        })
      },
    }
  }, [docId, effectiveCanEdit, onDeleteDocument, replaceRoute, signingAccountId])
  const optionsMenuItems = useMemo(
    () => [newMenuItem, ...webMenuItems, moveMenuItem, deleteMenuItem].filter(Boolean) as MenuItemType[],
    [deleteMenuItem, moveMenuItem, newMenuItem, webMenuItems],
  )

  // Inline subscribe box for non-members
  const {isJoined} = useJoinSite({siteUid})
  const siteResource = useResource(docId.path?.length ? undefined : docId)
  const siteMetadata = siteResource.data?.type === 'document' ? siteResource.data.document?.metadata : undefined
  const showSubscribeBox = !userKeyPair || !isJoined
  const inlineInsert = useMemo(() => {
    if (!showSubscribeBox || !NOTIFY_SERVICE_HOST) return undefined
    return (
      <InlineSubscribeBox
        accountId={siteUid}
        notifyServiceHost={NOTIFY_SERVICE_HOST}
        accountMeta={siteMetadata ?? undefined}
      />
    )
  }, [showSubscribeBox, siteUid, siteMetadata])

  const {onReplyClick, onReplyCountClick} = useCommentNavigation({
    docId,
    route,
    navigate,
    replaceRoute,
  })

  const onRestoreDocumentVersion = useCallback(
    async (id: UnpackedHypermediaId, selectedVersion: HMDocument) => {
      if (!effectiveCanEdit || !signingAccountId) {
        toast.error('You do not have permission to restore this document')
        return
      }
      if (!universalClient.getSigner) {
        toast.error('Restore is not available in this client')
        return
      }

      try {
        await restoreWebDocumentVersion(
          {
            targetId: id,
            selectedVersion,
            signerAccountUid: signingAccountId,
            capabilityCid: effectiveCapabilityCid,
          },
          {
            client: universalClient,
            getSigner: (accountUid) => universalClient.getSigner!(accountUid),
          },
        )
        replaceRouteRef.current(replaceRouteDocumentId(route, latestId(id)))
        toast.success('Document restored successfully')
      } catch (error) {
        console.error('Failed to restore document version:', error)
        toast.error(error instanceof Error ? error.message : 'Failed to restore document version')
        throw error
      }
    },
    [effectiveCanEdit, effectiveCapabilityCid, route, signingAccountId, universalClient],
  )

  const [lastCreatedDraftId, setLastCreatedDraftId] = useState<string | null>(null)
  const canCreateInlineDraft = !useLocalDraftShell && canCreateChildDocs

  return (
    <WebSitePageShell siteUid={docId.uid}>
      <CommentsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
        renderInlineEditor={renderWebInlineEditor}
      >
        <DocumentActionsProvider
          onCopyLink={() => {}}
          selectedAccountUid={signingAccountId ?? undefined}
          myAccountIds={signingAccountId ? [signingAccountId] : []}
          canWriteDocument={canWriteDocument}
          onMoveDocument={onMoveDocument}
          onDeleteDocument={onDeleteDocument}
          onRestoreDocumentVersion={effectiveCanEdit && signingAccountId ? onRestoreDocumentVersion : undefined}
        >
          <WebDraftActionsProvider
            canCreateInlineDraft={canCreateInlineDraft}
            signingAccountId={signingAccountId ?? undefined}
            capabilityCid={effectiveCapabilityCid}
          >
            <QueryBlockDraftsProvider
              DraftSlot={WebQueryBlockDraftSlot}
              lastCreatedDraftId={lastCreatedDraftId}
              setLastCreatedDraftId={setLastCreatedDraftId}
            >
              <WebDraftBreadcrumbProvider>
                <ResourcePage
                  docId={docId}
                  resourceId={useLocalDraftShell ? null : docId}
                  CommentEditor={CommentEditor}
                  pageFooter={<PageFooter id={docId} />}
                  onEditProfile={onEditProfile}
                  profileHeaderButtons={profileHeaderButtons}
                  onFollowClick={onFollowClick}
                  rightActions={<WebHeaderActions siteUid={docId.uid} />}
                  optionsMenuItems={optionsMenuItems}
                  inlineInsert={inlineInsert}
                  DocumentContentComponent={DocumentContentComponent}
                  ssrContentHTML={ssrContentHTML}
                  perspectiveAccountUid={ownAccountUid}
                  linkExtensionOptions={linkExtensionOptions}
                  canEdit={effectiveCanEdit}
                  machine={machine}
                  machineExtras={<WebDraftExternalModificationListener />}
                  signingAccountId={signingAccountId ?? undefined}
                  publishAccountUid={signingAccountId ?? undefined}
                  onEditorReady={onEditorReady}
                  existingDraft={existingDraft}
                  reservedDraftId={reservedDraftId}
                  existingDraftVisibility={draftData?.visibility}
                  existingDraftContent={existingDraftContent}
                  existingDraftCursorPosition={existingDraftCursorPosition}
                  existingDraftDeps={draftData?.deps}
                  draftVersionOnDiscardConfirm={webToolbarCallbacks.onDiscardConfirm}
                  editingFloatingActions={editingFloatingActions}
                  fileUpload={fileUpload}
                />
              </WebDraftBreadcrumbProvider>
            </QueryBlockDraftsProvider>
          </WebDraftActionsProvider>
        </DocumentActionsProvider>
      </CommentsProvider>
      {editProfileDialog.content}
      {followAccountContent}
      {newMenuContent}
      {deleteDialog.content}
      {destinationDialog.content}
      {vaultSuccessContent}
    </WebSitePageShell>
  )
}

/** Web-specific wrapper for the dedicated inspector page. */
export function WebInspectorPage({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <WebSitePageShell siteUid={docId.uid}>
      <InspectorPage docId={docId} pageFooter={<PageFooter id={docId} />} />
    </WebSitePageShell>
  )
}
