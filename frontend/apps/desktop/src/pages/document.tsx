import {AccessoryLayout} from '@/components/accessory-sidebar'
import {triggerCommentDraftFocus} from '@/components/commenting'
import {useDocumentUrl} from '@/components/copy-reference-button'
import {DocNavigation} from '@/components/doc-navigation'
import {useDocumentAccessory} from '@/components/document-accessory'
import {NotifSettingsDialog} from '@/components/email-notifs-dialog'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {useTemplateDialog} from '@/components/site-template'
import {DesktopActivityService} from '@/desktop-activity-service'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {
  roleCanWrite,
  useAllDocumentCapabilities,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDocumentCitations} from '@/models/citations'
import {useContactsMetadata} from '@/models/contacts'
import {
  useCreateDraft,
  useDocumentRead,
  usePushResource,
  useSiteNavigationItems,
} from '@/models/documents'
import {useAccount, useResource, useResources} from '@shm/shared/models/entity'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useInteractionSummary} from '@/models/interaction-summary'
import {useChildrenActivity} from '@/models/library'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import '@shm/editor/editor.css'
import {
  AccessoryOptions,
  DocumentRoute,
  HMDocument,
  HMResource,
  HMResourceFetchResult,
  UnpackedHypermediaId,
  calculateBlockCitations,
  commentIdToHmId,
  getCommentTargetId,
  hmId,
} from '@shm/shared'
import {ActivityProvider} from '@shm/shared/activity-service-provider'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
  useDeleteComment,
} from '@shm/shared/comments-service-provider'
import '@shm/shared/styles/document.css'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {
  BlockRangeSelectOptions,
  BlocksContent,
  BlocksContentProvider,
} from '@shm/ui/blocks-content'
import {Button, ButtonProps, Button as TWButton} from '@shm/ui/button'
import {useDeleteCommentDialog} from '@shm/ui/comments'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DocumentCover} from '@shm/ui/document-cover'
import {DocumentHeader} from '@shm/ui/document-header'
import {DocumentTools} from '@shm/ui/document-tools'
import {ArrowRight, MoreHorizontal} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {Separator as TSeparator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {FilePlus} from 'lucide-react'
import React, {ReactNode, useCallback, useEffect, useMemo, useRef} from 'react'

export default function DocumentPage() {
  const activityService = new DesktopActivityService()
  const route = useNavRoute()

  const docId = route.key == 'document' && route.id
  useDocumentRead(docId)
  if (!docId) throw new Error('Invalid route, no document id')

  const accessoryKey: AccessoryOptions | undefined = route.accessory?.key as
    | AccessoryOptions
    | undefined
  const replace = useNavigate('replace')
  const push = useNavigate('push')

  const notifyServiceHost = useNotifyServiceHost()
  const notifSettingsDialog = useAppDialog(NotifSettingsDialog)
  const immediatePromptNotifs =
    route.immediatelyPromptNotifs && !route.id?.path?.length

  const markPromptedKey = trpc.prompting.markPromptedKey.useMutation()

  useEffect(() => {
    if (immediatePromptNotifs && notifyServiceHost) {
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
  const templateDialogContent = useTemplateDialog(route)

  return (
    <>
      <ActivityProvider service={activityService}>
        <CommentsProvider
          useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
          onReplyClick={(replyComment) => {
            const targetRoute = isRouteEqualToCommentTarget({
              id: route.id,
              comment: replyComment,
            })

            if (targetRoute) {
              push({
                key: 'document',
                id: targetRoute,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            } else {
              console.log('targetRoute is the same. replacing...')
              replace({
                ...route,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            }
            triggerCommentDraftFocus(docId.id, replyComment.id)
          }}
          onReplyCountClick={(replyComment) => {
            const targetRoute = isRouteEqualToCommentTarget({
              id: route.id,
              comment: replyComment,
            })
            if (targetRoute) {
              // comment target is not the same as the route, so we need to change the whole route
              push({
                key: 'document',
                id: targetRoute,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            } else {
              // comment target is the same as the route, so we can replace safely
              replace({
                ...route,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            }
          }}
        >
          <DocumentPageContent
            docId={docId}
            route={route}
            replace={replace}
            push={push}
            mainPanelRef={mainPanelRef}
            accessoryKey={accessoryKey}
            templateDialogContent={templateDialogContent}
            notifSettingsDialogContent={notifSettingsDialog.content}
          />
        </CommentsProvider>
      </ActivityProvider>
    </>
  )
}

function DocumentPageContent({
  docId,
  route,
  replace,
  push,
  mainPanelRef,
  accessoryKey,
  templateDialogContent,
  notifSettingsDialogContent,
}: {
  docId: UnpackedHypermediaId
  route: any
  replace: any
  push: any
  mainPanelRef: React.RefObject<HTMLDivElement>
  accessoryKey: string | undefined
  templateDialogContent: ReactNode
  notifSettingsDialogContent: ReactNode
}) {
  const deleteComment = useDeleteComment()
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

  const {accessory, accessoryOptions} = useDocumentAccessory({
    docId,
    onCommentDelete,
    deleteCommentDialogContent: deleteCommentDialog.content,
    targetDomain,
  })

  return (
    <div className="flex h-full flex-1 flex-col">
      <AccessoryLayout
        mainPanelRef={mainPanelRef}
        accessory={accessory}
        accessoryKey={accessoryKey as any}
        onAccessorySelect={(key: AccessoryOptions | undefined) => {
          if (key === accessoryKey || key === undefined)
            return replace({...route, accessory: null})
          replace({...route, accessory: {key}})
        }}
        accessoryOptions={accessoryOptions}
      >
        <MainDocumentPage
          id={route.id}
          isBlockFocused={route.isBlockFocused || false}
          onScrollParamSet={useCallback((isFrozen) => {
            mainPanelRef.current?.style.setProperty(
              'overflow',
              isFrozen ? 'hidden' : 'auto',
            )
          }, [])}
          isCommentingPanelOpen={route.accessory?.key === 'activity'}
          onAccessory={useCallback(
            (accessory) => {
              replace({...route, accessory})
            },
            [route, replace],
          )}
        />
      </AccessoryLayout>
      {templateDialogContent}
      {notifSettingsDialogContent}
    </div>
  )
}

function _MainDocumentPage({
  id,
  isBlockFocused,
  onScrollParamSet,
}: {
  id: UnpackedHypermediaId
  isBlockFocused: boolean
  onScrollParamSet: (isFrozen: boolean) => void
  isCommentingPanelOpen: boolean
  onAccessory: (accessory: DocumentRoute['accessory']) => void
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const docRoute = route.key === 'document' ? route : null
  if (!docRoute) throw new Error('MainDocumentPage must have document route')
  const account = useAccount(id.uid, {enabled: !id.path?.length})

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: 'document', id: account.data.id})
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'document', id: redirectTarget})
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
          accessory: {key: 'discussions', openComment: comment.id},
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
  } = useDocumentLayout({
    contentWidth: metadata?.contentWidth,
    showSidebars: showSidebarOutlineDirectory,
  })

  const directory = useChildrenActivity(id)

  const {data: collaborators} = useAllDocumentCapabilities(docId)

  const interactionSummary = useInteractionSummary(docId)

  const onCommentsClick = useCallback(() => {
    replace({...route, accessory: {key: 'discussions'}} as DocumentRoute)
  }, [])

  const onFeedClick = useCallback(() => {
    replace({...route, accessory: {key: 'activity'}} as DocumentRoute)
  }, [])

  if (route.key != 'document' && route.key != 'feed') return null

  // @ts-ignore
  if (resource.isInitialLoading) return null

  // @ts-ignore
  if (resource.data?.type === 'redirect') {
    return (
      // @ts-ignore
      <DocRedirected docId={id} redirectTarget={resource.data.redirectTarget} />
    )
  }

  // @ts-ignore
  if (resource.data?.type === 'not-found') {
    return <DocDiscovery />
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
      activePanel={
        route.accessory &&
        route.accessory.key != 'options' &&
        route.accessory.key != 'contacts'
          ? route.accessory.key
          : undefined
      }
      commentsCount={interactionSummary.data?.comments || 0}
      onCommentsClick={onCommentsClick}
      onFeedClick={onFeedClick}
      collabsCount={collaborators?.length}
      directoryCount={directory.data?.length}
      onDirectoryClick={() => {
        replace({...route, accessory: {key: 'directory'}} as DocumentRoute)
      }}
      onCollabsClick={() => {
        replace({...route, accessory: {key: 'collaborators'}} as DocumentRoute)
      }}
    />
  )

  return (
    <div className={cn(panelContainerStyles)}>
      <AppDocSiteHeader
        siteHomeEntity={siteHomeEntityData}
        docId={id}
        document={document}
        onScrollParamSet={onScrollParamSet}
      />
      <div
        className="relative flex flex-1 flex-col overflow-hidden"
        ref={elementRef}
      >
        {/* <div className="flex absolute top-2 right-2 z-40 items-center bg-white rounded-md shadow-md dark:bg-background">
          <DocInteractionSummary
            isHome={isHomeDoc}
            isAccessoryOpen={!!route.accessory}
            commentsCount={interactionSummary.data?.comments || 0}
            onCommentsClick={onCommentsClick}
            onFeedClick={onFeedClick}
          />
        </div> */}
        <ScrollArea>
          <DocumentCover cover={document?.metadata.cover} />
          {isHomeDoc ? documentTools : null}
          <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
            {showSidebars ? (
              <div
                {...sidebarProps}
                className={`${sidebarProps.className || ''} flex flex-col`}
                style={{
                  ...sidebarProps.style,
                  marginTop: document?.metadata.cover ? 152 : 220,
                }}
              >
                <div
                  className="hide-scrollbar flex h-full flex-col overflow-scroll"
                  // paddingVertical="$4"
                >
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
                <DocPageHeader
                  docId={id}
                  document={document}
                  documentTools={documentTools}
                />
              )}
              <div className="mt-4 mb-16 flex-1 pl-4 sm:pl-0">
                {resource.data?.type === 'document' ? (
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
        </ScrollArea>
      </div>
    </div>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

function _AppDocSiteHeader({
  siteHomeEntity,
  docId,
  children,
  document,
  supportDocuments,
  onScrollParamSet,
}: {
  siteHomeEntity: HMResourceFetchResult | undefined | null
  docId: UnpackedHypermediaId
  children?: React.ReactNode
  document?: HMDocument
  supportDocuments?: HMResourceFetchResult[]
  onScrollParamSet: (isFrozen: boolean) => void
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const navItems = useSiteNavigationItems(siteHomeEntity)
  const notifyServiceHost = useNotifyServiceHost()

  if (!siteHomeEntity) return null
  if (route.key !== 'document' && route.key != 'feed') return null

  // Prepare supportDocuments with siteHomeEntity that has the latest flag set
  const supportDocsWithHome = [
    ...(supportDocuments || []),
    {
      ...siteHomeEntity,
      id: {...siteHomeEntity.id, latest: true},
    },
  ]

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
      onBlockFocus={(blockId) => {
        const element = window.document.getElementById(blockId)
        if (element) {
          element.scrollIntoView({behavior: 'smooth', block: 'center'})
        }

        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      supportDocuments={supportDocsWithHome}
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
      isMainFeedVisible={route.key == 'feed'}
      notifyServiceHost={notifyServiceHost}
    />
  )
}

export function NewSubDocumentButton({
  locationId,
  size = 'sm',
  importDropdown = true,
}: {
  locationId: UnpackedHypermediaId
  importDropdown?: boolean
  size?: ButtonProps['size']
}) {
  const capability = useSelectedAccountCapability(locationId)
  const canEditDoc = roleCanWrite(capability?.role)
  const createDraft = useCreateDraft({
    locationUid: locationId.uid,
    locationPath: locationId.path || undefined,
  })
  if (!canEditDoc) return null
  return (
    <>
      <Tooltip content="Create a new document">
        <TWButton
          size={size}
          variant="default"
          className="w-full"
          onClick={createDraft}
        >
          <FilePlus className="size-4" />
          Create
        </TWButton>
      </Tooltip>
      {importDropdown && (
        <ImportDropdownButton
          id={locationId}
          button={
            <Button size="icon">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
      )}
    </>
  )
}

function DocPageHeader({
  docId,
  document,
  documentTools,
}: {
  docId: UnpackedHypermediaId
  document?: HMDocument
  // TODO: fix proper types
  documentTools?: any
}) {
  const authors = useMemo(() => document?.authors || [], [document])
  useResources(
    authors?.map((a) => hmId(a)) || [],
    {subscribed: true},
  )
  const authorContacts = useContactsMetadata(authors || [])

  if (!document) return null

  const authorMetadata = authors
    .map((a) => {
      const contact = authorContacts[a]
      if (!contact) return null
      return {id: hmId(a), metadata: contact.metadata}
    })
    .filter((a) => a !== null)

  return (
    <DocumentHeader
      docId={docId}
      docMetadata={document.metadata}
      authors={authorMetadata}
      updateTime={document.updateTime}
      siteUrl={document.metadata.siteUrl}
      documentTools={documentTools}
    />
  )
}

function DocRedirected({
  docId,
  redirectTarget,
}: {
  docId: UnpackedHypermediaId
  redirectTarget: UnpackedHypermediaId
}) {
  const navigate = useNavigate()
  return (
    <DocMessageBox
      title="Redirected"
      message="This document has been redirected to a new location."
      children={
        <Button
          onClick={() => {
            navigate({key: 'document', id: redirectTarget})
          }}
        >
          <ArrowRight className="size-4" />
          Go to New Location
        </Button>
      }
    />
  )
}

function DocMessageBox({
  title,
  message,
  children,
  spinner,
}: {
  title: string
  message: string
  children?: ReactNode
  spinner?: boolean
}) {
  return (
    <div className={cn(panelContainerStyles)}>
      <div className="mx-auto px-8 py-10">
        <div className="border-border bg-background flex w-full max-w-lg flex-none flex-col gap-4 rounded-lg border p-6 shadow-lg dark:bg-black">
          {spinner ? (
            <div className="flex items-center justify-start">
              <Spinner className="fill-link size-6" />
            </div>
          ) : null}
          <SizableText size="2xl" weight="bold">
            {title}
          </SizableText>

          <SizableText asChild className="text-muted-foreground">
            <p>{message}</p>
          </SizableText>
          {children}
        </div>
      </div>
    </div>
  )
}
function DocDiscovery() {
  return (
    <DocMessageBox
      title="Looking for this document..."
      spinner
      message="This document is not on your node yet. Now finding a peer who can provide it."
    />
  )
}
const Separator = () => <TSeparator vertical />

function SiteURLButton({siteUrl}: {siteUrl?: string}) {
  const open = useOpenUrl()
  if (!siteUrl) return null
  return (
    <SizableText
      size="sm"
      className="underline-transparent hover:underline"
      onClick={() => {
        open(siteUrl)
      }}
    >
      {siteUrl}
    </SizableText>
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
  docRoute: DocumentRoute
}) {
  const replace = useNavigate('replace')
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
          replace({
            ...docRoute,
            id: {
              ...docRoute.id,
              blockRef: blockId || null,
              blockRange: null,
            },
            accessory: {
              key: 'discussions',
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
          replace({
            ...route,
            id: {
              ...route.id,
              blockRef: blockId,
              blockRange,
            },
            accessory: {
              key: 'discussions',
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

                    replace({
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
                [route, replace, reference],
              )
            : null
        }
      >
        <BlocksContent
          blocks={document.content}
          // focusBlockId={isBlockFocused ? docRoute.id.blockRef || undefined : undefined}
        />
      </BlocksContentProvider>
      {reference?.content}
    </>
  )
}
