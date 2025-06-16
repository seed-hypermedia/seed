import {SizableText} from './text'
import {cn} from './utils'

interface DraftBadgeProps {
  className?: string
}

export function DraftBadge({className}: DraftBadgeProps) {
  return (
    <div
      className={cn(
        'self-center py-0 px-1.5 border border-yellow-500 rounded-md',
        className,
      )}
    >
      <SizableText size="xs" color="warning">
        Draft
      </SizableText>
    </div>
  )
}
