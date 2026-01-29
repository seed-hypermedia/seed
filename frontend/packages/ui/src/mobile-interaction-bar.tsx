import {hmId, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {ReactNode} from 'react'
import {UIAvatar} from './avatar'
import {Button, ButtonLink} from './button'
import {HMIcon} from './hm-icon'
import {cn} from './utils'
import {HistoryIcon, MessageSquare} from 'lucide-react'

// Import avatar placeholder
import avatarPlaceholder from '@shm/editor/assets/avatar.png'

export interface MobileInteractionBarProps {
  /** Document ID for feed link */
  docId: UnpackedHypermediaId
  /** Comment count to display */
  commentsCount: number
  /** Callback when comments button is clicked */
  onCommentsClick: () => void
  /** Current user account (null if not logged in) */
  account?: {
    id: UnpackedHypermediaId
    metadata?: {name?: string; icon?: string}
  } | null
  /** Callback for avatar click (e.g., to open account creation) */
  onAvatarClick?: () => void
  /** Additional content to render (e.g., account creation dialog) */
  extraContent?: ReactNode
  /** Class name for hiding the bar (auto-hide on scroll) */
  hideClassName?: string
}

export function MobileInteractionBar({
  docId,
  commentsCount,
  onCommentsClick,
  account,
  onAvatarClick,
  extraContent,
  hideClassName,
}: MobileInteractionBarProps) {
  const avatarLinkProps = useRouteLink(
    account?.id
      ? {
          key: 'profile',
          id: hmId(account.id.uid, {latest: true}),
        }
      : null,
  )

  const feedLinkProps = useRouteLink({
    key: 'feed',
    id: hmId(docId.uid),
  })

  return (
    <>
      <div
        className={cn(
          'dark:bg-background border-sidebar-border fixed right-0 bottom-0 left-0 z-40 flex items-center justify-between rounded-t-md border bg-white p-2',
          'transition-all duration-200',
          hideClassName,
        )}
        style={{
          boxShadow: '0px -16px 40px 8px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {/* Avatar / Profile Button */}
        <Button
          variant="ghost"
          className="min-w-20 shrink-0 cursor-pointer"
          {...(onAvatarClick ? {onClick: onAvatarClick} : avatarLinkProps)}
        >
          {account?.id ? (
            <HMIcon
              id={account.id}
              name={account.metadata?.name}
              icon={account.metadata?.icon}
              size={32}
            />
          ) : (
            <UIAvatar
              url={avatarPlaceholder}
              size={32}
              className="rounded-full"
            />
          )}
        </Button>

        {/* Feed Button */}
        <ButtonLink variant="ghost" {...feedLinkProps}>
          <HistoryIcon className="text-muted-foreground size-4" />
        </ButtonLink>

        {/* Comments Button */}
        <Button
          variant="ghost"
          className="min-w-20 shrink-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            onCommentsClick()
          }}
          onMouseEnter={() => {
            // Prefetch discussions panel and feed on hover
            import('./discussions-page').catch(() => {})
            import('./feed').catch(() => {})
          }}
        >
          <MessageSquare className="size-4 opacity-50" />
          {commentsCount ? (
            <span className="text-xs opacity-50">{commentsCount}</span>
          ) : null}
        </Button>
      </div>
      {extraContent}
    </>
  )
}
