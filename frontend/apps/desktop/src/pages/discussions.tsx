import {AccessoryLayout} from '@/components/accessory-sidebar'
import {CommentBox, triggerCommentDraftFocus} from '@/components/commenting'
import {useDocumentSelection} from '@/components/document-accessory'
import {useAllDocumentCapabilities} from '@/models/access-control'
import {
  useDocumentEmbeds,
  useDocumentRead,
  useSiteNavigationItems,
} from '@/models/documents'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useChildrenActivity} from '@/models/library'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {useNavigate} from '@/utils/useNavigate'
import {
  DiscussionsRoute,
  getCommentTargetId,
  HMDocument,
  HMResourceFetchResult,
  hmId,
  PanelSelectionOptions,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
  useDeleteComment,
} from '@shm/shared/comments-service-provider'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useDeleteCommentDialog} from '@shm/ui/comments'
import {panelContainerStyles} from '@shm/ui/container'
import {DiscussionsPageContent} from '@shm/ui/discussions-page'
import {DocumentTools} from '@shm/ui/document-tools'
import {
  PageDiscovery,
  PageNotFound,
  PageRedirected,
} from '@shm/ui/page-message-states'
import {SiteHeader} from '@shm/ui/site-header'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import React, {useCallback, useEffect} from 'react'

export default function DiscussionsPage() {
  const route = useNavRoute()

  const docId: UnpackedHypermediaId | null =
    route.key === 'discussions' ? route.id : null
  if (!docId) throw new Error('Invalid route, no document id')
  if (route.key !== 'discussions')
    throw new Error('Invalid route, key is not discussions')

  useDocumentRead(docId)

  const panelKey = route.panel?.key as PanelSelectionOptions | undefined
  const replace = useNavigate('replace')
  const push = useNavigate('push')

  const {selectionUI} = useDocumentSelection({docId})

  return (
    <CommentsProvider
      useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
      onReplyClick={(replyComment) => {
        // For discussions page, stay on discussions page
        const targetId = getCommentTargetId(replyComment)
        const targetRoute = isRouteEqualToCommentTarget({
          id: route.id,
          comment: replyComment,
        })

        if (targetRoute) {
          // Comment is on a different document, navigate there
          push({
            key: 'discussions',
            id: targetRoute,
            openComment: replyComment.id,
            isReplying: true,
          })
        } else {
          // Same document, just update the route
          replace({
            ...route,
            openComment: replyComment.id,
            isReplying: true,
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
          push({
            key: 'discussions',
            id: targetRoute,
            openComment: replyComment.id,
          })
        } else {
          replace({
            ...route,
            openComment: replyComment.id,
          })
        }
      }}
    >
      <div className="flex h-full flex-1 flex-col">
        <AccessoryLayout panelUI={selectionUI} panelKey={panelKey}>
          <DiscussionsContent id={docId} route={route} />
        </AccessoryLayout>
      </div>
    </CommentsProvider>
  )
}

function _DiscussionsContent({
  id,
  route,
}: {
  id: UnpackedHypermediaId
  route: DiscussionsRoute
}) {
  const replace = useNavigate('replace')
  const navigate = useNavigate()

  // Data for DocumentTools
  const directory = useChildrenActivity(id)
  const {data: collaborators} = useAllDocumentCapabilities(id)
  const interactionSummary = useInteractionSummary(id)

  // Delete comment handling
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
    [id],
  )

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: 'discussions', id: account.data.id})
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'discussions', id: redirectTarget})
      }
    },
  })

  const siteHomeEntity = useResource(id.path?.length ? hmId(id.uid) : id, {
    subscribed: true,
    recursive: id.path?.length ? false : true,
  })

  const homeDoc = useResource(hmId(id.uid))
  const targetDomain =
    homeDoc.data?.type === 'document'
      ? homeDoc.data.document.metadata.siteUrl
      : undefined

  const document =
    // @ts-ignore
    resource.data?.type === 'document' ? resource.data.document : undefined

  if (resource.isInitialLoading) return null

  if (resource.data?.type === 'redirect') {
    return (
      <PageRedirected
        docId={id}
        redirectTarget={resource.data.redirectTarget}
        onNavigate={(target) => navigate({key: 'discussions', id: target})}
      />
    )
  }

  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return <PageDiscovery />
    }
    return <PageNotFound />
  }

  // Only pass siteHomeEntity if it's loaded and is a document type
  const siteHomeEntityData =
    !siteHomeEntity.isLoading &&
    // @ts-ignore
    siteHomeEntity.data?.type === 'document'
      ? // @ts-ignore
        siteHomeEntity.data
      : null

  const commentEditor = (
    <CommentBox
      docId={id}
      commentId={route.openComment}
      quotingBlockId={route.targetBlockId}
      context="feed"
      autoFocus={route.autoFocus}
    />
  )

  return (
    <div className={cn(panelContainerStyles)}>
      <DiscussionsSiteHeader
        siteHomeEntity={siteHomeEntityData}
        docId={id}
        document={document}
      />
      <DocumentTools
        id={id}
        activeTab={
          route.panel
            ? (route.panel.key as 'activity' | 'collaborators' | 'directory')
            : 'discussions'
        }
        commentsCount={interactionSummary.data?.comments || 0}
        collabsCount={collaborators?.filter((c) => c.role !== 'agent').length}
        directoryCount={directory.data?.length}
      />
      <DiscussionsPageContent
        docId={id}
        openComment={route.openComment}
        targetBlockId={route.targetBlockId}
        blockId={route.blockId}
        blockRange={route.blockRange}
        autoFocus={route.autoFocus}
        isReplying={route.isReplying}
        commentEditor={commentEditor}
        targetDomain={targetDomain}
        onCommentDelete={onCommentDelete}
        deleteCommentDialogContent={deleteCommentDialog.content}
      />
    </div>
  )
}

const DiscussionsContent = React.memo(_DiscussionsContent)
const DiscussionsSiteHeader = React.memo(_DiscussionsSiteHeader)

function _DiscussionsSiteHeader({
  siteHomeEntity,
  docId,
  document,
}: {
  siteHomeEntity: HMResourceFetchResult | undefined | null
  docId: UnpackedHypermediaId
  document?: HMDocument
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const navItems = useSiteNavigationItems(siteHomeEntity)
  const notifyServiceHost = useNotifyServiceHost()
  const embeds = useDocumentEmbeds(document)

  if (!siteHomeEntity) return null
  if (route.key !== 'discussions') return null

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
        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      onShowMobileMenu={() => {}}
      isMainFeedVisible={false}
      notifyServiceHost={notifyServiceHost}
    />
  )
}
