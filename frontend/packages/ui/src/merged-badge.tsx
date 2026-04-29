import {Merge} from 'lucide-react'
import {Badge} from './components/badge'
import {cn} from './utils'

export function MergedBadge({count, size = 'md', className}: {count: number; size?: 'sm' | 'md'; className?: string}) {
  if (count <= 1) return null
  return (
    <Badge
      variant="outline"
      className={cn('text-muted-foreground gap-0.5', size === 'sm' ? 'text-[10px]' : 'text-xs', className)}
    >
      <Merge size={size === 'sm' ? 10 : 12} strokeWidth={2} />
      Merged · {count} versions
    </Badge>
  )
}
