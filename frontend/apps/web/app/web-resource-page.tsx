import {HMExistingDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useJoinSite, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {CommentsProvider, InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
import {type EditorAccessor} from '@shm/shared/models/document-machine'
import {useResource} from '@shm/shared/models/entity'
import {QueryBlockDraftsProvider} from '@shm/shared/query-block-drafts-context'
import {useCommentNavigation} from '@shm/shared/utils/comment-navigation'
import {createWebHMUrl} from '@shm/shared/utils/entity-id-url'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {pathNameify} from '@shm/shared/utils/path'
import {computeInlineDraftPublishPath} from '@shm/shared/utils/publish-paths'
import {useQuery} from '@tanstack/react-query'
import {InlineSubscribeBox} from '@shm/ui/inline-subscribe-box'
import {InspectorPage} from '@shm/ui/inspector-page'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {EditingDocToolsRight, type EditingToolbarCallbacks} from '@shm/ui/editing-toolbar'
import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  EditProfileDialog,
  LogoutButton,
  getCurrentSigner,
  useCreateAccount,
  useLocalKeyPair,
  useVaultSuccessDialog,
} from './auth'
import {preloadCommenting} from './client-lazy'
import {setPendingIntent} from './local-db'
import {PageFooter} from './page-footer'
import {processPendingIntent} from './pending-intent'
import {WebHeaderActions, WebSitePageShell, useWebCreateDocumentMenuItem, useWebMenuItems} from './web-utils'
import {useWebCanEdit} from './document-edit/use-web-can-edit'
import {createWebDocumentMachine} from './document-edit/web-document-actors'
import {WebDraftActionsProvider} from './document-edit/web-draft-actions-provider'
import {WebQueryBlockDraftSlot} from './document-edit/web-query-block-draft-slot'
import {cleanupOldWebDocDrafts, getLatestWebDocDraftForDoc, getWebDocDraft} from './document-edit/web-draft-db'
import {makeWebFileUpload, makeWebImportWebFile} from './document-edit/web-image-upload'
import {getWebDraftPlaceholderId} from './document-edit/web-draft-path'

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
  const importWebFile = useMemo(() => makeWebImportWebFile(universalClient), [universalClient])

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

  const placeholderDraftId = useMemo(() => getWebDraftPlaceholderId(docId.path), [docId.path])

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
  })
  // Keep local drafts even when their base is no longer latest. Remote updates
  // are handled by the document machine's queued rebase flow; deleting here can
  // destroy a valid in-progress draft when the user is merely viewing a pinned
  // historical version.
  const draftData = draftQuery.data
  const isDraftStale = false

  const canEditLocalPlaceholderDraft =
    !!placeholderDraftId && !!draftData && !!signingAccountId && draftData.signingAccountId === signingAccountId
  const effectiveCanEdit = canEdit || canEditLocalPlaceholderDraft
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

  const existingDraft: HMExistingDraft | false | undefined = useMemo(() => {
    if (!effectiveCanEdit) return false
    if (draftQuery.isLoading) return undefined
    const d = draftData
    if (!d || isDraftStale) return false
    return {id: d.draftId, metadata: d.metadata as HMExistingDraft['metadata']}
  }, [effectiveCanEdit, draftQuery.isLoading, draftData, isDraftStale])
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
      onDiscardConfirm: (draftId: string, send) => {
        if (window.confirm('Discard draft changes?')) {
          send({type: 'edit.discard'})
          replaceRouteRef.current({
            ...(route.key === 'document' ? route : {key: 'document'}),
            id: {...docId, version: null},
          } as any)
          toast.success('Draft changes discarded')
        }
      },
      slugify: pathNameify,
      computeFirstPublishPath: computeInlineDraftPublishPath,
      onGoToVersions: (id: UnpackedHypermediaId) => {
        navigate({
          key: 'document',
          id,
          panel: {key: 'activity', id, filterEventType: ['Ref']},
        } as any)
      },
    }),
    [origin, originHomeId, navigate, docId, route],
  )

  const showPublishToolbar = route.key === 'document'

  const editingFloatingActions =
    effectiveCanEdit && showPublishToolbar
      ? ({menuItems}: {menuItems: any[]}) => (
          <EditingDocToolsRight docId={docId} existingMenuItems={menuItems} {...webToolbarCallbacks} />
        )
      : undefined

  const siteUid = docId.uid
  const {menuItem: newMenuItem, content: newMenuContent} = useWebCreateDocumentMenuItem({
    locationId: docId,
    signingAccountId: signingAccountId ?? undefined,
    canCreate: effectiveCanEdit && !!signingAccountId,
    capabilityCid: effectiveCapabilityCid,
  })
  const webMenuItems = useWebMenuItems(docId, {includeInspect: false})
  const optionsMenuItems = useMemo(
    () => (newMenuItem ? [newMenuItem, ...webMenuItems] : webMenuItems),
    [newMenuItem, webMenuItems],
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

  const [lastCreatedDraftId, setLastCreatedDraftId] = useState<string | null>(null)
  const canCreateInlineDraft = !placeholderDraftId

  return (
    <WebSitePageShell siteUid={docId.uid}>
      <CommentsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
        renderInlineEditor={renderWebInlineEditor}
      >
        <DocumentActionsProvider onCopyLink={() => {}}>
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
              <ResourcePage
                docId={docId}
                CommentEditor={CommentEditor}
                pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />}
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
                signingAccountId={signingAccountId ?? undefined}
                publishAccountUid={signingAccountId ?? undefined}
                onEditorReady={onEditorReady}
                existingDraft={existingDraft}
                existingDraftVisibility={draftData?.visibility}
                existingDraftContent={existingDraftContent}
                existingDraftCursorPosition={existingDraftCursorPosition}
                existingDraftDeps={draftData?.deps}
                draftVersionOnDiscardConfirm={webToolbarCallbacks.onDiscardConfirm}
                editingFloatingActions={editingFloatingActions}
                fileUpload={fileUpload}
                importWebFile={importWebFile}
              />
            </QueryBlockDraftsProvider>
          </WebDraftActionsProvider>
        </DocumentActionsProvider>
      </CommentsProvider>
      {editProfileDialog.content}
      {followAccountContent}
      {newMenuContent}
      {vaultSuccessContent}
    </WebSitePageShell>
  )
}

/** Web-specific wrapper for the dedicated inspector page. */
export function WebInspectorPage({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <WebSitePageShell siteUid={docId.uid}>
      <InspectorPage docId={docId} pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />} />
    </WebSitePageShell>
  )
}
