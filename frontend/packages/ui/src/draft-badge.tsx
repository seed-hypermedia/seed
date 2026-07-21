import {Badge} from './components/badge'
import {cn} from './utils'

interface DraftBadgeProps {
  className?: string
}

export function DraftBadge({className}: DraftBadgeProps) {
  return (
    <Badge variant="warning" className={cn('font-sans', className)}>
      Draft
    </Badge>
  )
}
