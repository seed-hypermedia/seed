import {AccessoryLayout} from '@/components/accessory-sidebar'
import {CommentBox, triggerCommentDraftFocus} from '@/components/commenting'
import {useDocumentSelection} from '@/components/document-accessory'
import {
  useDocumentEmbeds,
  useDocumentRead,
  useSiteNavigationItems,
} from '@/models/documents'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useSelectedAccount} from '@/selected-account'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {useNavigate} from '@/utils/useNavigate'
import '@shm/editor/editor.css'
import {
  DocumentRoute,
  FeedRoute,
  getCommentTargetId,
  HMDocument,
  hmId,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
  useDeleteComment,
} from '@shm/shared/comments-service-provider'
import {useAccount, useResource} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {useDeleteCommentDialog} from '@shm/ui/comments'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {Feed} from '@shm/ui/feed'
import {useDocumentLayout} from '@shm/ui/layout'
import {
  PageDiscovery,
  PageNotFound,
  PageRedirected,
} from '@shm/ui/page-message-states'
import {Separator as TSeparator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {cn} from '@shm/ui/utils'
import React, {useCallback, useEffect, useRef} from 'react'

export default function FeedPage() {
  const route = useNavRoute()

  const docId: UnpackedHypermediaId | null =
    route.key == 'feed' ? route.id : null
  if (!docId) throw new Error('Invalid route, no document id')
  if (route.key != 'feed') throw new Error('Invalid route, key is not feed')

  const homeId = hmId(docId?.uid)

  useDocumentRead(docId)

  const panelKey = route.panel?.key
  const replace = useNavigate('replace')
  const push = useNavigate('push')

  const {selectionUI, selectionOptions} = useDocumentSelection({docId})

  const mainPanelRef = useRef<HTMLDivElement>(null)

  return (
    <CommentsProvider
      useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
      onReplyClick={(replyComment) => {
        const targetRoute = isRouteEqualToCommentTarget({
          id: route.id,
          comment: replyComment,
        })

        if (targetRoute) {
          push({
            key: route.key,
            id: targetRoute,
            panel: {
              key: 'discussions',
              id: targetRoute,
              openComment: replyComment.id,
              isReplying: true,
            },
          })
        } else {
          console.log('targetRoute is the same. replacing...')
          replace({
            ...route,
            panel: {
              key: 'discussions',
              id: route.id,
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
            ...route,
            panel: {
              key: 'discussions',
              id: route.id,
              openComment: replyComment.id,
              isReplying: true,
            },
          })
        }
      }}
    >
      <div className="flex h-full flex-1 flex-col">
        <AccessoryLayout panelUI={selectionUI} panelKey={panelKey}>
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
            isCommentingPanelOpen={route.panel?.key === 'activity'}
            onSelection={useCallback(
              (panel) => {
                replace({...route, panel})
              },
              [route, replace],
            )}
          />
        </AccessoryLayout>
      </div>
    </CommentsProvider>
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
  onSelection: (selection: DocumentRoute['panel']) => void
  route: DocumentRoute | FeedRoute
}) {
  const replace = useNavigate('replace')

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  const homeId = hmId(id.uid)

  const selectedAccount = useSelectedAccount()

  const deleteComment = useDeleteComment()
  const deleteCommentDialog = useDeleteCommentDialog()

  const onCommentDelete = useCallback(
    (commentId: string, signingAccountId?: string) => {
      if (!signingAccountId) return
      deleteCommentDialog.open({
        onConfirm: () => {
          deleteComment.mutate({
            commentId,
            targetDocId: id,
            signingAccountId,
          })
        },
      })
    },
    [id, selectedAccount?.id?.uid, deleteComment, deleteCommentDialog],
  )

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: route.key, id: account.data.id})
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: route.key, id: redirectTarget})
      }
    },
  })
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
    resource.data?.type == 'document' ? resource.data.document : undefined
  const metadata = document?.metadata

  const targetDomain =
    siteHomeEntity.data?.type === 'document'
      ? siteHomeEntity.data.document.metadata.siteUrl
      : undefined
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

  const feedRoute = useNavRoute()
  const scrollRef = useScrollRestoration({
    scrollId: `feed-scroll:${id.id}`,
    getStorageKey: () => getRouteKey(feedRoute),
    debug: false,
  })

  if (resource.isInitialLoading) return null

  if (resource.data?.type === 'redirect') {
    return (
      <PageRedirected
        docId={id}
        redirectTarget={resource.data.redirectTarget}
        onNavigate={(target) => replace({key: route.key, id: target})}
      />
    )
  }

  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return <PageDiscovery />
    }
    return <PageNotFound />
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

              {deleteCommentDialog.content}
              <Feed
                commentEditor={
                  homeId ? <CommentBox docId={homeId} context="feed" /> : null
                }
                filterResource={`${homeId.id}*`}
                currentAccount={selectedAccount?.id.uid || ''}
                onCommentDelete={onCommentDelete}
                targetDomain={targetDomain}
              />
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
  document,
  onScrollParamSet,
}: {
  siteHomeEntity: HMResourceFetchResult | undefined | null
  docId: UnpackedHypermediaId
  document?: HMDocument
  onScrollParamSet: (isFrozen: boolean) => void
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const navItems = useSiteNavigationItems(siteHomeEntity)
  const notifyServiceHost = useNotifyServiceHost()
  const embeds = useDocumentEmbeds(document)
  if (!siteHomeEntity) return null
  if (route.key != 'document' && route.key != 'feed') return null
  return (
    <SiteHeader
      siteHomeId={siteHomeEntity.id}
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
        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
      isMainFeedVisible={route.key == 'feed'}
      notifyServiceHost={notifyServiceHost}
    />
  )
}
