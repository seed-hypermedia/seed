import {renderDesktopInlineEditor, triggerCommentDraftFocus} from '@/components/commenting'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {DesktopDocumentActionsProvider} from '@/components/document-actions-provider'
import {JoinButton} from '@/components/join-button'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {useNavigate} from '@/utils/useNavigate'
import {hmId, useUniversalAppContext} from '@shm/shared'
import {CommentsProvider, isRouteEqualToCommentTarget} from '@shm/shared/comments-service-provider'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMComment} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {displayHostname, hmIdToURL} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {createCopyLinkMenuItem} from '@shm/ui/copy-link-menu'
import {FeedPage} from '@shm/ui/feed-page-common'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {useCallback, useMemo} from 'react'

export default function DesktopFeedPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const experiments = useUniversalAppContext().experiments

  if (route.key !== 'feed') throw new Error('Not a feed route')
  const docId = route.id

  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const siteHomeResource = useResource(hmId(docId.uid), {subscribed: true})
  const siteUrl =
    siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document?.metadata?.siteUrl : undefined

  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
    siteUrl ? hmId(docId.uid) : undefined,
  )

  const menuItems: MenuItemType[] = useMemo(() => {
    return [
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
    ]
  }, [siteUrl, gwUrl, route, onCopySiteUrl, onCopyGateway, experiments?.advancedCopyLinkOptions, docId])

  const onReplyClick = useCallback(
    (replyComment: HMComment) => {
      const replyVersionData = {
        replyCommentVersion: replyComment.version,
        rootReplyCommentVersion: replyComment.threadRootVersion || replyComment.version,
      }
      const targetRoute = isRouteEqualToCommentTarget({
        id: docId,
        comment: replyComment,
      })
      if (targetRoute) {
        navigate({
          key: route.key,
          id: targetRoute,
          panel: {
            key: 'comments',
            id: targetRoute,
            openComment: replyComment.id,
            isReplying: true,
            ...replyVersionData,
          },
        })
      } else {
        replace({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
            isReplying: true,
            ...replyVersionData,
          },
        })
      }
      triggerCommentDraftFocus(docId.id, replyComment.id)
    },
    [route, docId, navigate, replace],
  )

  const onReplyCountClick = useCallback(
    (replyComment: HMComment) => {
      const targetRoute = isRouteEqualToCommentTarget({
        id: docId,
        comment: replyComment,
      })
      if (targetRoute) {
        navigate({
          key: route.key,
          id: targetRoute,
          panel: {
            key: 'comments',
            id: targetRoute,
            openComment: replyComment.id,
          },
        })
      } else {
        replace({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
          },
        })
      }
    },
    [route, docId, navigate, replace],
  )

  return (
    <div className="h-full max-h-full overflow-hidden rounded-lg border bg-white">
      <CommentsProvider
        useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
        renderInlineEditor={renderDesktopInlineEditor}
        showDeletedContent
      >
        <DesktopDocumentActionsProvider>
          <FeedPage docId={docId} extraMenuItems={menuItems} rightActions={<JoinButton siteUid={docId.uid} />} />
        </DesktopDocumentActionsProvider>
      </CommentsProvider>
      {copyGatewayContent}
      {copySiteUrlContent}
    </div>
  )
}
