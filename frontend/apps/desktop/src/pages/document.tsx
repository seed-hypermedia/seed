import {AccessoryLayout} from '@/components/accessory-sidebar'
import {AddCollaboratorForm} from '@/components/collaborators-panel'
import {CommentBox, triggerCommentDraftFocus} from '@/components/commenting'
import {useDocumentUrl} from '@/components/copy-reference-button'
import {CreateDocumentButton} from '@/components/create-doc-button'
import {DocNavigation} from '@/components/doc-navigation'
import {
  NewSubDocumentButton,
  useCanCreateSubDocument,
  useDocumentSelection,
} from '@/components/document-accessory'
import {NotifSettingsDialog} from '@/components/email-notifs-dialog'
import {editPopoverEvents} from '@/components/onboarding'
import {
  roleCanWrite,
  useAllDocumentCapabilities,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDocumentCitations} from '@/models/citations'
import {useContactsMetadata} from '@/models/contacts'
import {
  useDocumentEmbeds,
  useDocumentRead,
  usePushResource,
  useSiteNavigationItems,
} from '@/models/documents'
import {useExistingDraft} from '@/models/drafts'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useChildrenActivity} from '@/models/library'
import {useSelectedAccount} from '@/selected-account'
import {client} from '@/trpc'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import '@shm/editor/editor.css'
import {
  ActivityRoute,
  CollaboratorsRoute,
  DiscussionsRoute,
  DocumentDirectorySelection,
  DocumentRoute,
  FeedRoute,
  HMDocument,
  HMResource,
  HMResourceFetchResult,
  PanelSelectionOptions,
  UnpackedHypermediaId,
  calculateBlockCitations,
  commentIdToHmId,
  getCommentTargetId,
  hmId,
  routeToPanelRoute,
} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
  useDeleteComment,
} from '@shm/shared/comments-service-provider'
import {useAccount, useResource, useResources} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import '@shm/shared/styles/document.css'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {
  BlockRangeSelectOptions,
  BlocksContent,
  BlocksContentProvider,
} from '@shm/ui/blocks-content'
import {Button} from '@shm/ui/button'
import {ReadOnlyCollaboratorsContent} from '@shm/ui/collaborators-page'
import {useDeleteCommentDialog} from '@shm/ui/comments'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DirectoryPageContent} from '@shm/ui/directory-page'
import {DiscussionsPageContent} from '@shm/ui/discussions-page'
import {DocumentCover} from '@shm/ui/document-cover'
import {DocumentHeader} from '@shm/ui/document-header'
import {DocumentTools} from '@shm/ui/document-tools'
import {Feed} from '@shm/ui/feed'
import {useDocumentLayout} from '@shm/ui/layout'
import {OpenInPanelButton} from '@shm/ui/open-in-panel'
import {
  PageDiscovery,
  PageNotFound,
  PageRedirected,
} from '@shm/ui/page-message-states'
import {SiteHeader} from '@shm/ui/site-header'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {cn} from '@shm/ui/utils'
import {useMutation} from '@tanstack/react-query'
import {Pencil} from 'lucide-react'
import {nanoid} from 'nanoid'
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// Type for routes that this page handles
type DocumentPageRoute =
  | DocumentRoute
  | FeedRoute
  | DocumentDirectorySelection
  | CollaboratorsRoute
  | ActivityRoute
  | DiscussionsRoute

// Helper to extract id from any of the supported route types
function getRouteId(route: DocumentPageRoute): UnpackedHypermediaId {
  return route.id
}

// Helper to get the active main panel based on route key
function getActiveMainPanel(
  route: DocumentPageRoute,
): 'content' | 'directory' | 'collaborators' | 'activity' | 'discussions' {
  switch (route.key) {
    case 'directory':
      return 'directory'
    case 'collaborators':
      return 'collaborators'
    case 'activity':
      return 'activity'
    case 'discussions':
      return 'discussions'
    default:
      return 'content'
  }
}

