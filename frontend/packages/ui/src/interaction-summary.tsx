import {pluralS} from '@shm/shared/utils/language'
import {MessageSquare, Sparkle} from 'lucide-react'
import {Button} from './button'
import {Tooltip} from './tooltip'

export function DocInteractionSummary({
  isHome = false,
  isAccessoryOpen = false,
  commentsCount,
  onCommentsClick,
  onFeedClick,
}: {
  isHome: boolean
  isAccessoryOpen: boolean
  commentsCount: number
  onCommentsClick: () => void
  onFeedClick: () => void
}) {
  if (isAccessoryOpen) return null
  if (!isHome) return null
  return (
    <>
      <InteractionSummaryItem
        count={0}
        label="activity"
        pluralLabel="activities"
        onClick={onFeedClick}
        icon={<Sparkle className="size-3" color="currentColor" />}
      />

      <InteractionSummaryItem
        label="comment"
        count={commentsCount}
        onClick={onCommentsClick}
        icon={<MessageSquare className="size-3" />}
      />
    </>
  )
}

export function InteractionSummaryItem({
  label,
  pluralLabel,
  count,
  onClick,
  icon,
}: {
  label: string
  pluralLabel?: string
  count: number
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <Tooltip
      content={count ? `${count} ${pluralS(count, label, pluralLabel)}` : label}
    >
      <Button onClick={onClick} size="xs" className={'p-0'}>
        {icon}
        {count ? <span className="text-xs">{count}</span> : null}
      </Button>
    </Tooltip>
  )
}
