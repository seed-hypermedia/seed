import {AccessoryLayout} from '@/components/accessory-sidebar'
import {CommentBox, triggerCommentDraftFocus} from '@/components/commenting'
import {useDocumentAccessory} from '@/components/document-accessory'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {DesktopActivityService} from '@/desktop-activity-service'
import {DesktopCommentsService} from '@/desktop-comments-service'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {
  useCreateDraft,
  useDocumentRead,
  useSiteNavigationItems,
} from '@/models/documents'
import {useSubscribedResource} from '@/models/entities'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccount} from '@/selected-account'
import {useScrollRestoration} from '@/utils/use-scroll-restoration'
import {useNavigate} from '@/utils/useNavigate'
import '@shm/editor/editor.css'
import {
  DocumentRoute,
  FeedRoute,
  getCommentTargetId,
  HMDocument,
  HMEntityContent,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {ActivityProvider} from '@shm/shared/activity-service-provider'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {useAccount} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button, ButtonProps, Button as TWButton} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {Feed} from '@shm/ui/feed'
import {ArrowRight, MoreHorizontal} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {Separator as TSeparator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {FilePlus} from 'lucide-react'
import React, {ReactNode, useCallback, useEffect, useRef} from 'react'
import {AppDocContentProvider} from './document-content-provider'

export default function FeedPage() {
  const commentsService = new DesktopCommentsService()
  const activityService = new DesktopActivityService()
  const route = useNavRoute()

  const docId: UnpackedHypermediaId | null =
    route.key == 'feed' ? route.id : null
  if (!docId) throw new Error('Invalid route, no document id')
  if (route.key != 'feed') throw new Error('Invalid route, key is not feed')

  const homeId = hmId(docId?.uid)

  useDocumentRead(docId)

  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')
  const push = useNavigate('push')

  const {accessory, accessoryOptions} = useDocumentAccessory({docId})

  const mainPanelRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <ActivityProvider service={activityService}>
        <CommentsProvider
          service={commentsService}
          onReplyClick={(replyComment) => {
            const targetRoute = isRouteEqualToCommentTarget({
              id: route.id,
              comment: replyComment,
            })

            if (targetRoute) {
              push({
                key: route.key,
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
                key: route.key,
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
          <div className="flex h-full flex-1 flex-col">
            <AccessoryLayout
              mainPanelRef={mainPanelRef}
              accessory={accessory}
              accessoryKey={accessoryKey}
              onAccessorySelect={(key: typeof accessoryKey) => {
                if (key === accessoryKey || key === undefined)
                  return replace({...route, accessory: null})
                replace({...route, accessory: {key}})
              }}
              accessoryOptions={accessoryOptions}
            >
              <FeedContent
                id={homeId}
                route={route}
                isBlockFocused={false}
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
          </div>
        </CommentsProvider>
      </ActivityProvider>
    </>
  )
}

function _FeedContent({
  id,
  isBlockFocused,
  onScrollParamSet,
  route,
}: {
  id: UnpackedHypermediaId
  isBlockFocused: boolean
  onScrollParamSet: (isFrozen: boolean) => void
  isCommentingPanelOpen: boolean
  onAccessory: (accessory: DocumentRoute['accessory']) => void
  route: DocumentRoute | FeedRoute
}) {
  const replace = useNavigate('replace')

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  const homeId = hmId(id.uid)

  const selectedAccount = useSelectedAccount()

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: route.key, id: account.data.id})
    }
  }, [account.data])

  const resource = useSubscribedResource(
    id,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    true,
    ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: route.key, id: redirectTarget})
      }
    },
  )
  const loadedCommentResource =
    // @ts-ignore
    resource.data?.type == 'comment' ? resource.data : undefined
  useEffect(() => {
    if (loadedCommentResource) {
      const comment = loadedCommentResource.comment
      const targetDocId = getCommentTargetId(comment)
      if (targetDocId) {
        replace({
          key: route.key,
          id: targetDocId,
          accessory: {key: 'discussions', openComment: comment.id},
        })
      }
    }
  }, [loadedCommentResource])

  const siteHomeEntity = useSubscribedResource(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId(id.uid) : id,
    // otherwise, create an ID with the latest version of the home document

    id.path?.length ? false : true, // avoiding redundant subscription if the doc is not the home document
  )

  const document =
    // @ts-ignore
    resource.data?.type == 'document' ? resource.data.document : undefined
  const metadata = document?.metadata
  // IMPORTANT: Always call hooks at the top level, before any early returns
  // This ensures hooks are called in the same order on every render

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    wrapperProps,
  } = useDocumentLayout({
    contentWidth: metadata?.contentWidth,
    showSidebars: false,
  })

  const scrollRef = useScrollRestoration('feed-scroll')

  if (resource.isInitialLoading) return null

  if (resource.data?.type === 'redirect') {
    return (
      <DocRedirected docId={id} redirectTarget={resource.data.redirectTarget} />
    )
  }

  if (resource.data?.type === 'not-found') {
    return <DocDiscovery />
  }

  if (loadedCommentResource) {
    return null
  }
  return (
    <div className={cn(panelContainerStyles)}>
      <AppDocSiteHeader
        // @ts-ignore
        siteHomeEntity={siteHomeEntity.data}
        docId={id}
        document={document}
        supportDocuments={[]} // todo: handle embeds for outline!!
        onScrollParamSet={onScrollParamSet}
      />
      <div
        className="relative flex flex-1 flex-col overflow-hidden"
        ref={elementRef}
      >
        <ScrollArea ref={scrollRef}>
          <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
            {showSidebars ? (
              <div
                {...sidebarProps}
                className={`${sidebarProps.className || ''} flex flex-col`}
              />
            ) : null}

            <Container
              clearVerticalSpace
              {...mainContentProps}
              className={cn(
                mainContentProps.className,
                'base-doc-container relative mt-5 gap-4 sm:mr-10 sm:ml-0',
              )}
            >
              <Text weight="bold" size="3xl">
                What's New
              </Text>
              <TSeparator />

              <AppDocContentProvider
                comment
                routeParams={{
                  uid: homeId.uid,
                }}
                textUnit={14}
                layoutUnit={16}
              >
                <Feed
                  commentEditor={
                    homeId ? <CommentBox docId={homeId} context="feed" /> : null
                  }
                  filterResource={`${homeId.id}*`}
                  currentAccount={selectedAccount?.id.uid || ''}
                />
              </AppDocContentProvider>
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
const FeedContent = React.memo(_FeedContent)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

function _AppDocSiteHeader({
  siteHomeEntity,
  docId,
  children,
  document,
  supportDocuments,
  onScrollParamSet,
}: {
  siteHomeEntity: HMEntityContent | undefined | null
  docId: UnpackedHypermediaId
  children?: React.ReactNode
  document?: HMDocument
  supportDocuments?: HMEntityContent[]
  onScrollParamSet: (isFrozen: boolean) => void
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const navItems = useSiteNavigationItems(siteHomeEntity)
  const notifyServiceHost = useNotifyServiceHost()
  if (!siteHomeEntity) return null
  if (route.key != 'document' && route.key != 'feed') return null
  return (
    <SiteHeader
      originHomeId={hmId(siteHomeEntity.id.uid)}
      items={navItems}
      docId={docId}
      isCenterLayout={
        siteHomeEntity.document?.metadata.theme?.headerLayout === 'Center' ||
        siteHomeEntity.document?.metadata.layout ===
          'Seed/Experimental/Newspaper'
      }
      document={document}
      onBlockFocus={(blockId) => {
        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      supportDocuments={[...(supportDocuments || []), siteHomeEntity]}
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
      isMainFeedVisible={route.key == 'feed'}
      handleToggleFeed={() => {
        replace({
          ...route,
          key: route.key == 'document' ? 'feed' : 'document',
          accessory: route.key == 'document' ? null : route.accessory,
        })
      }}
      notifyServiceHost={notifyServiceHost.data}
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
              <Spinner className="size-6 fill-blue-500" />
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