export default function DocumentPage() {
  const route = useNavRoute()

  // Handle all supported route types
  const supportedKeys = [
    'document',
    'feed',
    'directory',
    'collaborators',
    'activity',
    'discussions',
  ]
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DocumentPage: unsupported route key ${route.key}`)
  }

  const typedRoute = route as DocumentPageRoute
  const docId = getRouteId(typedRoute)
  useDocumentRead(docId)
  if (!docId) throw new Error('Invalid route, no document id')

  const panelKey: PanelSelectionOptions | undefined = typedRoute.panel?.key as
    | PanelSelectionOptions
    | undefined
  const replace = useNavigate('replace')
  const push = useNavigate('push')

  const notifyServiceHost = useNotifyServiceHost()
  const notifSettingsDialog = useAppDialog(NotifSettingsDialog)
  const immediatePromptNotifs =
    route.key === 'document' &&
    route.immediatelyPromptNotifs &&
    !route.id?.path?.length

  const markPromptedKey = useMutation({
    mutationFn: (input: {key: string; isPrompted: boolean}) =>
      client.prompting.markPromptedKey.mutate(input),
  })

  useEffect(() => {
    if (
      immediatePromptNotifs &&
      notifyServiceHost &&
      route.key === 'document'
    ) {
      notifSettingsDialog.open({
        notifyServiceHost: notifyServiceHost,
        accountUid: route.id.uid,
        title: 'Get Emailed when Important Things Happen Here',
      })
      markPromptedKey.mutate({
        key: `account-email-notifs-${route.id.uid}`,
        isPrompted: true,
      })
      replace({...route, immediatelyPromptNotifs: false})
    }
  }, [immediatePromptNotifs, notifyServiceHost])

  const mainPanelRef = useRef<HTMLDivElement>(null)

  return (
    <CommentsProvider
      useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
      onReplyClick={(replyComment) => {
        const targetRoute = isRouteEqualToCommentTarget({
          id: docId,
          comment: replyComment,
        })

        if (targetRoute) {
          push({
            key: 'document',
            id: targetRoute,
            panel: {
              key: 'discussions',
              id: docId,
              openComment: replyComment.id,
              isReplying: true,
            },
          })
        } else {
          console.log('targetRoute is the same. replacing...')
          replace({
            ...typedRoute,
            panel: {
              key: 'discussions',
              id: docId,
              openComment: replyComment.id,
              isReplying: true,
            },
          } as DocumentPageRoute)
        }
        triggerCommentDraftFocus(docId.id, replyComment.id)
      }}
      onReplyCountClick={(replyComment) => {
        const targetRoute = isRouteEqualToCommentTarget({
          id: docId,
          comment: replyComment,
        })
        if (targetRoute) {
          // comment target is not the same as the route, so we need to change the whole route
          push({
            key: 'document',
            id: targetRoute,
            panel: {
              key: 'discussions',
              id: targetRoute,
              openComment: replyComment.id,
              isReplying: true,
            },
          })
        } else {
          // comment target is the same as the route, so we can replace safely
          replace({
            ...typedRoute,
            panel: {
              key: 'discussions',
              id: docId,
              openComment: replyComment.id,
              isReplying: true,
            },
          } as DocumentPageRoute)
        }
      }}
    >
      <DocumentPageContent
        docId={docId}
        route={typedRoute}
        mainPanelRef={mainPanelRef}
        panelKey={panelKey}
        notifSettingsDialogContent={notifSettingsDialog.content}
      />
    </CommentsProvider>
  )
}

function DocumentPageContent({
  docId,
  route,
  mainPanelRef,
  panelKey,
  notifSettingsDialogContent,
}: {
  docId: UnpackedHypermediaId
  route: DocumentPageRoute
  mainPanelRef: React.RefObject<HTMLDivElement>
  panelKey: string | undefined
  notifSettingsDialogContent: ReactNode
}) {
  const deleteComment = useDeleteComment()
  const navigate = useNavigate()
  const deleteCommentDialog = useDeleteCommentDialog()
  const homeDoc = useResource(hmId(docId.uid))
  const targetDomain =
    homeDoc.data?.type === 'document'
      ? homeDoc.data.document.metadata.siteUrl
      : undefined
  const pushResource = usePushResource()
  const onCommentDelete = useCallback(
    (commentId: string, signingAccountId?: string) => {
      if (!signingAccountId || !docId) return
      deleteCommentDialog.open({
        onConfirm: () => {
          deleteComment.mutate({
            commentId,
            targetDocId: docId,
            signingAccountId,
          })
          pushResource(commentIdToHmId(commentId))
        },
      })
    },
    [docId, deleteComment, deleteCommentDialog],
  )

  const {selectionUI, selectionOptions} = useDocumentSelection({
    docId,
    onCommentDelete,
    deleteCommentDialogContent: deleteCommentDialog.content,
    targetDomain,
  })

  useListenAppEvent('toggle_accessory', (event) => {
    // Navigation guard: Check if accessory exists at this index
    const targetSelection = selectionOptions[event.index]

    if (!targetSelection) {
      // No accessory at this index, do nothing
      return
    }

    // Check if already open
    if (panelKey === targetSelection.key) {
      // Already open → close it
      navigate({...route, panel: null} as DocumentPageRoute)
    } else {
      // Not open → open it
      navigate({
        ...route,
        panel: {key: targetSelection.key, id: docId},
      } as DocumentPageRoute)
    }
  })

  const activeMainPanel = getActiveMainPanel(route)

  return (
    <div className="flex h-full flex-1 flex-col">
      <AccessoryLayout panelUI={selectionUI} panelKey={panelKey as any}>
        <MainDocumentPage
          id={docId}
          route={route}
          activeMainPanel={activeMainPanel}
          isBlockFocused={
            route.key === 'document' ? route.isBlockFocused || false : false
          }
          onScrollParamSet={useCallback((isFrozen) => {
            mainPanelRef.current?.style.setProperty(
              'overflow',
              isFrozen ? 'hidden' : 'auto',
            )
          }, [])}
          isCommentingPanelOpen={route.panel?.key === 'activity'}
          onSelection={useCallback(
            (panel) => {
              navigate({...route, panel} as DocumentPageRoute)
            },
            [route, navigate],
          )}
          onCommentDelete={onCommentDelete}
          deleteCommentDialogContent={deleteCommentDialog.content}
          targetDomain={targetDomain}
        />
      </AccessoryLayout>
      {notifSettingsDialogContent}
    </div>
  )
}

function _MainDocumentPage({
  id,
  route,
  activeMainPanel,
  isBlockFocused,
  onScrollParamSet,
  onCommentDelete,
  deleteCommentDialogContent,
  targetDomain,
}: {
  id: UnpackedHypermediaId
  route: DocumentPageRoute
  activeMainPanel:
    | 'content'
    | 'directory'
    | 'collaborators'
    | 'activity'
    | 'discussions'
  isBlockFocused: boolean
  onScrollParamSet: (isFrozen: boolean) => void
  isCommentingPanelOpen: boolean
  onSelection: (panel: DocumentRoute['panel']) => void
  onCommentDelete: (commentId: string, signingAccountId?: string) => void
  deleteCommentDialogContent: ReactNode
  targetDomain?: string
}) {
  const replace = useNavigate('replace')
  const selectedAccount = useSelectedAccount()
  const canCreate = useCanCreateSubDocument(id)
  const account = useAccount(id.uid, {enabled: !id.path?.length})

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({...route, id: account.data.id} as DocumentPageRoute)
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({...route, id: redirectTarget} as DocumentPageRoute)
      }
    },
  })
  const loadedCommentResource =
    // @ts-ignore
    resource.data?.type === 'comment' ? resource.data : undefined
  useEffect(() => {
    if (loadedCommentResource) {
      const comment = loadedCommentResource.comment
      const targetDocId = getCommentTargetId(comment)
      if (targetDocId) {
        replace({
          key: 'document',
          id: targetDocId,
          panel: {key: 'discussions', id: targetDocId, openComment: comment.id},
        })
      }
    }
  }, [loadedCommentResource])

  const siteHomeEntity = useResource(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId(id.uid) : id,
    // otherwise, create an ID with the latest version of the home document
    {
      subscribed: true,
      recursive: id.path?.length ? false : true, // avoiding redundant subscription if the doc is not the home document
    },
  )

  const document =
    // @ts-ignore
    resource.data?.type === 'document' ? resource.data.document : undefined
  const docId =
    resource.data?.type === 'document' ? resource.data.id : undefined
  const metadata = document?.metadata
  // IMPORTANT: Always call hooks at the top level, before any early returns
  // This ensures hooks are called in the same order on every render
  const isHomeDoc = !id.path?.length
  const isShowOutline =
    (typeof metadata?.showOutline == 'undefined' || metadata?.showOutline) &&
    !isHomeDoc
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    showCollapsed,
    wrapperProps,
    contentMaxWidth,
  } = useDocumentLayout({
    contentWidth: metadata?.contentWidth,
    showSidebars: showSidebarOutlineDirectory,
  })

  const directory = useChildrenActivity(id)

  const {data: collaborators} = useAllDocumentCapabilities(docId)

  const interactionSummary = useInteractionSummary(docId)

  // Scroll restoration for activity feed
  const activityScrollRef = useScrollRestoration({
    scrollId: `activity-page-${id.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })

  // Reset scroll when filter changes (activity page)
  useEffect(() => {
    if (
      activityScrollRef.current &&
      route.key === 'activity' &&
      route.filterEventType
    ) {
      const viewport = activityScrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLElement
      if (viewport) {
        viewport.scrollTo({top: 0, behavior: 'instant'})
      }
    }
  }, [
    route.key === 'activity' ? (route as ActivityRoute).filterEventType : null,
  ])

  const existingDraft = useExistingDraft(route)

  // @ts-ignore
  if (resource.isInitialLoading) return null

  // @ts-ignore
  if (resource.data?.type === 'redirect') {
    return (
      <PageRedirected
        docId={id}
        // @ts-ignore
        redirectTarget={resource.data.redirectTarget}
        onNavigate={(target) =>
          replace({...route, id: target} as DocumentPageRoute)
        }
      />
    )
  }

  // @ts-ignore
  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return <PageDiscovery />
    }
    return <PageNotFound />
  }

  // @ts-ignore
  if (resource.data?.type === 'error') {
    return (
      <DocErrorMessage
        // @ts-ignore
        message={resource.data.message}
      />
    )
  }

  if (loadedCommentResource) {
    return null
  }

  // Only pass siteHomeEntity if it's loaded and is a document type
  const siteHomeEntityData =
    !siteHomeEntity.isLoading &&
    // @ts-ignore
    siteHomeEntity.data?.type === 'document'
      ? // @ts-ignore
        siteHomeEntity.data
      : null

  const documentTools = (
    <DocumentTools
      id={id}
      activeTab={activeMainPanel}
      existingDraft={existingDraft}
      commentsCount={interactionSummary.data?.comments || 0}
      collabsCount={collaborators?.filter((c) => c.role !== 'agent').length}
      directoryCount={directory.data?.length}
      rightActions={
        activeMainPanel != 'content' ? (
          <OpenInPanelButton
            id={id}
            panelRoute={routeToPanelRoute(route) ?? {key: activeMainPanel, id}}
          />
        ) : null
      }
    />
  )

  // Build main content based on activeMainPanel
  const renderMainContent = () => {
    switch (activeMainPanel) {
      case 'directory':
        return (
          <DirectoryPageContent
            docId={id}
            header={
              canCreate ? <NewSubDocumentButton locationId={id} /> : undefined
            }
            canCreate={canCreate}
            showTitle={false}
            contentMaxWidth={contentMaxWidth}
          />
        )
      case 'collaborators':
        return (
          <div
            className="mx-auto w-full px-4"
            style={{maxWidth: contentMaxWidth}}
          >
            <div className="flex flex-col gap-4 p-4">
              <AddCollaboratorForm id={id} />
              <ReadOnlyCollaboratorsContent docId={id} />
            </div>
          </div>
        )
      case 'activity': {
        const activityRoute = route as ActivityRoute
        return (
          <div
            className="mx-auto w-full px-4"
            style={{maxWidth: contentMaxWidth}}
          >
            <Feed
              size="md"
              centered
              filterResource={id.id}
              currentAccount={selectedAccount?.id.uid || ''}
              filterEventType={activityRoute.filterEventType || []}
              scrollRef={activityScrollRef}
            />
          </div>
        )
      }
      case 'discussions': {
        const discussionsRoute = route as DiscussionsRoute
        const commentEditor = (
          <CommentBox
            docId={id}
            commentId={discussionsRoute.openComment}
            quotingBlockId={discussionsRoute.targetBlockId}
            context="feed"
            autoFocus={discussionsRoute.autoFocus}
          />
        )
        return (
          <DiscussionsPageContent
            docId={id}
            openComment={discussionsRoute.openComment}
            targetBlockId={discussionsRoute.targetBlockId}
            blockId={discussionsRoute.blockId}
            blockRange={discussionsRoute.blockRange}
            autoFocus={discussionsRoute.autoFocus}
            isReplying={discussionsRoute.isReplying}
            commentEditor={commentEditor}
            targetDomain={targetDomain}
            onCommentDelete={onCommentDelete}
            deleteCommentDialogContent={deleteCommentDialogContent}
            showOpenInPanel={false}
            showTitle={false}
            contentMaxWidth={contentMaxWidth}
          />
        )
      }
      case 'content':
      default: {
        const docRoute =
          route.key === 'document' || route.key === 'feed' ? route : null
        return (
          <>
            <DocumentCover cover={document?.metadata.cover} />

            <div
              {...wrapperProps}
              className={cn(wrapperProps.className, 'flex')}
            >
              {showSidebars ? (
                <div
                  {...sidebarProps}
                  className={`${sidebarProps.className || ''} flex flex-col`}
                  style={{
                    ...sidebarProps.style,
                    marginTop: document?.metadata.cover ? 152 : 220,
                  }}
                >
                  <div className="hide-scrollbar flex h-full flex-col overflow-scroll">
                    <DocNavigation showCollapsed={showCollapsed} />
                  </div>
                </div>
              ) : null}

              <Container
                clearVerticalSpace
                {...mainContentProps}
                className={cn(
                  mainContentProps.className,
                  'base-doc-container relative sm:mr-10 sm:ml-0',
                )}
              >
                {isHomeDoc ? null : (
                  <DocPageHeader docId={id} document={document} />
                )}
                <div className="mt-4 mb-16 flex-1 pl-4 sm:pl-0">
                  {resource.data?.type === 'document' && docRoute ? (
                    <DocPageContent
                      docRoute={docRoute}
                      resource={resource.data}
                      isBlockFocused={isBlockFocused}
                    />
                  ) : null}
                </div>
              </Container>
              {showSidebars ? (
                <div
                  {...sidebarProps}
                  className={`${sidebarProps.className || ''} flex flex-col`}
                />
              ) : null}
            </div>
          </>
        )
      }
    }
  }

  return (
    <div className={cn(panelContainerStyles)}>
      <AppDocSiteHeader
        siteHomeEntity={siteHomeEntityData}
        docId={id}
        document={document}
        onScrollParamSet={onScrollParamSet}
        route={route}
      />
      <div className="relative">
        <div className="absolute top-4 right-4 z-10 flex items-center">
          {activeMainPanel == 'content' ? (
            <>
              <EditDocButton />
              <CreateDocumentButton locationId={id} />
            </>
          ) : null}
        </div>
        <div
          className="mx-auto flex w-full flex-col gap-4 px-4 py-4"
          style={{maxWidth: contentMaxWidth}}
        >
          <SizableText size="4xl" weight="bold">
            {isHomeDoc ? 'Home' : metadata?.name}
          </SizableText>
          {documentTools}
        </div>
      </div>

      <div
        className="relative flex flex-1 flex-col overflow-hidden"
        ref={elementRef}
      >
        <ScrollArea>{renderMainContent()}</ScrollArea>
      </div>
    </div>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

function _AppDocSiteHeader({
  siteHomeEntity,
  docId,
  document,
  onScrollParamSet,
  route,
}: {
  siteHomeEntity: HMResourceFetchResult | undefined | null
  docId: UnpackedHypermediaId
  document?: HMDocument
  onScrollParamSet: (isFrozen: boolean) => void
  route: DocumentPageRoute
}) {
  const replace = useNavigate('replace')
  const navItems = useSiteNavigationItems(siteHomeEntity)
  const notifyServiceHost = useNotifyServiceHost()
  const embeds = useDocumentEmbeds(document)

  // Scroll to blockRef when route changes (e.g., clicking embed in panel)
  // Only scroll when viewing document content, not directory/collaborators/etc
  useEffect(() => {
    if (route.key !== 'document' && route.key !== 'feed') return
    const blockRef = route.id?.blockRef
    if (blockRef) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        const element = window.document.getElementById(blockRef)
        if (element) {
          element.scrollIntoView({behavior: 'smooth', block: 'center'})
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [route.key, route.id?.blockRef])

  if (!siteHomeEntity) return null

  return (
    <SiteHeader
      siteHomeId={hmId(siteHomeEntity.id.uid)}
      items={navItems}
      docId={docId}
      isCenterLayout={
        siteHomeEntity.document?.metadata.theme?.headerLayout === 'Center' ||
        siteHomeEntity.document?.metadata.layout ===
          'Seed/Experimental/Newspaper'
      }
      document={document}
      siteHomeDocument={siteHomeEntity.document}
      embeds={embeds}
      onBlockFocus={(blockId) => {
        const element = window.document.getElementById(blockId)
        if (element) {
          element.scrollIntoView({behavior: 'smooth', block: 'center'})
        }

        replace({
          ...route,
          id: {...route.id, blockRef: blockId},
        } as DocumentPageRoute)
      }}
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
      isMainFeedVisible={route.key === 'feed'}
      notifyServiceHost={notifyServiceHost}
    />
  )
}

function DocPageHeader({
  docId,
  document,
}: {
  docId: UnpackedHypermediaId
  document?: HMDocument
}) {
  const authors = useMemo(() => document?.authors || [], [document])
  const authorIds = useMemo(() => authors?.map((a) => hmId(a)) || [], [authors])
  const authorResources = useResources(authorIds, {subscribed: true})
  const authorContacts = useContactsMetadata(authors || [])

  if (!document) return null

  const authorMetadata = authors
    .map((a, index) => {
      const contact = authorContacts[a]
      const resource = authorResources[index]
      const isDiscovering = resource?.isDiscovering
      // Use resource data if available, fall back to contacts.
      const metadata =
        resource?.data?.type === 'document'
          ? resource.data.document?.metadata
          : contact?.metadata
      if (!metadata && !isDiscovering) return null
      return {id: hmId(a), metadata, isDiscovering}
    })
    .filter((a) => a !== null)

  return (
    <DocumentHeader
      docId={docId}
      docMetadata={document.metadata}
      authors={authorMetadata}
      updateTime={document.updateTime}
      siteUrl={document.metadata.siteUrl}
      visibility={document.visibility}
      showTitle={false}
    />
  )
}

function DocErrorMessage({message}: {message: string}) {
  return (
    <div className={cn(panelContainerStyles)}>
      <div className="mx-auto px-8 py-10">
        <div className="border-destructive bg-destructive/10 flex w-full max-w-lg flex-none flex-col gap-4 rounded-lg border p-6 shadow-lg">
          <SizableText size="2xl" weight="bold" className="text-destructive">
            Error Loading Document
          </SizableText>
          <SizableText asChild className="text-destructive">
            <p>{message}</p>
          </SizableText>
        </div>
      </div>
    </div>
  )
}

function DocPageContent({
  resource,
  isBlockFocused,
  docRoute,
}: {
  resource: HMResource | null | undefined
  blockId?: string
  isBlockFocused: boolean
  docRoute: DocumentRoute | FeedRoute
}) {
  const navigate = useNavigate()
  const route = useNavRoute()
  const citations = useDocumentCitations(resource?.id)

  if (resource?.type !== 'document') {
    throw new Error('Invalid resource type')
  }
  const document = resource.document

  const reference = useDocumentUrl({docId: resource.id, isBlockFocused})

  return (
    <>
      <BlocksContentProvider
        resourceId={docRoute.id}
        blockCitations={useMemo(() => {
          if (!citations.data) return {}
          return calculateBlockCitations(citations.data)
        }, [citations.data])}
        onBlockCitationClick={(blockId) => {
          if (!docRoute) return
          navigate({
            ...docRoute,
            id: {
              ...docRoute.id,
              blockRef: blockId || null,
              blockRange: null,
            },
            panel: {
              key: 'discussions',
              id: docRoute.id,
              blockId: blockId || undefined,
            },
          })
        }}
        onBlockCommentClick={(blockId, blockRangeInput) => {
          if (route.key !== 'document') return
          if (!blockId) return
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
        }}
        onBlockSelect={
          reference
            ? useCallback(
                (
                  blockId: string,
                  blockRangeInput?: BlockRangeSelectOptions,
                ): boolean => {
                  const shouldCopy = blockRangeInput?.copyToClipboard !== false
                  if (blockId && reference && shouldCopy) {
                    reference.onCopy(
                      blockId,
                      blockRangeInput || {expanded: true},
                    )
                    return true
                  }
                  if (
                    route.key === 'document' &&
                    blockRangeInput?.copyToClipboard !== true
                  ) {
                    const element = window.document.getElementById(blockId)
                    if (element) {
                      element.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    }

                    navigate({
                      ...route,
                      id: {
                        ...route.id,
                        blockRef: blockId,
                        blockRange:
                          blockRangeInput &&
                          'start' in blockRangeInput &&
                          'end' in blockRangeInput
                            ? {
                                start: blockRangeInput.start,
                                end: blockRangeInput.end,
                              }
                            : null,
                      },
                    })
                    return true
                  }
                  return false
                },
                [route, navigate, reference],
              )
            : null
        }
      >
        <BlocksContent blocks={document.content} />
      </BlocksContentProvider>
      {reference?.content}
    </>
  )
}

function EditDocButton() {
  const route = useNavRoute()
  // Support all document-related route types
  const supportedKeys = [
    'document',
    'feed',
    'directory',
    'collaborators',
    'activity',
    'discussions',
  ]
  if (!supportedKeys.includes(route.key)) {
    throw new Error(
      'EditDocButton can only be rendered on document-related routes',
    )
  }
  const typedRoute = route as DocumentPageRoute
  const capability = useSelectedAccountCapability(typedRoute.id)
  const navigate = useNavigate()

  const existingDraft = useExistingDraft(route)

  const [popoverVisible, setPopoverVisible] = useState(false)

  useEffect(() => {
    editPopoverEvents.subscribe((visible) => {
      setPopoverVisible(visible)
    })
  }, [])

  const button = (
    <Button
      size="sm"
      variant={existingDraft ? undefined : 'ghost'}
      className={cn('mx-2 shadow-sm', existingDraft ? 'bg-yellow-200' : '')}
      onClick={() => {
        if (existingDraft) {
          navigate({
            key: 'draft',
            id: existingDraft.id,
            panel: null,
          })
        } else {
          navigate({
            key: 'draft',
            id: nanoid(10),
            editUid: typedRoute.id.uid,
            editPath: typedRoute.id.path || [],
            deps: typedRoute.id.version ? [typedRoute.id.version] : undefined,
            panel: null,
          })
        }
      }}
    >
      <Pencil className="size-4" />
      {existingDraft ? 'Resume Editing' : 'Edit'}
    </Button>
  )
  if (!roleCanWrite(capability?.role)) return null
  if (popoverVisible) {
    return (
      <>
        <div
          className="fixed top-0 left-0 z-40 flex h-screen w-screen bg-black opacity-50"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setPopoverVisible(false)
          }}
        />
        <Popover
          open={popoverVisible}
          onOpenChange={(val) => {
            console.log('== ~ onOpenChange ~ val:', val)
            setPopoverVisible(val)
          }}
        >
          <PopoverTrigger>{button}</PopoverTrigger>
          <PopoverContent>
            <div className="border-border bg-background absolute -top-2 right-9 h-4 w-4 rotate-45 border border-r-transparent border-b-transparent" />
            <div className="flex flex-col gap-2">
              <SizableText size="3xl" weight="bold">
                Start Editing the Content
              </SizableText>
              <SizableText>
                When you press "Edit" you can start customizing the content of
                the current page
              </SizableText>
            </div>
          </PopoverContent>
        </Popover>
      </>
    )
  }
  return (
    <>
      <Tooltip content={existingDraft ? 'Resume Editing' : 'Edit'}>
        {button}
      </Tooltip>
    </>
  )
}
