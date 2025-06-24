import {Badge} from './components/badge'

interface DraftBadgeProps {
  className?: string
}

export function DraftBadge({className}: DraftBadgeProps) {
  return (
    <Badge variant="warning" className={className}>
      Draft
    </Badge>
  )
}
