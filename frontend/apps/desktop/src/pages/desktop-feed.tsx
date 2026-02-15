import {triggerCommentDraftFocus} from '@/components/commenting'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useSelectedAccount} from '@/selected-account'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMComment} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {displayHostname} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {FeedPage} from '@shm/ui/feed-page-common'
import {Link} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {useCallback, useMemo} from 'react'

export default function DesktopFeedPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const replace = useNavigate('replace')

  if (route.key !== 'feed') throw new Error('Not a feed route')
  const docId = route.id

  const selectedAccount = useSelectedAccount()

  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const siteHomeResource = useResource(hmId(docId.uid), {subscribed: true})
  const siteUrl =
    siteHomeResource.data?.type === 'document'
      ? siteHomeResource.data.document?.metadata?.siteUrl
      : undefined

  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
    siteUrl ? hmId(docId.uid) : undefined,
  )

  const menuItems: MenuItemType[] = useMemo(() => {
    const items: MenuItemType[] = []
    if (siteUrl) {
      items.push({
        key: 'link-site',
        label: `Copy ${displayHostname(siteUrl)} Link`,
        icon: <Link className="size-4" />,
        onClick: () => onCopySiteUrl(route),
      })
    }
    items.push({
      key: 'link',
      label: `Copy ${displayHostname(gwUrl)} Link`,
      icon: <Link className="size-4" />,
      onClick: () => onCopyGateway(route),
    })
    return items
  }, [siteUrl, gwUrl, route, onCopySiteUrl, onCopyGateway])

  const onReplyClick = useCallback(
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
            key: 'discussions',
            id: targetRoute,
            openComment: replyComment.id,
            isReplying: true,
          },
        })
      } else {
        replace({
          ...route,
          panel: {
            key: 'discussions',
            id: docId,
            openComment: replyComment.id,
            isReplying: true,
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
            key: 'discussions',
            id: targetRoute,
            openComment: replyComment.id,
          },
        })
      } else {
        replace({
          ...route,
          panel: {
            key: 'discussions',
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
      >
        <FeedPage
          docId={docId}
          extraMenuItems={menuItems}
          currentAccountUid={selectedAccount?.id?.uid}
        />
      </CommentsProvider>
      {copyGatewayContent}
      {copySiteUrlContent}
    </div>
  )
}
