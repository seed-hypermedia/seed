import {useAppContext} from '@/app-context'
import {CommentBox, renderDesktopInlineEditor, triggerCommentDraftFocus} from '@/components/commenting'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useCreateDocumentMenuItem} from '@/components/create-doc-button'
import {useDeleteDialog} from '@/components/delete-dialog'
import {DesktopDraftActionsProvider} from '@/components/desktop-draft-actions-provider'
import {DesktopDraftBreadcrumbProvider} from '@/components/desktop-draft-breadcrumb-provider'
import {DesktopQueryBlockDraftSlot} from '@/components/desktop-query-block-draft-slot'
import {DesktopDocumentActionsProvider} from '@/components/document-actions-provider'
import {EditNavHeaderPane} from '@/components/edit-nav-header-pane'
import {useEditProfileDialog} from '@/components/edit-profile-dialog'
import {EditingDocToolsRight, useDesktopToolbarCallbacks} from '@/components/editing-toolbar'
// import {InlineNewDocumentCard} from '@/components/inline-new-document-card'
import {useFollowProfileIntent} from '@/components/desktop-intents'
import {DocumentDestinationDialog} from '@/components/document-destination-dialog'
import {JoinButton} from '@/components/join-button'
import {ParentUpdateToast} from '@/components/parent-update-toast'
import {usePublishSite, useRemoveSiteDialog} from '@/components/publish-site'
import {SearchInput} from '@/components/search-input'
import {domainResolver, grpcClient} from '@/grpc-client'
import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useMyAccountIds} from '@/models/daemon'
import {
  autoLinkParentAfterPublish,
  resolveDraftWriteAnchors,
  // useChildDrafts,
  usePublishResource,
} from '@/models/documents'
import {useExistingDraft} from '@/models/drafts'
import {useGatewayUrl, useGatewayUrlStream} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {usePushAfterAction} from '@/models/push-after-action'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {reportTelemetry, telemetryKeyForId, TelemetryStage} from '@/telemetry'
import {client} from '@/trpc'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {getPublishedResourceIdForDraftRoute} from '@/utils/draft-route'
import {fileUpload} from '@/utils/file-upload'
import {useNavigate} from '@/utils/useNavigate'
import {useBroadcastWindowEvent, useListenAppEvent} from '@/utils/window-events'
import {HMBlockNode, HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {DocumentEditor} from '@shm/editor/document-editor'
import {QuerySearchInputProvider} from '@shm/editor/query-search-context'
import {hmId, hostnameStripProtocol, unpackHmId, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {CommentsProvider} from '@shm/shared/comments-service-provider'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import type {LinkExtensionOptions} from '@shm/shared/document-content-props'
import {canCreateChildDocuments} from '@shm/shared/document-utils'
// import {hasQueryBlockTargetingSelf, hasSelfQueryBlockInEditorContent} from '@shm/shared/content'
import {
  DiscardDraftInput,
  documentMachine,
  PublishInput,
  PushDocumentInput,
  WriteDraftInput,
  WriteDraftOutput,
} from '@shm/shared/models/document-machine'
import {useDocumentInspector} from '@shm/shared/models/document-machine-inspect'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {selectContext, useDocumentMachineRef} from '@shm/shared/models/use-document-machine'
import {QueryBlockDraftsProvider} from '@shm/shared/query-block-drafts-context'
import {getDraftIdFromDraftPathSegment, isPrivateDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {useCommentNavigation} from '@shm/shared/utils/comment-navigation'
import {displayHostname, hmIdToURL} from '@shm/shared/utils/entity-id-url'
import {useNavigationDispatch, useNavRoute} from '@shm/shared/utils/navigation'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {isReservedLazyDraftId} from '@shm/shared/utils/reserved-draft-ids'
import {createCopyLinkMenuItem} from '@shm/ui/copy-link-menu'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {createDocumentVersionsPanelRoute} from '@shm/ui/document-versions-panel'
import {CloudOff, Download, Trash, UploadCloud} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {ResourcePage} from '@shm/ui/resource-page-common'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation} from '@tanstack/react-query'
import {Copy, FileInput, History, Layers, LayoutList, Split} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {fromPromise} from 'xstate'

const CLEANUP_LOG_PREFIX = '[Document embed cleanup]'

function isCleanupLoggingEnabled() {
  return Boolean((globalThis as any).__SEED_DOCUMENT_EMBED_CLEANUP_LOGS__)
}

function cleanupInfo(...args: unknown[]) {
  if (isCleanupLoggingEnabled()) console.info(...args)
}

function cleanupError(...args: unknown[]) {
  if (isCleanupLoggingEnabled()) console.error(...args)
}

async function deleteDraftsForCleanup(parentDraftId: string, childDraftIds: string[]) {
  const ids = Array.from(new Set(childDraftIds.filter((id) => id && id !== parentDraftId)))
  for (const id of ids) {
    try {
      await client.drafts.delete.mutate(id)
    } catch (error) {
      console.error('Failed to delete removed child draft:', id, error)
    }
  }
}

function summarizeEditorBlocksForCleanup(blocks: any[]) {
  const embedBlocks: Array<{id?: string; url?: string; view?: string; draftId?: string}> = []
  const topLevelBlockIds = blocks.map((block) => block?.id).filter(Boolean)
  const walk = (nodes: any[]) => {
    for (const block of nodes) {
      if (block?.type === 'embed') {
        embedBlocks.push({
          id: block.id,
          url: block.props?.url,
          view: block.props?.view,
          draftId: block.props?.draftId,
        })
      }
      if (Array.isArray(block?.children)) walk(block.children)
    }
  }
  walk(blocks)
  return {topLevelBlockIds, embedBlocks}
}

type DraftExternallyModifiedEvent = {
  type: 'draft_externally_modified'
  draftId: string
  source?: 'document-card-cleanup'
  deletedDocumentId?: string
  removedBlockIds?: string[]
  autoReload?: boolean
}

function DraftExternalModificationMachineLogger() {
  const actorRef = useDocumentMachineRef()

  const handleDraftExternallyModified = useCallback(
    async (event: DraftExternallyModifiedEvent) => {
      const snapshot = actorRef.getSnapshot()
      const context = selectContext(snapshot)
      cleanupInfo(`${CLEANUP_LOG_PREFIX} renderer draft_externally_modified received by document machine`, {
        eventDraftId: event.draftId,
        currentDraftId: context.draftId,
        matchesCurrentDraft: !!context.draftId && context.draftId === event.draftId,
        source: event.source ?? null,
        deletedDocumentId: event.deletedDocumentId ?? null,
        removedBlockIds: event.removedBlockIds ?? null,
        autoReload: event.autoReload ?? false,
        documentId: context.documentId.id,
        machineState: snapshot.value,
        draftContentTopLevelBlockCount: Array.isArray(context.draftContent) ? context.draftContent.length : 0,
        hasChangedWhileSaving: context.hasChangedWhileSaving,
        draftCreated: context.draftCreated,
      })
      if (event.source !== 'document-card-cleanup' || event.draftId !== context.draftId) {
        actorRef.send({type: 'draft.externallyModified', draftId: event.draftId, source: event.source})
        return
      }

      let draft: Awaited<ReturnType<typeof client.drafts.get.query>> | null = null
      try {
        draft = await client.drafts.get.query(event.draftId)
      } catch (error) {
        cleanupError(`${CLEANUP_LOG_PREFIX} renderer failed to load externally modified draft`, {
          draftId: event.draftId,
          error,
        })
      }

      actorRef.send({
        type: 'draft.externallyModified',
        draftId: event.draftId,
        source: event.source,
        deletedDocumentId: event.deletedDocumentId,
        removedBlockIds: event.removedBlockIds,
        content: draft?.content ?? null,
        cursorPosition: draft?.cursorPosition ?? null,
        metadata: draft?.metadata ?? null,
        deps: draft?.deps ?? null,
        mineTouchedIds: draft?.mineTouchedIds ?? null,
        baseBlocks: draft?.baseBlocks ?? null,
      })
    },
    [actorRef],
  )

  useListenAppEvent('draft_externally_modified', handleDraftExternallyModified)
  return null
}

export default function DesktopResourcePage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const replace = useNavigate('replace')

  // Only handle document-related routes
  const supportedKeys = [
    'document',
    'directory',
    'collaborators',
    'activity',
    'comments',
    'site-profile',
    'all-documents',
  ]
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DesktopResourcePage: unsupported route ${route.key}`)
  }

  // @ts-expect-error - route.id exists on all supported route types
  const docId = route.id
  if (!docId) throw new Error('No document ID in route')

  const dispatch = useNavigationDispatch()
  const existingDraft = useExistingDraft(route)
  const placeholderDraftId = getDraftIdFromDraftPathSegment(docId.path?.at(-1))
  const existingDraftRecord = existingDraft && typeof existingDraft === 'object' ? existingDraft : null
  const hasLocationOnlyDraft =
    !!existingDraftRecord && !!existingDraftRecord.locationUid && !existingDraftRecord.editUid
  const documentResourceId = getPublishedResourceIdForDraftRoute(docId, existingDraftRecord || existingDraft)
  const capabilityId =
    hasLocationOnlyDraft && existingDraftRecord?.locationUid
      ? hmId(existingDraftRecord.locationUid, {path: existingDraftRecord.locationPath})
      : placeholderDraftId
        ? hmId(docId.uid, {
            path: isPrivateDraftPathSegment(docId.path?.at(-1)) ? [] : (docId.path ?? []).slice(0, -1),
          })
        : docId

  const capability = useSelectedAccountCapability(capabilityId)
  const canEdit = roleCanWrite(capability?.role)
  const myAccountIds = useMyAccountIds()

  // Fetch draft content early so the editor can be initialized with draft blocks
  // instead of published blocks (avoids the flash + replaceBlocks race condition)
  const draftQuery = useDraft(existingDraft ? existingDraft.id : undefined)
  const draftData = existingDraft && draftQuery.data?.id === existingDraft.id ? draftQuery.data : undefined
  const existingDraftContent = draftData?.content

  // When another window writes to this draft (e.g. a child publish appended a
  // card embed via auto-link-parent), the editor's in-memory ProseMirror state
  // is stale. Show a persistent toast that the user can click to reload.
  const currentDraftId = existingDraft ? existingDraft.id : undefined
  const currentDraftIdRef = useRef(currentDraftId)
  currentDraftIdRef.current = currentDraftId

  // Auto-redirect when another window publishes this draft (so it gets a real
  // slug-based URL while we are still on the temporary `-${draftId}` URL).
  const docIdRef = useRef(docId)
  docIdRef.current = docId
  const replaceRoute = useNavigate('replace')
  const replaceRouteRef = useRef(replaceRoute)
  replaceRouteRef.current = replaceRoute
  const handleDocumentPathChanged = useCallback(
    (event: {type: 'document_path_changed'; oldId: string; newId: string}) => {
      if (docIdRef.current?.id !== event.oldId) return
      const newId = unpackHmId(event.newId)
      if (!newId) return
      replaceRouteRef.current({key: 'document', id: newId} as any)
    },
    [],
  )
  useListenAppEvent('document_path_changed', handleDocumentPathChanged)

  // When another window writes to this draft (e.g. an auto-link append),
  // the editor's in-memory ProseMirror state is stale. Show a persistent
  // toast that the user can click to reload the page.
  const handleDraftExternallyModified = useCallback((event: DraftExternallyModifiedEvent) => {
    const id = currentDraftIdRef.current
    cleanupInfo(`${CLEANUP_LOG_PREFIX} renderer draft_externally_modified received by page`, {
      eventDraftId: event.draftId,
      currentDraftId: id || null,
      matchesCurrentDraft: !!id && event.draftId === id,
      source: event.source ?? null,
      autoReload: event.autoReload ?? false,
      routeDocumentId: docIdRef.current.id,
    })
    if (!id || event.draftId !== id) return
    if (event.autoReload) {
      cleanupInfo(`${CLEANUP_LOG_PREFIX} renderer auto-reloading externally modified draft`, {
        draftId: event.draftId,
        source: event.source ?? null,
        routeDocumentId: docIdRef.current.id,
      })
      window.location.reload()
      return
    }
    if (event.source === 'document-card-cleanup') return
    toast.message('This draft was updated in another window', {
      id: `draft-externally-modified-${id}`,
      duration: Infinity,
      action: {
        label: 'Reload page',
        onClick: () => window.location.reload(),
      },
    })
  }, [])
  useListenAppEvent('draft_externally_modified', handleDraftExternallyModified)

  // Developer tools: XState inspect callback + event store (when enabled)
  const experiments = useUniversalAppContext().experiments
  const devTools = experiments?.developerTools
  const {inspect, store: inspectStore} = useDocumentInspector(!!devTools)

  // Editor ref for draft saving — captured via onEditorReady callback
  const editorRef = useRef<any>(null)
  const selectedAccountId = useSelectedAccountId()
  const selectedAccount = useSelectedAccount()
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor
  }, [])

  // Link extension options for the paste handler. Platform-specific deps
  // must be injected here because `@shm/editor` can't import from the desktop app.
  const linkOpenUrl = useOpenUrl()
  const universalClient = useUniversalClient()
  const linkGwUrl = useGatewayUrlStream()
  const checkWebUrlMutation = useMutation({
    mutationFn: (url: string) => client.webImporting.checkWebUrl.mutate(url),
  })
  const linkExtensionOptions = useMemo<LinkExtensionOptions>(
    () => ({
      universalClient,
      domainResolver,
      gwUrl: linkGwUrl,
      openUrl: linkOpenUrl,
      checkWebUrl: checkWebUrlMutation.mutateAsync,
    }),
    [universalClient, linkGwUrl, linkOpenUrl, checkWebUrlMutation.mutateAsync],
  )

  // Image block's URL submit. Fetch the external image and upload it to IPFS.
  // The tRPC procedure lives in app-web-importing.ts. Bind it once and pass via
  // a wrapped DocumentEditor so resource-page-common doesn't know about desktop-specific tRPC.
  const importWebFile = useCallback((url: string) => client.webImporting.importWebFile.mutate(url), [])
  const DocumentEditorWithImport = useMemo(
    () =>
      function DocumentEditorWithImport(props: React.ComponentProps<typeof DocumentEditor>) {
        return <DocumentEditor {...props} importWebFile={importWebFile as any} />
      },
    [importWebFile],
  )

  // Publish mutation (ref-based so the fromPromise actor can access it).
  // After publish completes, if the user was viewing a pinned (old) version,
  // navigate them to the new merged version so they see the published result
  // rather than remaining on the outdated pinned URL.
  const publishResource = usePublishResource(documentResourceId, {
    onSuccess: (result) => {
      const currentId = (route as any).id as UnpackedHypermediaId | undefined
      if (!currentId) return
      // Only rewrite the route when we were viewing a pinned version, or when
      // the published version differs from the pinned one. Clearing it is
      // safer than setting result.version because the user ends up on
      // "latest" and future publishes won't re-pin them.
      if (currentId.version) {
        // console.log('[DesktopResource] post-publish navigate → latest (was pinned)', {
        //   was: currentId.version,
        //   now: result.version,
        // })
        replace({
          ...(route as any),
          id: {...currentId, version: null},
        } as any)
      }
    },
  })
  const publishResourceRef = useRef(publishResource)
  publishResourceRef.current = publishResource

  // Push-on-publish: ref keeps the fromPromise actor stable across renders
  // while always reading the latest hook value when it fires.
  const pushAfterAction = usePushAfterAction()
  const pushAfterActionRef = useRef(pushAfterAction)
  pushAfterActionRef.current = pushAfterAction

  // Create writeDraft actor that reads content from the captured editor ref.
  // Account ID flows through machine context → actor input (no closure deps).
  const writeDraftActor = useMemo(
    () =>
      fromPromise<WriteDraftOutput, WriteDraftInput>(async ({input}) => {
        const editor = editorRef.current
        const content = editor ? editor.topLevelBlocks : []
        const cursorPosition = editor?._tiptapEditor?.view?.state?.selection?.$anchor?.pos ?? undefined
        const draftId = input.draftId || nanoid(10)
        const contentSummary = summarizeEditorBlocksForCleanup(content)
        cleanupInfo(`${CLEANUP_LOG_PREFIX} renderer writeDraft actor reading editor content`, {
          draftId,
          inputDraftId: input.draftId,
          hasEditor: !!editor,
          topLevelBlockCount: content.length,
          cursorPosition,
          signingAccountId: input.signingAccountId,
          ...contentSummary,
        })
        // console.log('[writeDraft] saving:', {
        //   draftId,
        //   blocksCount: content.length,
        //   cursorPosition,
        //   signingAccountId: input.signingAccountId,
        //   hasEditor: !!editor,
        // })
        const existingDraft = input.draftId ? await client.drafts.get.query(input.draftId) : null
        const currentPath = docIdRef.current.path ?? []
        const routeDraftId = getDraftIdFromDraftPathSegment(currentPath.at(-1))
        const isReservedRouteDraft = !!routeDraftId && routeDraftId === draftId && !existingDraft
        const isReservedPrivateDraft = isReservedRouteDraft && isPrivateDraftPathSegment(currentPath.at(-1))
        const isReservedPublicDraft = isReservedRouteDraft && !isReservedPrivateDraft
        const defaultAnchors = {
          locationUid: isReservedRouteDraft ? docIdRef.current.uid : input.locationUid || undefined,
          locationPath: isReservedPublicDraft ? currentPath.slice(0, -1) : input.locationPath,
          editUid: isReservedPublicDraft ? undefined : input.editUid || undefined,
          editPath: isReservedRouteDraft ? (isReservedPrivateDraft ? currentPath : []) : input.editPath,
        }
        const draftVisibility = existingDraft?.visibility ?? (isReservedPrivateDraft ? 'PRIVATE' : 'PUBLIC')
        const anchors = resolveDraftWriteAnchors(existingDraft, {
          locationUid: defaultAnchors.locationUid,
          locationPath: defaultAnchors.locationPath,
          editUid: defaultAnchors.editUid,
          editPath: defaultAnchors.editPath,
        })
        const result = await client.drafts.write.mutate({
          id: draftId,
          metadata: input.metadata,
          signingAccount: input.signingAccountId || undefined,
          content,
          cursorPosition,
          deps: input.deps,
          navigation: input.navigation,
          locationUid: anchors.locationUid,
          locationPath: anchors.locationPath,
          editUid: anchors.editUid,
          editPath: anchors.editPath,
          visibility: draftVisibility,
          mineTouchedIds: input.mineTouchedIds.length ? input.mineTouchedIds : undefined,
          baseBlocks: input.baseBlocks ?? undefined,
        })
        invalidateQueries([queryKeys.DRAFT, result.id])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
        cleanupInfo(`${CLEANUP_LOG_PREFIX} renderer writeDraft actor saved draft`, {
          draftId: result.id,
          inputDraftId: input.draftId,
          wroteTopLevelBlockCount: content.length,
          wroteEmbedBlocks: contentSummary.embedBlocks,
        })
        // console.log('[writeDraft] saved successfully:', {draftId: result.id})
        return {...result, content, cursorPosition}
      }),
    [],
  )

  // Create publishDocument actor that uses the stored publish mutation ref.
  // Account UID flows through machine context → actor input (no closure deps).
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const broadcastWindowEvent = useBroadcastWindowEvent()
  const broadcastWindowEventRef = useRef(broadcastWindowEvent)
  broadcastWindowEventRef.current = broadcastWindowEvent
  const publishDocumentActor = useMemo(
    () =>
      fromPromise<any, PublishInput>(async ({input}) => {
        const draftData = await client.drafts.get.query(input.draftId)
        if (!draftData) throw new Error('Draft not found: ' + input.draftId)

        const isPrivate = draftData.visibility === 'PRIVATE'
        // First-publish detection covers two cases:
        //   1. Legacy location-only drafts (no editUid) — clearly new docs.
        //   2. "Claimed" drafts (editUid+editPath set) where the doc at that
        //      path doesn't exist yet — also new docs (e.g. inline card flow).
        // Path encoding must match `hmIdPathToEntityQueryPath`: the daemon
        // expects `''` for the root home doc, not `'/'` — passing `'/'`
        // resolves to "not found" and would misclassify a home-doc edit as a
        // first publish, redirecting it to a brand-new child slug.
        let isFirstPublish = !draftData.editUid
        if (!isFirstPublish && draftData.editUid) {
          try {
            const editPathString = (draftData.editPath ?? []).filter((term) => !!term).join('/')
            const existing = await grpcClient.documents.getDocument({
              account: draftData.editUid,
              path: editPathString ? `/${editPathString}` : '',
            })
            if (!existing?.version) isFirstPublish = true
          } catch {
            isFirstPublish = true
          }
        }

        // The actual destination (slug rename for inline first-publish, plus
        // any explicit pathOverride from the publish popover) is resolved
        // inside `usePublishResource` so both the unified-editor flow and the
        // legacy draft-route flow share the same logic. We just hand it the
        // raw route id.
        const result = await publishResourceRef.current.mutateAsync({
          draft: draftData,
          destinationId: input.documentId,
          accountId: input.publishAccountUid || '',
          pathOverride: input.pathOverride,
        })

        const oldRouteId = input.documentId
        const newRouteId = hmId(result.account, {
          path: entityQueryPathToHmIdPath(result.path),
        })
        const pathChanged = oldRouteId.id !== newRouteId.id

        // If the URL changed (first publish from `-${draftId}` → real slug),
        // navigate this window to the new URL and broadcast the change so any
        // other window stuck on the old draft URL can react.
        if (pathChanged) {
          navigateRef.current({key: 'document', id: newRouteId})
          broadcastWindowEventRef.current({
            type: 'document_path_changed',
            oldId: oldRouteId.id,
            newId: newRouteId.id,
          })
        }

        if (isFirstPublish) {
          try {
            const childId = hmId(result.account, {
              path: entityQueryPathToHmIdPath(result.path),
            })
            const outcome = await autoLinkParentAfterPublish({
              childId,
              childDraftId: input.draftId,
              signingAccountUid: input.publishAccountUid || undefined,
              isPrivate,
            })
            if (outcome.kind === 'added-to-draft' || outcome.kind === 'published-parent') {
              const parentId = outcome.parentId
              const navigateToParent = () => {
                navigateRef.current({
                  key: 'document',
                  id: hmId(parentId.uid, {path: parentId.path, latest: true}),
                })
              }
              const message =
                outcome.kind === 'added-to-draft' ? 'Link added to parent draft' : 'Parent document updated'
              toast.success(<ParentUpdateToast message={message} onViewParent={navigateToParent} />)

              // Tell every window holding this draft open that its on-disk
              // content has changed under it. The ProseMirror editor in the
              // parent's window keeps its own state, so React-Query
              // invalidation alone won't surface the new embed.
              if (outcome.kind === 'added-to-draft') {
                broadcastWindowEventRef.current({
                  type: 'draft_externally_modified',
                  draftId: outcome.parentDraftId,
                })
              }
            }
          } catch (error) {
            console.error('Failed to add link to parent:', error)
            toast.error('Published document, but failed to add link to parent')
          }
        }

        await deleteDraftsForCleanup(input.draftId, input.deletedChildDraftIds)
        await client.drafts.delete.mutate(input.draftId)
        invalidateQueries([queryKeys.DRAFT, input.draftId])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
        return result
      }),
    [],
  )

  const discardDraftActor = useMemo(
    () =>
      fromPromise<void, DiscardDraftInput>(async ({input}) => {
        await deleteDraftsForCleanup(input.draftId, input.deletedChildDraftIds)
        await client.drafts.delete.mutate(input.draftId)
        invalidateQueries([queryKeys.DRAFT, input.draftId])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      }),
    [],
  )

  // Create pushDocument actor — spawned fire-and-forget after publish succeeds.
  // Delegates to the shared usePushAfterAction helper (same flow used for
  // comment publishing and copy-link), which handles the setting gate, toast,
  // and errors.
  const pushDocumentActor = useMemo(
    () =>
      fromPromise<void, PushDocumentInput>(async ({input}) => {
        const doc = input.publishedDocument
        if (!doc?.account || !doc?.version) return
        const pushId = hmId(doc.account, {
          path: entityQueryPathToHmIdPath(doc.path),
          version: doc.version,
        })
        pushAfterActionRef.current({id: pushId, trigger: 'publish'})
      }),
    [],
  )

  // Provide actors to the document machine
  const machine = useMemo(
    () =>
      documentMachine.provide({
        actors: {
          writeDraft: writeDraftActor,
          publishDocument: publishDocumentActor,
          discardDraft: discardDraftActor,
          pushDocument: pushDocumentActor,
        },
      }),
    [writeDraftActor, publishDocumentActor, discardDraftActor, pushDocumentActor],
  )

  // Get site URL for publication actions
  const siteHomeResource = useResource(hmId(docId.uid), {subscribed: true})
  const siteUrl =
    siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document?.metadata?.siteUrl : undefined

  // Publishing / unpublishing
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const removeSiteDialog = useRemoveSiteDialog()
  const publishSite = usePublishSite()
  const pendingDomain = useHostSession().pendingDomains?.find((pending) => pending.siteUid === docId.uid)
  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
    siteUrl ? hmId(docId.uid) : undefined,
  )

  // Hooks for options dropdown
  const resource = useResource(documentResourceId)
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const docIsInMyAccount = myAccountIds.data?.includes(docId.uid)

  // Key off the route's docId rather than the resolved doc.{account,path,version}
  // so this stamp matches what useNavigate/navigation-container emit for
  // renderer.link_click. Using doc.version would produce a versioned key
  // (hm://acc/path?v=bafy...) that diverges from link_click's usually-versionless
  // key, splitting a single click->paint flow into two single-checkpoint traces.
  const renderedTelemetryKeys = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!doc) return
    const key = telemetryKeyForId(docId)
    if (!key || renderedTelemetryKeys.current.has(key)) return
    renderedTelemetryKeys.current.add(key)
    reportTelemetry(key, TelemetryStage.ComponentRendered)
  }, [doc, docId])

  // Tracks drafts created from query blocks so the corresponding inline draft card can focus its title.
  const [lastCreatedDraftId, setLastCreatedDraftId] = useState<string | null>(null)
  const canCreateChildDocs = canCreateChildDocuments(doc?.visibility, draftData?.visibility)
  const {menuItem: newMenuItem, content: newMenuContent} = useCreateDocumentMenuItem({
    locationId: docId,
    canCreateChildren: canCreateChildDocs,
  })

  // Bottom-of-doc "draft cards" — disabled while inline-draft UX is still
  // being settled. Restore by uncommenting these blocks, the related imports
  // above, and the `inlineCards={inlineCards}` prop on ResourcePage below.
  // const childDrafts = useChildDrafts(docId)
  //
  // // Detect self-referential query block — if present, drafts render inside query blocks
  // // and the bottom fallback is suppressed. We check both the published doc content
  // // and the parent's draft content so a query block added in an unpublished draft
  // // also suppresses the duplicate.
  // const hasSelfQuery = useMemo(() => {
  //   const parentPath = docId.path || null
  //   if (existingDraftContent && hasSelfQueryBlockInEditorContent(existingDraftContent, docId.uid, parentPath)) {
  //     return true
  //   }
  //   if (doc?.content && hasQueryBlockTargetingSelf(doc.content, docId.uid, parentPath)) {
  //     return true
  //   }
  //   return false
  // }, [doc?.content, existingDraftContent, docId.uid, docId.path])
  //
  // // Bottom fallback: drafts of the current doc when no query block on the page targets it
  // const inlineCards = useMemo(() => {
  //   if (!childDrafts.length || hasSelfQuery) return null
  //   return (
  //     <div className="mt-6 grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
  //       {childDrafts.map((draft) => (
  //         <InlineNewDocumentCard key={draft.id} draft={draft} autoFocus={draft.id === lastCreatedDraftId} />
  //       ))}
  //     </div>
  //   )
  // }, [childDrafts, lastCreatedDraftId, hasSelfQuery])

  // Profile editing for site-profile pages
  const editProfileDialog = useEditProfileDialog()
  const isSiteProfile = route.key === 'site-profile'
  const profileAccountUid = isSiteProfile && route.key === 'site-profile' ? route.accountUid || docId.uid : null
  const isOwnProfile = isSiteProfile && !!profileAccountUid && !!myAccountIds.data?.includes(profileAccountUid)
  const onEditProfile = useMemo(() => {
    if (!isOwnProfile || !profileAccountUid) return undefined
    return () => editProfileDialog.open({accountUid: profileAccountUid})
  }, [isOwnProfile, profileAccountUid, editProfileDialog])

  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const destinationDialog = useAppDialog(DocumentDestinationDialog, {className: 'w-full max-w-2xl'})

  const menuItems: MenuItemType[] = []

  menuItems.push(
    createCopyLinkMenuItem({
      advanced: experiments?.advancedCopyLinkOptions,
      canonical: siteUrl
        ? {
            label: `Copy ${displayHostname(siteUrl)} Link`,
            copy: () => onCopySiteUrl(route),
          }
        : null,
      gateway: {
        label: `Copy ${displayHostname(gwUrl)} Link`,
        copy: () => onCopyGateway(route),
      },
      hypermedia: {
        copy: () => copyUrlToClipboardWithFeedback(hmIdToURL(docId), 'Hypermedia'),
      },
    }),
  )

  if (newMenuItem) {
    menuItems.push(newMenuItem)
  }

  if (canEdit && selectedAccountId && docId.path?.length) {
    menuItems.push({
      key: 'move',
      label: 'Move',
      icon: <FileInput className="size-4" />,
      onClick: () => {
        const draftMoveId = currentDraftId || placeholderDraftId
        if (draftMoveId) {
          const fallbackParent = docId.path?.length ? hmId(docId.uid, {path: docId.path.slice(0, -1)}) : undefined
          destinationDialog.open({
            id: docId,
            mode: 'move',
            origin: draftData?.locationUid
              ? {parentDocumentId: hmId(draftData.locationUid, {path: draftData.locationPath ?? []})}
              : fallbackParent
                ? {parentDocumentId: fallbackParent}
                : undefined,
            draft: {draftId: draftMoveId, title: draftData?.metadata?.name, icon: draftData?.metadata?.icon},
          })
          return
        }
        destinationDialog.open({id: docId, mode: 'move'})
      },
    })
  }

  if (canEdit && docId.path?.length) {
    menuItems.push({
      key: 'duplicate',
      label: 'Duplicate document',
      icon: <Copy className="size-4" />,
      onClick: async () => {
        if (!doc) return
        try {
          const editorContent = hmBlocksToEditorContent(doc.content || [], {childrenType: 'Group'})
          const sourceName = doc.metadata?.name || 'Untitled'
          const copyName = `${sourceName} Copy`
          const draftId = nanoid(10)
          const parentPath = docId.path?.slice(0, -1) || []

          const draftEditPath = [...parentPath, `-${draftId}`]
          await client.drafts.write.mutate({
            id: draftId,
            locationUid: docId.uid,
            locationPath: parentPath,
            editUid: docId.uid,
            editPath: draftEditPath,
            metadata: {...doc.metadata, name: copyName},
            content: editorContent,
            deps: [],
            visibility: doc.visibility,
          })

          sessionStorage.setItem('duplicate-draft-focus', draftId)
          navigate({
            key: 'document',
            id: hmId(docId.uid, {path: draftEditPath}),
            panel: null,
          })
          toast.success(`Duplicated "${sourceName}"`)
        } catch (error) {
          console.error('Error duplicating document:', error)
          toast.error('Failed to duplicate document')
        }
      },
    })
  }

  menuItems.push({
    key: 'export',
    label: 'Export document',
    icon: <Download className="size-4" />,
    onClick: async () => {
      if (!doc) return
      const title = doc?.metadata.name || 'document'
      const blocks: HMBlockNode[] | undefined = doc?.content || undefined
      const editorBlocks = hmBlocksToEditorContent(blocks, {
        childrenType: 'Group',
      })
      const markdownWithFiles = await convertBlocksToMarkdown(editorBlocks, doc)
      const {markdownContent, mediaFiles} = markdownWithFiles
      exportDocument(title, markdownContent, mediaFiles)
        .then((res) => {
          toast.success(
            <div className="flex max-w-[700px] flex-col gap-1.5">
              <SizableText className="text-wrap break-all">
                Successfully exported document &quot;{title}&quot; to: <b>{`${res}`}</b>.
              </SizableText>
              <SizableText
                className="text-current underline"
                onClick={() => {
                  // @ts-expect-error
                  openDirectory(res)
                }}
              >
                Show directory
              </SizableText>
            </div>,
          )
        })
        .catch((err) => {
          toast.error(err)
        })
    },
  })

  if (selectedAccountId && docId.path?.length) {
    menuItems.push({
      key: 'republish',
      label: 'Republish',
      icon: <Split className="size-4" />,
      tooltip: 'Republish means creating an independent copy that you can modify and keeps the original attribution.',
      onClick: () => destinationDialog.open({id: docId, mode: 'republish'}),
    })
  }

  menuItems.push({
    key: 'versions',
    label: 'Versions history',
    icon: <History className="size-4" />,
    onClick: () => {
      replace({
        key: 'document',
        id: docId,
        panel: createDocumentVersionsPanelRoute(docId),
      })
    },
  })

  menuItems.push({
    key: 'directory',
    label: 'Sub documents',
    icon: <Layers className="size-4" />,
    onClick: () => navigate({key: 'directory', id: docId}),
  })

  menuItems.push({
    key: 'all-documents',
    label: 'All Documents',
    icon: <LayoutList className="size-4" />,
    onClick: () => navigate({key: 'all-documents', id: hmId(docId.uid)}),
  })

  // Publish / Unpublish site options (only for home documents)
  if (!docId.path?.length && canEdit) {
    if (siteUrl) {
      const siteHost = hostnameStripProtocol(siteUrl)
      const gwHost = hostnameStripProtocol(gwUrl)
      if (siteHost.endsWith(gwHost) && !pendingDomain) {
        menuItems.push({
          key: 'publish-custom-domain',
          label: 'Publish Custom Domain',
          icon: <UploadCloud className="size-4" />,
          onClick: () => {
            publishSite.open({id: docId, step: 'seed-host-custom-domain'})
          },
        })
      }
      menuItems.push({
        key: 'remove-site',
        label: 'Remove Site from Publication',
        icon: <CloudOff className="size-4" />,
        variant: 'destructive',
        onClick: () => {
          removeSiteDialog.open(docId)
        },
      })
    } else {
      menuItems.push({
        key: 'publish-site',
        label: 'Publish Site to Domain',
        icon: <UploadCloud className="size-4" />,
        onClick: () => {
          publishSite.open({id: docId})
        },
      })
    }
  }

  if (canEdit && docId.path?.length) {
    menuItems.push({
      key: 'delete',
      label: 'Delete Document',
      icon: <Trash className="size-4" />,
      variant: 'destructive',
      onClick: () => {
        deleteEntity.open({
          id: docId,
          onSuccess: () => {
            dispatch({
              type: 'backplace',
              route: {
                key: 'document',
                id: hmId(docId.uid, {
                  path: docId.path?.slice(0, -1),
                }),
              } as any,
            })
          },
        })
      },
    })
  }

  const showPublishToolbar = route.key === 'document'

  // Walk the editor's blocks for embed blocks with a draftId.
  // Called at Publish click time so the popover always opens
  // when there are unresolved draft embeds
  const getUnpublishedChildCount = useCallback(() => {
    const editor = editorRef.current
    const blocks = editor?.topLevelBlocks ?? []
    const ids = new Set<string>()
    const walk = (nodes: any[]) => {
      for (const b of nodes) {
        if (b?.type === 'embed' && b?.props?.draftId) ids.add(b.props.draftId)
        if (b?.children?.length) walk(b.children)
      }
    }
    walk(blocks)
    return ids.size
  }, [])

  const editingFloatingActions =
    canEdit && showPublishToolbar
      ? ({menuItems}: {menuItems: any[]}) => (
          <EditingDocToolsRight
            docId={docId}
            existingMenuItems={menuItems}
            getUnpublishedChildCount={getUnpublishedChildCount}
          />
        )
      : undefined
  const {callbacks: draftVersionToolbarCallbacks, deleteDraftDialog: draftVersionDeleteDraftDialog} =
    useDesktopToolbarCallbacks(docId)

  const onAfterReply = useCallback(
    (_docId: UnpackedHypermediaId, comment: HMComment) => {
      triggerCommentDraftFocus(docId.id, comment.id)
    },
    [docId.id],
  )
  const {onReplyClick, onReplyCountClick} = useCommentNavigation({
    docId,
    route,
    navigate,
    replaceRoute: replace,
    onAfterReply,
  })
  const followIntent = useFollowProfileIntent(route.key === 'site-profile' ? route.accountUid || docId.uid : docId.uid)

  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border bg-white">
      <CommentsProvider
        useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
        renderInlineEditor={renderDesktopInlineEditor}
        showDeletedContent
        pushAfterCommentPublish={(targetDocId) => pushAfterAction({id: targetDocId, trigger: 'publish'})}
      >
        <DesktopDocumentActionsProvider>
          {/*
            Allow creating inline child drafts only when the current doc has a published version
          */}
          <DesktopDraftActionsProvider
            canCreateInlineDraft={canCreateChildDocs && (!existingDraft || !existingDraft.locationUid)}
          >
            <DesktopDraftBreadcrumbProvider>
              <QueryBlockDraftsProvider
                DraftSlot={DesktopQueryBlockDraftSlot}
                lastCreatedDraftId={lastCreatedDraftId}
                setLastCreatedDraftId={setLastCreatedDraftId}
              >
                <QuerySearchInputProvider value={SearchInput}>
                  <ResourcePage
                    docId={docId}
                    resourceId={documentResourceId}
                    canEdit={canEdit}
                    CommentEditor={CommentBox}
                    optionsMenuItems={menuItems}
                    existingDraft={existingDraft}
                    reservedDraftId={
                      placeholderDraftId &&
                      !existingDraftRecord &&
                      (existingDraft === false || isReservedLazyDraftId(placeholderDraftId))
                        ? placeholderDraftId
                        : null
                    }
                    existingDraftVisibility={draftData?.visibility}
                    existingDraftContent={existingDraftContent}
                    existingDraftCursorPosition={draftData?.cursorPosition}
                    existingDraftMineTouchedIds={draftData?.mineTouchedIds}
                    existingDraftBaseBlocks={draftData?.baseBlocks}
                    existingDraftDeps={draftData?.deps}
                    draftVersionOnDiscardConfirm={draftVersionToolbarCallbacks.onDiscardConfirm}
                    rightActions={<JoinButton siteUid={docId.uid} />}
                    onEditProfile={onEditProfile}
                    onFollowClick={followIntent.follow}
                    inspect={inspect}
                    inspectStore={inspectStore}
                    DocumentContentComponent={DocumentEditorWithImport}
                    machine={machine}
                    onEditorReady={handleEditorReady}
                    machineExtras={<DraftExternalModificationMachineLogger />}
                    editingFloatingActions={editingFloatingActions}
                    signingAccountId={selectedAccountId || undefined}
                    publishAccountUid={selectedAccount?.id?.uid || undefined}
                    perspectiveAccountUid={selectedAccountId}
                    linkExtensionOptions={linkExtensionOptions}
                    fileUpload={fileUpload}
                    editNavPane={
                      canEdit && !docId.path?.length ? <EditNavHeaderPane homeId={hmId(docId.uid)} /> : undefined
                    }
                  />
                  {draftVersionDeleteDraftDialog.content}
                </QuerySearchInputProvider>
              </QueryBlockDraftsProvider>
            </DesktopDraftBreadcrumbProvider>
          </DesktopDraftActionsProvider>
        </DesktopDocumentActionsProvider>
      </CommentsProvider>
      {copyGatewayContent}
      {copySiteUrlContent}
      {deleteEntity.content}
      {destinationDialog.content}
      {editProfileDialog.content}
      {removeSiteDialog.content}
      {publishSite.content}
      {newMenuContent}
      {followIntent.content}
    </div>
  )
}
